/**
 * 把浏览器出帧接到已有的任务订阅上(#714)。
 *
 * 不另立状态机:任务的终态仍由 `generationApis.subscribe` 收 —— 出帧只是这条任务中间
 * 的一段,渲完交回后端由 worker 续跑后处理,成功与失败都还是原来那条事件。
 */
import { render3DApis } from '@/entities'

import { runClientBake } from '.'

import type { Render3DApis } from '@/entities'

/**
 * 建单与登记之间隔着一次 MQ 投递,所以第一次问多半问不到。
 *
 * 退避到 20 秒:三渲二任务在这个窗口内一定已经登记好了(登记就发生在 worker 接到消息
 * 的那几行里);问不到就是这条任务走的 i2v,不必再问。
 */
const RETRY_DELAYS_MS = [800, 1600, 3200, 6000, 8000]

export interface AttachClientBakeOptions {
  apis?: Render3DApis
  sleep?: (ms: number) => Promise<void>
  onProgress?: (done: number, total: number) => void
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * 问这条任务需不需要浏览器出帧;需要就跑完它。
 *
 * @returns 是否真的出了帧。false = 这条任务不走三渲二(或已收口)。
 */
export async function attachClientBake(
  taskId: number,
  { apis = render3DApis, sleep = defaultSleep, onProgress }: AttachClientBakeOptions = {},
): Promise<boolean> {
  for (const delay of RETRY_DELAYS_MS) {
    const job = await apis.getBakeJob(taskId)
    if (job) {
      await runClientBake({
        job,
        apis,
        onProgress: onProgress && (({ done, total }) => onProgress(done, total)),
      })
      return true
    }
    await sleep(delay)
  }
  return false
}
