// @vitest-environment jsdom

import { useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { QuickStartConversationClient } from './api'
import { QuickStartConversation } from './conversation'

afterEach(cleanup)

function renderConversation(
  client: QuickStartConversationClient,
  onConfirm: (prompt: string) => Promise<void> = async () => undefined,
) {
  function Fixture() {
    const [draft, setDraft] = useState('')
    return (
      <QuickStartConversation
        client={client}
        draft={draft}
        onDraftChange={setDraft}
        onConfirm={onConfirm}
      />
    )
  }
  return render(<Fixture />)
}

describe('QuickStartConversation', () => {
  it('continues the same conversation after a clarification', async () => {
    const respond = vi
      .fn<QuickStartConversationClient['respond']>()
      .mockResolvedValueOnce({
        type: 'clarification',
        reply: '后续动作需要一个明确主体，你希望保留哪一只狗？',
      })
      .mockResolvedValueOnce({
        type: 'prompt_suggestion',
        reply: '角色已经整理清楚了。',
        optimizedPrompt: '单一角色，一只穿红色飞行夹克的金毛，完整身体，纯净背景',
        warnings: [],
      })
    renderConversation({ respond })

    fireEvent.change(screen.getByRole('textbox', { name: '创作指令' }), {
      target: { value: '一群奔跑的大狗' },
    })
    fireEvent.click(screen.getByRole('button', { name: '发送描述' }))
    expect(await screen.findByText('后续动作需要一个明确主体，你希望保留哪一只狗？')).toBeTruthy()

    fireEvent.change(screen.getByRole('textbox', { name: '创作指令' }), {
      target: { value: '一只穿红色飞行夹克的金毛' },
    })
    fireEvent.click(screen.getByRole('button', { name: '发送描述' }))

    expect(
      await screen.findByDisplayValue('单一角色，一只穿红色飞行夹克的金毛，完整身体，纯净背景'),
    ).toBeTruthy()
    expect(respond).toHaveBeenLastCalledWith(
      [
        { role: 'user', content: '一群奔跑的大狗' },
        {
          role: 'assistant',
          content: '后续动作需要一个明确主体，你希望保留哪一只狗？',
        },
        { role: 'user', content: '一只穿红色飞行夹克的金毛' },
      ],
      expect.any(AbortSignal),
    )
  })

  it('uses the user-edited suggestion only after explicit confirmation', async () => {
    const onConfirm = vi.fn(async () => undefined)
    renderConversation(
      {
        respond: async () => ({
          type: 'prompt_suggestion',
          reply: '我整理了一版适合动作生成的描述。',
          optimizedPrompt: '单一角色，像素骑士，完整身体',
          warnings: ['已移除复杂战场背景'],
        }),
      },
      onConfirm,
    )

    fireEvent.change(screen.getByRole('textbox', { name: '创作指令' }), {
      target: { value: '战场上的像素骑士' },
    })
    fireEvent.click(screen.getByRole('button', { name: '发送描述' }))

    const suggestion = await screen.findByRole('textbox', { name: '优化后的角色描述' })
    expect(screen.getByRole('list').textContent).toContain('已移除复杂战场背景')
    expect(onConfirm).not.toHaveBeenCalled()
    fireEvent.change(suggestion, {
      target: { value: '单一角色，蓝甲像素骑士，完整身体，纯净背景' },
    })
    fireEvent.click(screen.getByRole('button', { name: '按此生成角色' }))

    await waitFor(() =>
      expect(onConfirm).toHaveBeenCalledWith('单一角色，蓝甲像素骑士，完整身体，纯净背景'),
    )
  })

  it('keeps the previous prompt suggestion in model history for a revision request', async () => {
    const respond = vi
      .fn<QuickStartConversationClient['respond']>()
      .mockResolvedValueOnce({
        type: 'prompt_suggestion',
        reply: '我整理了一版。',
        optimizedPrompt: '单一角色，红甲骑士，完整身体',
        warnings: [],
      })
      .mockResolvedValueOnce({
        type: 'prompt_suggestion',
        reply: '已经换成蓝色。',
        optimizedPrompt: '单一角色，蓝甲骑士，完整身体',
        warnings: [],
      })
    renderConversation({ respond })

    fireEvent.change(screen.getByRole('textbox', { name: '创作指令' }), {
      target: { value: '红甲骑士' },
    })
    fireEvent.click(screen.getByRole('button', { name: '发送描述' }))
    await screen.findByDisplayValue('单一角色，红甲骑士，完整身体')
    fireEvent.change(screen.getByRole('textbox', { name: '创作指令' }), {
      target: { value: '改成蓝色' },
    })
    fireEvent.click(screen.getByRole('button', { name: '发送描述' }))

    await screen.findByDisplayValue('单一角色，蓝甲骑士，完整身体')
    expect(respond).toHaveBeenLastCalledWith(
      [
        { role: 'user', content: '红甲骑士' },
        {
          role: 'assistant',
          content:
            '{"type":"prompt_suggestion","reply":"我整理了一版。","optimizedPrompt":"单一角色，红甲骑士，完整身体","warnings":[]}',
        },
        { role: 'user', content: '改成蓝色' },
      ],
      expect.any(AbortSignal),
    )
  })

  it('keeps the draft when the LLM request fails', async () => {
    renderConversation({
      respond: async () => {
        throw new Error('模型暂时不可用')
      },
    })

    const input = screen.getByRole('textbox', { name: '创作指令' })
    fireEvent.change(input, { target: { value: '戴星形眼镜的裁缝' } })
    fireEvent.click(screen.getByRole('button', { name: '发送描述' }))

    expect((await screen.findByRole('alert')).textContent).toContain('模型暂时不可用')
    expect((input as HTMLInputElement).value).toBe('戴星形眼镜的裁缝')
  })

  it('aborts the active request when leaving the page', async () => {
    let observedSignal: AbortSignal | undefined
    const { unmount } = renderConversation({
      respond: (_messages, signal) => {
        observedSignal = signal
        return new Promise(() => undefined)
      },
    })

    fireEvent.change(screen.getByRole('textbox', { name: '创作指令' }), {
      target: { value: '戴星形眼镜的裁缝' },
    })
    fireEvent.click(screen.getByRole('button', { name: '发送描述' }))
    await waitFor(() => expect(observedSignal).toBeInstanceOf(AbortSignal))
    unmount()

    expect(observedSignal?.aborted).toBe(true)
  })

  it('lets the user cancel an active request without leaving the page', async () => {
    let observedSignal: AbortSignal | undefined
    renderConversation({
      respond: (_messages, signal) => {
        observedSignal = signal
        return new Promise(() => undefined)
      },
    })

    fireEvent.change(screen.getByRole('textbox', { name: '创作指令' }), {
      target: { value: '戴星形眼镜的裁缝' },
    })
    fireEvent.click(screen.getByRole('button', { name: '发送描述' }))
    fireEvent.click(await screen.findByRole('button', { name: '取消请求' }))

    expect(observedSignal?.aborted).toBe(true)
    expect(screen.getByRole('button', { name: '发送描述' }).hasAttribute('disabled')).toBe(false)
  })

  it('lets the user skip a clarification and request a suggestion from existing context', async () => {
    const respond = vi
      .fn<QuickStartConversationClient['respond']>()
      .mockResolvedValueOnce({
        type: 'clarification',
        reply: '你希望角色穿什么颜色的衣服？',
      })
      .mockResolvedValueOnce({
        type: 'prompt_suggestion',
        reply: '我先按现有信息整理了一版。',
        optimizedPrompt: '单一角色，像素裁缝，完整身体，纯净背景',
        warnings: ['服装颜色未指定'],
      })
    renderConversation({ respond })

    fireEvent.change(screen.getByRole('textbox', { name: '创作指令' }), {
      target: { value: '像素裁缝' },
    })
    fireEvent.click(screen.getByRole('button', { name: '发送描述' }))
    fireEvent.click(await screen.findByRole('button', { name: '跳过追问' }))

    expect(await screen.findByDisplayValue('单一角色，像素裁缝，完整身体，纯净背景')).toBeTruthy()
    expect(respond).toHaveBeenLastCalledWith(
      [
        { role: 'user', content: '像素裁缝' },
        { role: 'assistant', content: '你希望角色穿什么颜色的衣服？' },
        { role: 'user', content: '跳过追问，请基于现有信息直接整理提示词。' },
      ],
      expect.any(AbortSignal),
    )
  })
})
