import { useState } from 'react'

import type { PlusOption } from '@/features/canvas-flow'

export interface PlusMenuProps {
  options: PlusOption[]
  /** 选中叶子节点时回调，参数是该叶子的 id。 */
  onPick: (optionId: string) => void
  onClose: () => void
}

/**
 * 加号展开后的菜单，最多两层。
 * 只渲染传入的选项，因此非法组合不会出现在界面上——用户挑不到，
 * 也就不需要「连接之后再报错」这条路径。
 */
export function PlusMenu({ options, onPick, onClose }: PlusMenuProps) {
  const [openGroup, setOpenGroup] = useState<string | null>(null)
  const group = options.find((option) => option.id === openGroup)

  if (group?.children) {
    return (
      <div className="canvas-menu">
        <button type="button" className="canvas-menu__back" onClick={() => setOpenGroup(null)}>
          ← {group.label}
        </button>
        {group.children.map((child) => (
          <button
            key={child.id}
            type="button"
            className="canvas-menu__item"
            onClick={() => {
              onPick(child.id)
              onClose()
            }}
          >
            <b>{child.label}</b>
            {child.hint ? <small>{child.hint}</small> : null}
          </button>
        ))}
      </div>
    )
  }

  return (
    <div className="canvas-menu">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          className="canvas-menu__item"
          disabled={option.disabled}
          onClick={() => {
            if (option.disabled) return
            if (option.children) {
              setOpenGroup(option.id)
              return
            }
            onPick(option.id)
            onClose()
          }}
        >
          <b>
            {option.label}
            {option.children ? ' ›' : ''}
          </b>
          {option.hint ? <small>{option.hint}</small> : null}
        </button>
      ))}
    </div>
  )
}
