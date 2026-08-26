import { ArrowBendDownLeft } from '@phosphor-icons/react'
import type { ComponentPropsWithoutRef } from 'react'

type InlineArrowActionProps = Omit<ComponentPropsWithoutRef<'button'>, 'children' | 'type'> & {
  children: string
}

export function InlineArrowAction({ children, ...props }: InlineArrowActionProps) {
  return (
    <button
      {...props}
      type="button"
      data-inline-arrow-action
      className="group inline-flex min-h-8 w-fit items-center gap-2 rounded-full pr-2 text-xs text-app-muted transition hover:text-app-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent disabled:cursor-not-allowed disabled:opacity-45"
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-full transition group-hover:bg-app-surface-muted">
        <ArrowBendDownLeft aria-hidden="true" size={17} weight="bold" />
      </span>
      <span>{children}</span>
    </button>
  )
}
