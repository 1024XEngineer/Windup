import {
  createApiClient,
  getApiAccessToken,
  recoverApiUnauthorized,
  resolveApiBaseUrl,
} from '@/shared/api'
import {
  createEventStreamSubscriber,
  EventStreamError,
  type EventStreamSubscriber,
} from '@/shared/api/stream'

import type {
  CompleteAnimationGenerationInput,
  GeneratedImage,
  Generation,
  GenerationApis,
  GenerationEvent,
  GenerationExpectation,
  GenerationInput,
  GenerationResult,
  GenerationTaskType,
  GenerationType,
  ImageCandidateCount,
  SequenceGeometry,
  TaskStatus,
} from '.'
import { isActionDirection, type ActionDirection } from '@/entities/character/directions'

type RequestFunction = (url: string, init?: RequestInit) => Promise<Response>

/** Generation 适配器需要的全部网络能力，由宿主统一注入。 */
export interface GenerationTransport {
  request: RequestFunction
  stream: EventStreamSubscriber
}

export interface GenerationApiConfig {
  /** API 前缀；空字符串表示同源。 */
  baseUrl?: string
  transport: GenerationTransport
  /** SSE 路由不存在时，任务查询兜底的间隔。 */
  pollIntervalMs?: number
}

interface ResponseEnvelope {
  code: unknown
  message: unknown
  data: unknown
}

interface GenerationTaskDto {
  id: number
  projectId: number
  taskType: BackendGenerationType
  status: TaskStatus
  inputPayload: Record<string, unknown> | null
  result: Record<string, unknown> | null
  errorMessage: string | null
  queueAhead?: number
}

type BackendGenerationType = 'character_image' | 'character_direction_set' | 'character_action'

const TASK_STATUSES = new Set<TaskStatus>(['pending', 'running', 'completed', 'partial', 'failed'])
const DIRECTION_TASK_STATUSES = new Set(['pending', 'running', 'completed', 'failed'])
const ACTION_TYPES = new Set(['walk', 'idle', 'attack', 'jump', 'custom'])
const RETRYABLE_QUERY_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504])

export class GenerationApiError extends Error {
  readonly code: number
  readonly status: number | null

  constructor(message: string, code = 0, options?: ErrorOptions, status: number | null = null) {
    super(message, options)
    this.name = 'GenerationApiError'
    this.code = code
    this.status = status
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function inputPositiveInteger(value: string | number, field: string): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new GenerationApiError(`${field} 必须是正整数`)
  }
  return parsed
}

function dtoPositiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new GenerationApiError(`生成任务 ${field} 无效`, 200)
  }
  return value as number
}

function dtoNullableRecord(value: unknown, field: string): Record<string, unknown> | null {
  if (value === null) return null
  if (!isRecord(value)) throw new GenerationApiError(`生成任务 ${field} 无效`, 200)
  return value
}

function dtoNullableString(value: unknown, field: string): string | null {
  if (value === null) return null
  if (typeof value !== 'string') throw new GenerationApiError(`生成任务 ${field} 无效`, 200)
  return value
}

function dtoQueueAhead(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new GenerationApiError('生成任务 queue_ahead 无效', 200)
  }
  return value as number
}

function backendTaskType(value: unknown): BackendGenerationType {
  if (
    value !== 'character_image' &&
    value !== 'character_direction_set' &&
    value !== 'character_action'
  ) {
    throw new GenerationApiError('生成任务 task_type 无效', 200)
  }
  return value
}

function taskStatus(value: unknown): TaskStatus {
  if (typeof value !== 'string' || !TASK_STATUSES.has(value as TaskStatus)) {
    throw new GenerationApiError('生成任务状态无效', 200)
  }
  return value as TaskStatus
}

function endpoint(baseUrl: string | undefined, path: string): string {
  return `${(baseUrl ?? '').replace(/\/$/u, '')}${path}`
}

async function readData(response: Response): Promise<unknown> {
  let raw: unknown
  try {
    raw = await response.json()
  } catch (error) {
    throw new GenerationApiError(
      `生成接口返回了无法解析的响应（HTTP ${response.status}）`,
      response.status,
      { cause: error },
      response.status,
    )
  }
  if (!isRecord(raw)) {
    throw new GenerationApiError(
      '生成接口响应不是对象',
      response.status,
      undefined,
      response.status,
    )
  }

  const envelope: ResponseEnvelope = {
    code: raw.code,
    message: raw.message,
    data: raw.data,
  }
  if (typeof envelope.code !== 'number') {
    throw new GenerationApiError(
      '生成接口响应缺少有效的 code',
      response.status,
      undefined,
      response.status,
    )
  }
  const message =
    typeof envelope.message === 'string' ? envelope.message : `HTTP ${response.status}`
  if (!response.ok || envelope.code !== 200) {
    throw new GenerationApiError(message, envelope.code, undefined, response.status)
  }
  if (envelope.data === null || envelope.data === undefined) {
    throw new GenerationApiError(
      '生成接口成功响应缺少 data',
      envelope.code,
      undefined,
      response.status,
    )
  }
  return envelope.data
}

/** 完整查询 DTO 的每个字段都在网络边界校验，不把脏数据带入实体。 */
function parseTaskDto(value: unknown): GenerationTaskDto {
  if (!isRecord(value)) throw new GenerationApiError('生成任务响应不是对象', 200)
  const inputPayload = dtoNullableRecord(value.input_payload, 'input_payload')
  return {
    id: dtoPositiveInteger(value.id, 'id'),
    projectId: dtoPositiveInteger(value.project_id, 'project_id'),
    taskType: backendTaskType(value.task_type),
    status: taskStatus(value.status),
    inputPayload,
    result: dtoNullableRecord(value.result, 'result'),
    errorMessage: dtoNullableString(value.error_message, 'error_message'),
    queueAhead: dtoQueueAhead(value.queue_ahead),
  }
}

function expectedBackendType(type: GenerationTaskType): BackendGenerationType {
  if (type === 'complete_animation') return 'character_action'
  return type === 'character_direction_set' ? 'character_direction_set' : 'character_image'
}

export const IMAGE_CANDIDATE_COUNT = 3
const MIN_IMAGE_CANDIDATE_COUNT = 1
const MAX_IMAGE_CANDIDATE_COUNT = 4

export function isImageCandidateCount(value: unknown): value is ImageCandidateCount {
  return (
    Number.isSafeInteger(value) &&
    (value as number) >= MIN_IMAGE_CANDIDATE_COUNT &&
    (value as number) <= MAX_IMAGE_CANDIDATE_COUNT
  )
}

function imageCandidateCount(value: unknown, field: string, code = 0): ImageCandidateCount {
  if (!isImageCandidateCount(value)) {
    throw new GenerationApiError(`${field} 必须是 1 到 4 之间的整数`, code)
  }
  return value
}

const DEFAULT_DIRECTION: ActionDirection = 'east'

function taskDirection(value: unknown, field: string): ActionDirection | undefined {
  if (value === undefined || value === null) return undefined
  if (!isActionDirection(value)) throw new GenerationApiError(`${field} 无效`, 200)
  return value
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new GenerationApiError(`${field} 无效`, 200)
  }
  return value
}

function mapImageResult(
  result: Record<string, unknown>,
  expectation: Extract<GenerationExpectation, { type: 'character_template' | 'first_frame' }>,
  expectedCandidateCount?: ImageCandidateCount,
): GenerationResult {
  if (result.type !== 'character_image') {
    throw new GenerationApiError('角色图片结果 type 无效', 200)
  }
  const resultDirection = taskDirection(result.direction, '角色图片结果 direction')
  if (expectation.direction !== undefined && resultDirection !== expectation.direction) {
    throw new GenerationApiError('角色图片结果 direction 与请求不一致', 200)
  }
  if (
    !Array.isArray(result.image_urls) ||
    result.image_urls.length === 0 ||
    result.image_urls.some((url) => typeof url !== 'string' || url.trim() === '')
  ) {
    throw new GenerationApiError('角色图片结果 image_urls 无效', 200)
  }
  const images = result.image_urls.map((url): GeneratedImage => ({ url: url as string }))

  if (!isImageCandidateCount(images.length)) {
    throw new GenerationApiError(
      `${expectation.type === 'first_frame' ? '动作首帧' : '角色母版'}结果必须包含 1 到 4 个候选`,
      200,
    )
  }
  if (expectedCandidateCount !== undefined && images.length !== expectedCandidateCount) {
    throw new GenerationApiError(
      `${expectation.type === 'first_frame' ? '动作首帧' : '角色母版'}结果数量必须与 input_payload.num_images ${expectedCandidateCount} 一致`,
      200,
    )
  }
  return expectation.direction === undefined
    ? { type: expectation.type, images }
    : { type: expectation.type, direction: expectation.direction, images }
}

function mapDirectionSetResult(result: Record<string, unknown>): GenerationResult {
  if (result.type !== 'character_direction_set' || !Array.isArray(result.directions)) {
    throw new GenerationApiError('方向集结果无效', 200)
  }
  if (result.directions.length === 0) {
    throw new GenerationApiError('方向集结果不能为空', 200)
  }
  const seen = new Set<ActionDirection>()
  const directions = result.directions.map((raw) => {
    if (!isRecord(raw)) throw new GenerationApiError('方向集结果项不是对象', 200)
    const direction = taskDirection(raw.direction, '方向集结果 direction')
    if (direction === undefined || seen.has(direction)) {
      throw new GenerationApiError('方向集结果 direction 重复或缺失', 200)
    }
    seen.add(direction)
    if (typeof raw.status !== 'string' || !DIRECTION_TASK_STATUSES.has(raw.status)) {
      throw new GenerationApiError('方向集结果 status 无效', 200)
    }
    if (
      !Array.isArray(raw.image_urls) ||
      raw.image_urls.some((url) => typeof url !== 'string' || url.trim() === '')
    ) {
      throw new GenerationApiError('方向集结果 image_urls 无效', 200)
    }
    if (raw.status === 'completed' && raw.image_urls.length === 0) {
      throw new GenerationApiError('已完成方向缺少图片', 200)
    }
    const error = dtoNullableString(raw.error_message, '方向集结果 error_message')
    if (raw.status === 'failed' ? !error?.trim() : error !== null) {
      throw new GenerationApiError('方向集结果 error_message 与状态不一致', 200)
    }
    return {
      direction,
      status: raw.status as 'pending' | 'running' | 'completed' | 'failed',
      images: raw.image_urls.map((url) => ({ url: url as string })),
      quality: dtoNullableRecord(raw.quality, '方向集结果 quality'),
      error,
    }
  })
  return { type: 'character_direction_set', directions }
}

/**
 * 任务声明的帧数。哪种动作出多少帧由后端定，前端读回来当结果帧数的判据——
 * 在前端也写一个数就是第二份约定，与后端分叉时两边都不会报错。
 */
function declaredFrameCount(
  inputPayload: Record<string, unknown> | null,
  expectation: GenerationExpectation,
): number | undefined {
  if (expectation.type !== 'complete_animation' || inputPayload === null) return undefined
  const value = inputPayload.num_frames
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new GenerationApiError('动作任务 input_payload.num_frames 无效', 200)
  }
  return value as number
}

function mapActionResult(
  result: Record<string, unknown>,
  expectation: Extract<GenerationExpectation, { type: 'complete_animation' }>,
  frameCount: number | undefined,
): GenerationResult {
  if (result.type !== 'character_action') {
    throw new GenerationApiError('完整动画结果 type 无效', 200)
  }
  const resultDirection = taskDirection(result.direction, '完整动画结果 direction')
  if (expectation.direction !== undefined && resultDirection !== expectation.direction) {
    throw new GenerationApiError('完整动画结果 direction 与请求不一致', 200)
  }
  if (typeof result.action_type !== 'string' || !ACTION_TYPES.has(result.action_type)) {
    throw new GenerationApiError('完整动画结果 action_type 无效', 200)
  }
  if (result.action_type !== expectation.actionType) {
    throw new GenerationApiError(
      `动作结果类型 ${result.action_type} 与请求的 ${expectation.actionType} 不一致`,
      200,
    )
  }
  if (!Array.isArray(result.frames) || result.frames.length === 0) {
    throw new GenerationApiError('完整动画结果 frames 无效', 200)
  }

  const indexes = new Set<number>()
  const frames = result.frames.map((frame) => {
    if (!isRecord(frame)) throw new GenerationApiError('动作帧不是对象', 200)
    if (!Number.isSafeInteger(frame.index) || (frame.index as number) < 0) {
      throw new GenerationApiError('动作帧 index 无效', 200)
    }
    const index = frame.index as number
    if (indexes.has(index)) throw new GenerationApiError('动作帧 index 重复', 200)
    indexes.add(index)
    if (
      frame.duration_ms !== null &&
      (!Number.isFinite(frame.duration_ms) || (frame.duration_ms as number) < 0)
    ) {
      throw new GenerationApiError('动作帧 duration_ms 无效', 200)
    }
    return {
      index,
      url: nonEmptyString(frame.image_url, '动作帧 image_url'),
      durationMs: frame.duration_ms as number | null,
    }
  })

  const orderedFrames = frames.sort((left, right) => left.index - right.index)
  // 事件没带 input_payload 时无从比对帧数，退回只查连续性——不能拿一个前端猜的数当判据。
  const expectedFrameCount = frameCount ?? orderedFrames.length
  if (orderedFrames.length !== expectedFrameCount) {
    throw new GenerationApiError(`完整动画结果必须包含 ${expectedFrameCount} 帧`, 200)
  }
  for (let index = 0; index < expectedFrameCount; index += 1) {
    if (!indexes.has(index)) {
      throw new GenerationApiError('动作帧 index 必须从 0 开始连续排列', 200)
    }
  }
  const geometry = actionGeometry(result.geometry)
  const mapped = {
    type: 'complete_animation',
    frames: orderedFrames,
    ...(geometry === undefined ? {} : { geometry }),
  } as const
  return expectation.direction === undefined
    ? mapped
    : { ...mapped, direction: expectation.direction }
}

/**
 * 解析交付帧的落位几何。缺失返回 undefined —— 旧任务没有这一段，而"没给"与
 * "给了默认值"必须能被消费方区分开：把缺省读成实测，角色不站在地上时没有一处会报错。
 * 给了就按结构严格校验，半个几何比没有更糟。
 */
function actionGeometry(value: unknown): SequenceGeometry | undefined {
  if (value === undefined || value === null) return undefined
  if (!isRecord(value)) throw new GenerationApiError('完整动画结果 geometry 不是对象', 200)
  const anchor = value.anchor
  if (!isRecord(anchor)) throw new GenerationApiError('完整动画结果 geometry.anchor 无效', 200)
  const unit = (raw: unknown, field: string) => {
    if (!Number.isFinite(raw) || (raw as number) < 0 || (raw as number) > 1) {
      throw new GenerationApiError(`完整动画结果 ${field} 必须是 0-1 归一化值`, 200)
    }
    return raw as number
  }
  const positive = (raw: unknown, field: string) => {
    if (!Number.isSafeInteger(raw) || (raw as number) <= 0) {
      throw new GenerationApiError(`完整动画结果 ${field} 无效`, 200)
    }
    return raw as number
  }
  const canvasHeight = positive(value.canvas_height, 'geometry.canvas_height')
  const footY = value.foot_y
  if (!Number.isSafeInteger(footY) || (footY as number) < 0 || (footY as number) > canvasHeight) {
    throw new GenerationApiError('完整动画结果 geometry.foot_y 超出画布', 200)
  }
  return {
    canvasWidth: positive(value.canvas_width, 'geometry.canvas_width'),
    canvasHeight,
    anchor: { x: unit(anchor.x, 'geometry.anchor.x'), y: unit(anchor.y, 'geometry.anchor.y') },
    footY: footY as number,
  }
}

function mapResult(
  result: Record<string, unknown> | null,
  status: TaskStatus,
  expectation: GenerationExpectation,
  expectedCandidateCount?: ImageCandidateCount,
  frameCount?: number,
): GenerationResult | null {
  if (expectation.type === 'character_direction_set') {
    if (result === null) {
      if (status === 'completed' || status === 'partial') {
        throw new GenerationApiError('方向集终态任务缺少 result', 200)
      }
      return null
    }
    return mapDirectionSetResult(result)
  }
  if (status !== 'completed') {
    if (result !== null) {
      throw new GenerationApiError('非完成任务不应携带 result', 200)
    }
    return null
  }
  if (result === null) throw new GenerationApiError('完成任务缺少 result', 200)
  return expectation.type === 'complete_animation'
    ? mapActionResult(result, expectation, frameCount)
    : mapImageResult(result, expectation, expectedCandidateCount)
}

function validateStatusError(status: TaskStatus, error: string | null): void {
  if (status === 'failed' || status === 'partial') {
    if (error === null || error.trim() === '') {
      throw new GenerationApiError('失败任务缺少 error_message', 200)
    }
    return
  }
  if (error !== null) {
    throw new GenerationApiError(`${status} 任务不应携带 error_message`, 200)
  }
}

function validateInputPayload(
  inputPayload: Record<string, unknown> | null,
  expectation: GenerationExpectation,
  expectedCandidateCount?: ImageCandidateCount,
): ImageCandidateCount | undefined {
  if (inputPayload === null) {
    throw new GenerationApiError('生成任务缺少 input_payload', 200)
  }
  if (expectation.type === 'character_direction_set') {
    const candidateCount = imageCandidateCount(inputPayload.num_images, '生成任务 num_images', 200)
    if (
      !Array.isArray(inputPayload.directions) ||
      inputPayload.directions.length === 0 ||
      inputPayload.directions.some((direction) => !isActionDirection(direction)) ||
      new Set(inputPayload.directions).size !== inputPayload.directions.length
    ) {
      throw new GenerationApiError('方向集任务 directions 无效', 200)
    }
    return candidateCount
  }
  if (expectation.type !== 'complete_animation') {
    const candidateCount = imageCandidateCount(inputPayload.num_images, '生成任务 num_images', 200)
    if (expectedCandidateCount !== undefined && candidateCount !== expectedCandidateCount) {
      throw new GenerationApiError(
        `${expectation.type === 'first_frame' ? '动作首帧' : '角色母版'}任务 input_payload.num_images 与请求的 ${expectedCandidateCount} 不一致`,
        200,
      )
    }
    if (expectation.direction !== undefined) {
      const direction = taskDirection(inputPayload.direction, '生成任务 direction')
      if (direction !== expectation.direction) {
        throw new GenerationApiError('生成任务 direction 与请求不一致', 200)
      }
    }
    return candidateCount
  }
  if (inputPayload.action_type !== expectation.actionType) {
    throw new GenerationApiError('动作任务 input_payload.action_type 与请求不一致', 200)
  }
  if (expectation.direction !== undefined) {
    const direction = taskDirection(inputPayload.direction, '生成任务 direction')
    if (direction !== expectation.direction) {
      throw new GenerationApiError('生成任务 direction 与请求不一致', 200)
    }
  }
  return undefined
}

function inferExpectation(dto: GenerationTaskDto): GenerationExpectation {
  if (dto.taskType === 'character_direction_set') return { type: 'character_direction_set' }
  const direction = dto.inputPayload
    ? taskDirection(dto.inputPayload.direction, '生成任务 direction')
    : undefined
  if (dto.taskType === 'character_image') {
    return direction === undefined
      ? { type: 'character_template' }
      : { type: 'character_template', direction }
  }
  if (dto.inputPayload === null) {
    throw new GenerationApiError('动作任务缺少 input_payload', 200)
  }
  const actionType = dto.inputPayload.action_type
  if (typeof actionType !== 'string' || !ACTION_TYPES.has(actionType)) {
    throw new GenerationApiError('动作任务 input_payload.action_type 无效', 200)
  }
  // 阶段由 task_type 与 action_type 定：character_action 在前端只对应"完整动画"这一个阶段。
  // 帧数是产物参数不是阶段判据——拿它判，改一个动作的帧数就会让这类任务整个认不出来。
  return direction === undefined
    ? { type: 'complete_animation', actionType }
    : { type: 'complete_animation', actionType, direction }
}

function validateTaskIdentity(
  dto: GenerationTaskDto,
  expectedProjectId: number,
  expectation: GenerationExpectation,
  expectedTaskId?: number,
  expectedCandidateCount?: ImageCandidateCount,
): ImageCandidateCount | undefined {
  if (dto.projectId !== expectedProjectId) {
    throw new GenerationApiError(`生成任务未归属请求中的项目 ${expectedProjectId}`, 200)
  }
  if (expectedTaskId !== undefined && dto.id !== expectedTaskId) {
    throw new GenerationApiError(`生成任务 ID 与请求的 ${expectedTaskId} 不一致`, 200)
  }
  if (dto.taskType !== expectedBackendType(expectation.type)) {
    throw new GenerationApiError(`生成任务类型与 ${expectation.type} 不匹配`, 200)
  }
  validateStatusError(dto.status, dto.errorMessage)
  return validateInputPayload(dto.inputPayload, expectation, expectedCandidateCount)
}

function mapTask(
  value: unknown,
  expectedProjectId: number,
  expectation?: GenerationExpectation,
  expectedTaskId?: number,
  expectedCandidateCount?: ImageCandidateCount,
): { generation: Generation<GenerationTaskType>; candidateCount?: ImageCandidateCount } {
  const dto = parseTaskDto(value)
  const resolvedExpectation = expectation ?? inferExpectation(dto)
  const candidateCount = validateTaskIdentity(
    dto,
    expectedProjectId,
    resolvedExpectation,
    expectedTaskId,
    expectedCandidateCount,
  )
  return {
    generation: {
      id: String(dto.id),
      projectId: String(dto.projectId),
      type: resolvedExpectation.type,
      status: dto.status,
      result: mapResult(
        dto.result,
        dto.status,
        resolvedExpectation,
        candidateCount,
        declaredFrameCount(dto.inputPayload, resolvedExpectation),
      ),
      error: dto.errorMessage,
      ...(dto.queueAhead === undefined ? {} : { queueAhead: dto.queueAhead }),
    },
    ...(candidateCount === undefined ? {} : { candidateCount }),
  }
}

function references(input: CompleteAnimationGenerationInput): string[] {
  return [input.firstFrameUrl, ...input.referenceMedia.map(String)].filter(
    (url, index, all) => url.trim() !== '' && all.indexOf(url) === index,
  )
}

function parseEventData(data: string): unknown {
  try {
    return JSON.parse(data) as unknown
  } catch (error) {
    throw new GenerationApiError('task_update 不是有效 JSON', 200, { cause: error })
  }
}

function eventTaskId(value: Record<string, unknown>): number {
  const taskId = value.task_id === undefined ? null : dtoPositiveInteger(value.task_id, 'task_id')
  const id = value.id === undefined ? null : dtoPositiveInteger(value.id, 'id')
  if (taskId !== null && id !== null && taskId !== id) {
    throw new GenerationApiError('task_update 的 task_id 与 id 不一致', 200)
  }
  if (taskId === null && id === null) return dtoPositiveInteger(undefined, 'task_id')
  return taskId ?? id!
}

function eventStatus(value: Record<string, unknown>, eventName: string): TaskStatus {
  const impliedStatus =
    eventName === 'completed'
      ? 'completed'
      : eventName === 'partial'
        ? 'partial'
        : eventName === 'failed'
          ? 'failed'
          : null
  if (value.status === undefined) {
    if (impliedStatus) return impliedStatus
    if (eventName === 'progress') return 'running'
  }
  const status = taskStatus(value.status)
  if (impliedStatus && status !== impliedStatus) {
    throw new GenerationApiError(`SSE ${eventName} 事件与 status=${status} 不一致`, 200)
  }
  return status
}

function waitForPoll(delayMs: number, signal: AbortSignal): Promise<void> {
  if (delayMs <= 0 || signal.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', finish)
      resolve()
    }
    const timer = setTimeout(finish, delayMs)
    signal.addEventListener('abort', finish, { once: true })
  })
}

function isTerminalStatus(status: TaskStatus): boolean {
  return status === 'completed' || status === 'partial' || status === 'failed'
}

function isRetryableQueryError(cause: unknown): boolean {
  if (!(cause instanceof GenerationApiError)) return true
  return cause.status !== null && RETRYABLE_QUERY_STATUSES.has(cause.status)
}

function mapEvent<TType extends GenerationTaskType>(
  value: unknown,
  expectedProjectId: number,
  expectedTaskId: number,
  expectation: Extract<GenerationExpectation, { type: TType }>,
  eventName: string,
  expectedCandidateCount?: ImageCandidateCount,
): GenerationEvent<TType> {
  if (!isRecord(value)) throw new GenerationApiError('task_update 不是对象', 200)
  const taskId = eventTaskId(value)
  if (taskId !== expectedTaskId) {
    throw new GenerationApiError(`task_update ID 与订阅的 ${expectedTaskId} 不一致`, 200)
  }
  if (eventName === 'progress') {
    if (
      value.project_id !== undefined &&
      dtoPositiveInteger(value.project_id, 'project_id') !== expectedProjectId
    ) {
      throw new GenerationApiError('progress 不属于当前项目', 200)
    }
    if (typeof value.stage !== 'string' || value.stage.trim() === '') {
      throw new GenerationApiError('progress stage 无效', 200)
    }
    if (!Number.isSafeInteger(value.current) || (value.current as number) < 0) {
      throw new GenerationApiError('progress current 无效', 200)
    }
    if (!Number.isSafeInteger(value.total) || (value.total as number) <= 0) {
      throw new GenerationApiError('progress total 无效', 200)
    }
    if ((value.current as number) > (value.total as number)) {
      throw new GenerationApiError('progress current 不能超过 total', 200)
    }
    if (typeof value.note !== 'string') {
      throw new GenerationApiError('progress note 无效', 200)
    }
    return {
      taskId: String(taskId),
      type: expectation.type,
      status: 'running',
      result: null,
      error: null,
      progress: {
        stage: value.stage,
        current: value.current as number,
        total: value.total as number,
        note: value.note,
      },
    } as GenerationEvent<TType>
  }
  if (backendTaskType(value.task_type) !== expectedBackendType(expectation.type)) {
    throw new GenerationApiError(`task_update 类型与 ${expectation.type} 不匹配`, 200)
  }
  if (
    value.project_id !== undefined &&
    dtoPositiveInteger(value.project_id, 'project_id') !== expectedProjectId
  ) {
    throw new GenerationApiError('task_update 不属于当前项目', 200)
  }
  const inputPayload =
    value.input_payload === undefined
      ? undefined
      : dtoNullableRecord(value.input_payload, 'input_payload')
  const candidateCount =
    inputPayload === undefined
      ? expectedCandidateCount
      : validateInputPayload(inputPayload, expectation, expectedCandidateCount)
  const status = eventStatus(value, eventName)
  const result = value.result === undefined ? null : dtoNullableRecord(value.result, 'result')
  const error =
    value.error_message === undefined
      ? null
      : dtoNullableString(value.error_message, 'error_message')
  validateStatusError(status, error)
  const queueAhead = dtoQueueAhead(value.queue_ahead)
  return {
    taskId: String(taskId),
    type: expectation.type,
    status,
    result: mapResult(
      result,
      status,
      expectation,
      candidateCount,
      inputPayload === undefined ? undefined : declaredFrameCount(inputPayload, expectation),
    ),
    error,
    ...(queueAhead === undefined ? {} : { queueAhead }),
  }
}

/**
 * 创建 Generation 实体适配器。
 *
 * HTTP/SSE transport 由宿主注入并统一携带 token。三个前端阶段在这里收口为
 * 后端的两类 GenerationTask，用户身份不进入适配器契约。
 */
export function createGenerationApis(config: GenerationApiConfig): GenerationApis {
  const { request, stream } = config.transport
  const pollIntervalMs = config.pollIntervalMs ?? 1_000
  if (!Number.isFinite(pollIntervalMs) || pollIntervalMs < 0) {
    throw new GenerationApiError('pollIntervalMs 必须是非负数')
  }
  const expectations = new Map<string, GenerationExpectation>()
  const candidateCounts = new Map<string, ImageCandidateCount>()

  async function post<TType extends GenerationType>(
    path: '/generation/image' | '/generation/action',
    projectId: number,
    expectation: Extract<GenerationExpectation, { type: TType }>,
    body: Record<string, unknown>,
    expectedCandidateCount?: ImageCandidateCount,
  ): Promise<Generation<TType>> {
    const response = await request(endpoint(config.baseUrl, path), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    return mapTask(
      await readData(response),
      projectId,
      expectation,
      undefined,
      expectedCandidateCount,
    ).generation as Generation<TType>
  }

  const apis: GenerationApis = {
    async create<T extends GenerationInput>(input: T): Promise<Generation<T['type']>> {
      const projectId = inputPositiveInteger(input.projectId, 'projectId')
      if (input.type === 'complete_animation') {
        const referenceImageUrls = references(input)
        // 这两道拦在 HTTP 之前。后端各有一道最后防线，但它回给用户的是
        // "请求参数校验失败"和一条 pydantic 明细，读不懂也不知道下一步做什么。
        if (input.actionType === 'custom' && !(input.prompt ?? '').trim()) {
          throw new GenerationApiError('自定义动作必须填写动作描述，例如：来回踱步')
        }
        if (referenceImageUrls.length === 0) {
          throw new GenerationApiError('这个造型还没有可用的角色母版，请先完成定妆再生成动作')
        }
        const expectation = {
          type: input.type,
          actionType: input.actionType,
          ...(input.direction === undefined ? {} : { direction: input.direction }),
        } as const
        const generation = await post('/generation/action', projectId, expectation, {
          project_id: projectId,
          character_id: inputPositiveInteger(input.characterId, 'characterId'),
          action_type: input.actionType,
          custom_prompt: input.prompt,
          // 自定义动作的循环性必须由前端给：后端不从描述文字猜（"走/挥"这类词信号不可靠），
          // 缺省时它按一次性兜底。非 custom 的动作后端有写死的表，传了会被拒，故只在
          // custom 时发送。
          ...(input.actionType === 'custom' ? { loop: input.loop ?? false } : {}),
          reference_video_url: null,
          reference_image_urls: referenceImageUrls,
          // 不发帧数：哪种动作出多少帧是后端按 action_type 定的约定，前端发一个数就是
          // 第二份约定，两边分叉时任务照跑、帧照出，没有一处会红。

          // 后端拿 outfit_id 在场与否当三渲二的唯一判据（#122），所以它同时是"路线选择"
          // 本身，不只是一个标识。无条件发送会让建过 3D 资产的造型点"视频裁剪"也走三渲二，
          // 画风、成本、生成语义全被静默改掉，故只在用户真选了三渲二时发。
          ...(input.method === '3d-to-2d'
            ? { outfit_id: nonEmptyString(input.outfitId, 'outfitId') }
            : {}),
          direction: input.direction ?? DEFAULT_DIRECTION,
        })
        expectations.set(generation.id, expectation)
        return generation as Generation<T['type']>
      }

      const expectation =
        input.type === 'first_frame'
          ? ({
              type: 'first_frame',
              actionType: input.actionType,
              ...(input.direction === undefined ? {} : { direction: input.direction }),
            } as const)
          : ({
              type: 'character_template',
              ...(input.direction === undefined ? {} : { direction: input.direction }),
            } as const)
      const referenceImageUrl = input.referenceMedia[0] ? String(input.referenceMedia[0]) : null
      if (input.type === 'first_frame' && !referenceImageUrl) {
        throw new GenerationApiError('动作首帧生成必须提供已确认的角色母版')
      }
      const candidateCount = imageCandidateCount(
        input.candidateCount ?? IMAGE_CANDIDATE_COUNT,
        'candidateCount',
      )
      const generation = await post(
        '/generation/image',
        projectId,
        expectation,
        {
          project_id: projectId,
          reference_image_url: referenceImageUrl,
          prompt: input.prompt ?? '',
          negative_prompt: '',
          width: inputPositiveInteger(input.spriteWidth, 'spriteWidth'),
          height: inputPositiveInteger(input.spriteHeight, 'spriteHeight'),
          // 缺省生成三张；调用方可按后端契约在 1–4 张之间选择。
          num_images: candidateCount,
          direction: input.direction ?? DEFAULT_DIRECTION,
        },
        candidateCount,
      )
      expectations.set(generation.id, expectation)
      candidateCounts.set(generation.id, candidateCount)
      return generation as Generation<T['type']>
    },

    async get(
      projectId: string,
      id: string,
      expectation?: GenerationExpectation,
    ): Promise<Generation> {
      const numericProjectId = inputPositiveInteger(projectId, 'projectId')
      const numericTaskId = inputPositiveInteger(id, 'taskId')
      const response = await request(
        endpoint(
          config.baseUrl,
          `/generation/tasks/${numericTaskId}?project_id=${numericProjectId}`,
        ),
        { method: 'GET' },
      )
      const raw = await readData(response)
      const resolvedExpectation = expectation ?? inferExpectation(parseTaskDto(raw))
      const { generation, candidateCount } = mapTask(
        raw,
        numericProjectId,
        resolvedExpectation,
        numericTaskId,
      )
      expectations.set(generation.id, resolvedExpectation)
      if (candidateCount !== undefined) candidateCounts.set(generation.id, candidateCount)
      return generation as Generation
    },

    subscribe(
      projectId: string,
      id: string,
      expectationOrOnEvent: GenerationExpectation | ((event: GenerationEvent) => void),
      onEventOrError?: ((event: GenerationEvent) => void) | ((error: Error) => void),
      maybeOnError?: (error: Error) => void,
    ): () => void {
      const numericProjectId = inputPositiveInteger(projectId, 'projectId')
      const numericTaskId = inputPositiveInteger(id, 'taskId')
      const expectation =
        typeof expectationOrOnEvent === 'function' ? expectations.get(id) : expectationOrOnEvent
      if (!expectation) {
        throw new GenerationApiError('订阅前必须先创建或查询生成任务')
      }
      const onEvent =
        typeof expectationOrOnEvent === 'function'
          ? expectationOrOnEvent
          : (onEventOrError as (event: GenerationEvent) => void)
      const onError =
        typeof expectationOrOnEvent === 'function'
          ? () => undefined
          : (maybeOnError ?? (() => undefined))
      const expectedCandidateCount = candidateCounts.get(id)
      const pollingController = new AbortController()
      let polling = false
      let terminalHandled = false
      let stopStream: () => void = () => undefined

      // GET 快照和 SSE 事件共用同一份订阅契约：降级轮询与重连对账也要带上队列位置。
      const eventFromSnapshot = (generation: Generation<GenerationTaskType>) =>
        ({
          taskId: generation.id,
          type: generation.type,
          status: generation.status,
          result: generation.result,
          error: generation.error,
          ...(generation.queueAhead === undefined ? {} : { queueAhead: generation.queueAhead }),
        }) as GenerationEvent

      const pollUntilTerminal = async () => {
        if (polling) return
        polling = true
        while (!pollingController.signal.aborted) {
          try {
            const generation = await apis.get(projectId, id, expectation)
            if (pollingController.signal.aborted) return
            onEvent(eventFromSnapshot(generation))
            if (isTerminalStatus(generation.status)) {
              return
            }
          } catch (cause) {
            if (pollingController.signal.aborted) return
            if (!isRetryableQueryError(cause)) {
              onError(cause instanceof Error ? cause : new GenerationApiError('任务轮询失败'))
              return
            }
          }
          await waitForPoll(pollIntervalMs, pollingController.signal)
        }
      }

      const reconcileAfterReconnect = async () => {
        if (pollingController.signal.aborted) return
        try {
          const generation = await apis.get(projectId, id, expectation)
          if (pollingController.signal.aborted || terminalHandled) return
          const terminal = isTerminalStatus(generation.status)
          if (terminal) terminalHandled = true
          onEvent(eventFromSnapshot(generation))
          if (terminal) {
            stopStream()
          }
        } catch (cause) {
          if (pollingController.signal.aborted || terminalHandled) return
          if (!isRetryableQueryError(cause)) {
            onError(cause instanceof Error ? cause : new GenerationApiError('重连后任务对账失败'))
          }
        }
      }

      stopStream = stream(
        endpoint(
          config.baseUrl,
          `/generation/tasks/${numericTaskId}/stream?project_id=${numericProjectId}`,
        ),
        {
          eventName: ['task_update', 'progress', 'completed', 'partial', 'failed'],
          onEvent(data, eventName) {
            if (terminalHandled) return true
            const event = mapEvent(
              parseEventData(data),
              numericProjectId,
              numericTaskId,
              expectation,
              eventName,
              expectedCandidateCount,
            )
            const terminal = isTerminalStatus(event.status)
            if (terminal) terminalHandled = true
            onEvent(event as GenerationEvent)
            return terminal
          },
          onError(error) {
            if (
              error instanceof EventStreamError &&
              (error.status === 404 || error.status === 405 || error.status === 501)
            ) {
              stopStream()
              void pollUntilTerminal()
              return
            }
            if (error instanceof EventStreamError && error.retryable) return
            onError(error)
          },
          // 断线窗口内的事件不会被补发，重连后必须自己查一次当前状态，
          // 否则恰在窗口内结束的任务会永远停在最后一次收到的中间态。
          onReconnect() {
            void reconcileAfterReconnect()
          },
        },
      )
      return () => {
        stopStream()
        pollingController.abort()
      }
    },
  }

  return apis
}

/** 为浏览器宿主装配统一的 API 前缀、会话恢复与 SSE 鉴权。 */
export function createAuthenticatedGenerationApis(
  fetchFn: typeof fetch = globalThis.fetch,
): GenerationApis {
  const client = createApiClient({ fetchFn, getAccessToken: getApiAccessToken })
  const stream = createEventStreamSubscriber({
    fetchFn,
    getAccessToken: getApiAccessToken,
    recoverUnauthorized: recoverApiUnauthorized,
  })

  return createGenerationApis({
    transport: {
      async request(url, init) {
        const data = await client.request<unknown>(url, { ...init, credentials: 'include' })
        return new Response(JSON.stringify({ code: 200, message: 'success', data }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      },
      stream: (url, options) => stream(`${resolveApiBaseUrl()}${url}`, options),
    },
  })
}
