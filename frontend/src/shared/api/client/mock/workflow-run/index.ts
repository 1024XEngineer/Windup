import type { MockRoute } from '../types'
import { advanceRun } from './machine'
import { createRun, loadRun } from './store'
import type { CommandDto, RunDto } from './types'

/** 后端 workflow 接口就绪后，删掉整个 workflow-run/ 目录即可。路径待 #60 确认。 */
const ok = (data: RunDto, message = 'success') => ({ code: 200, message, data })
const fail = (code: number, message: string) => ({ code, message, data: null })

export const workflowRunMockHandlers: MockRoute[] = [
  {
    method: 'POST',
    pattern: /^\/workflows$/,
    handler: (options) => {
      const body = options.body as Partial<RunDto> | undefined
      if (!body?.project_id) return fail(400, '缺少 project_id')
      return ok(
        createRun({
          projectId: body.project_id,
          driver: body.driver ?? 'manual',
          prompt: body.prompt ?? null,
        }),
        '创建成功',
      )
    },
  },
  {
    method: 'GET',
    pattern: /^\/workflows\/([^/]+)$/,
    handler: (_options, params) => {
      const run = loadRun(params[0])
      return run ? ok(run) : fail(404, `工作流 ${params[0]} 不存在`)
    },
  },
  {
    method: 'POST',
    pattern: /^\/workflows\/([^/]+)\/commands$/,
    handler: (options, params) => {
      if (!loadRun(params[0])) return fail(404, `工作流 ${params[0]} 不存在`)
      try {
        return ok(advanceRun(params[0], options.body as CommandDto))
      } catch (cause) {
        return fail(400, cause instanceof Error ? cause.message : String(cause))
      }
    },
  },
]
