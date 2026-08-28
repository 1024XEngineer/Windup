// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ProductSelect } from './product-select'

afterEach(cleanup)

describe('ProductSelect', () => {
  it('用方向键选择选项并在确认后把焦点留在触发器上', () => {
    const onChange = vi.fn()
    render(
      <ProductSelect
        id="movement"
        aria-label="朝向"
        value="single"
        options={[
          { value: 'single', label: '单向' },
          { value: 'four-way', label: '四向' },
          { value: 'eight-way', label: '八向' },
        ]}
        onChange={onChange}
      />,
    )

    const trigger = screen.getByRole('combobox', { name: '朝向' })
    trigger.focus()
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    fireEvent.keyDown(trigger, { key: 'Enter' })

    expect(onChange).toHaveBeenCalledWith('four-way')
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('按 Escape 或点击组件外部会关闭选项', () => {
    render(
      <div>
        <ProductSelect
          id="style"
          aria-label="画风"
          value="pixel"
          options={[
            { value: 'pixel', label: '像素' },
            { value: 'ink', label: '水墨' },
          ]}
          onChange={() => undefined}
        />
        <button type="button">外部按钮</button>
      </div>,
    )

    const trigger = screen.getByRole('combobox', { name: '画风' })
    fireEvent.click(trigger)
    expect(screen.getByRole('listbox')).toBeTruthy()
    fireEvent.keyDown(trigger, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()

    fireEvent.click(trigger)
    fireEvent.pointerDown(screen.getByRole('button', { name: '外部按钮' }))
    expect(screen.queryByRole('listbox')).toBeNull()
  })
})
