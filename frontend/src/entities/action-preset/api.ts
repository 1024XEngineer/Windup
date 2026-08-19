import { createApiClient, getApiAccessToken } from '@/shared/api'

import type { ActionPreset, ActionPresetApis } from '.'

/** 后端声称成功、但返回数据不符合 /action-presets 契约。 */
export class ActionPresetContractError extends Error {
  constructor(message: string) {
    super(`动作预设响应格式错误：${message}`)
    this.name = 'ActionPresetContractError'
  }
}

export const actionPresetApis: ActionPresetApis = {
  async list(signal?: AbortSignal): Promise<ActionPreset[]> {
    const result = await createApiClient({
      getAccessToken: getApiAccessToken,
    }).requestList<unknown>('/action-presets', { signal })
    // 空表当成契约错误而不是"暂时没有预设"：菜单里一条预设都没有与接口挂了没有区别，
    // 而静默的空菜单会被当成产品就长这样。
    if (result.items.length === 0) throw new ActionPresetContractError('预设列表为空')
    return result.items.map(parseActionPreset)
  },
}

function parseActionPreset(value: unknown): ActionPreset {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ActionPresetContractError('每条预设必须是对象')
  }
  const record = value as Record<string, unknown>
  return {
    type: nonEmptyString(record.type, 'type'),
    label: nonEmptyString(record.label, 'label'),
    name: nonEmptyString(record.name, 'name'),
    description: nonEmptyString(record.description, 'description'),
  }
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ActionPresetContractError(`${field} 必须是非空字符串`)
  }
  return value
}
