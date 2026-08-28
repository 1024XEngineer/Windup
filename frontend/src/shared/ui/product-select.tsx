import { CaretDown, Check } from '@phosphor-icons/react'
import { useEffect, useRef, useState } from 'react'

import { productMenuItemClass, productPopoverClass } from './product-control'

export interface ProductSelectOption<Value extends string> {
  value: Value
  label: string
}

export interface ProductSelectProps<Value extends string> {
  id: string
  value: Value
  options: readonly ProductSelectOption<Value>[]
  onChange: (value: Value) => void
  disabled?: boolean
  'aria-label'?: string
}

/** 与产品浮层视觉一致、支持键盘操作的单选下拉框。 */
export function ProductSelect<Value extends string>({
  id,
  value,
  options,
  onChange,
  disabled = false,
  'aria-label': ariaLabel,
}: ProductSelectProps<Value>) {
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  )
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(selectedIndex)
  const listboxId = `${id}-listbox`

  useEffect(() => {
    if (!open) return
    function closeOnOutsidePointer(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer)
  }, [open])

  useEffect(() => {
    if (disabled) setOpen(false)
  }, [disabled])

  function openMenu() {
    setActiveIndex(selectedIndex)
    setOpen(true)
  }

  function select(index: number) {
    const option = options[index]
    if (!option) return
    onChange(option.value)
    setOpen(false)
    triggerRef.current?.focus()
  }

  function moveActive(step: number) {
    setActiveIndex((current) => (current + step + options.length) % options.length)
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) openMenu()
      else moveActive(event.key === 'ArrowDown' ? 1 : -1)
      return
    }
    if (event.key === 'Home' && open) {
      event.preventDefault()
      setActiveIndex(0)
      return
    }
    if (event.key === 'End' && open) {
      event.preventDefault()
      setActiveIndex(options.length - 1)
      return
    }
    if ((event.key === 'Enter' || event.key === ' ') && open) {
      event.preventDefault()
      select(activeIndex)
      return
    }
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      setOpen(false)
      triggerRef.current?.focus()
      return
    }
    if (event.key === 'Tab') setOpen(false)
  }

  const selected = options[selectedIndex]

  return (
    <div ref={rootRef} className="relative min-w-0">
      <button
        ref={triggerRef}
        id={id}
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-controls={listboxId}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-activedescendant={open ? `${listboxId}-option-${activeIndex}` : undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={handleKeyDown}
        className="flex w-full items-center justify-between gap-3 rounded-xl border border-app-line bg-app-surface px-4 py-3 text-left text-sm outline-none transition-colors hover:border-app-line-strong focus-visible:border-app-accent disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span className="min-w-0 flex-1 truncate">{selected?.label}</span>
        <CaretDown
          aria-hidden="true"
          size={16}
          className={`shrink-0 text-app-faint transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open ? (
        <div
          id={listboxId}
          role="listbox"
          aria-label={ariaLabel}
          className={`${productPopoverClass} absolute inset-x-0 top-[calc(100%+0.4rem)] z-30 grid max-h-64 gap-1 overflow-y-auto p-1.5`}
        >
          {options.map((option, index) => {
            const selectedOption = option.value === value
            const active = index === activeIndex
            return (
              <button
                id={`${listboxId}-option-${index}`}
                key={option.value}
                type="button"
                role="option"
                aria-selected={selectedOption}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => select(index)}
                className={`${productMenuItemClass} justify-between gap-3 text-left ${
                  active ? 'bg-app-accent-muted text-app-accent' : 'text-app-ink-soft'
                }`}
              >
                <span>{option.label}</span>
                {selectedOption ? <Check aria-hidden="true" size={15} weight="bold" /> : null}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
