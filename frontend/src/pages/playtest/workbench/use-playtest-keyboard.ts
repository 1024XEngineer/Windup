import { useEffect, useRef } from 'react'

export interface PlaytestKeyboardCommands {
  togglePlaying(): void
  previousFrame(): void
  nextFrame(): void
  firstFrame(): void
  lastFrame(): void
  toggleLoop(): void
  playLeft(): void
  playRight(): void
  stopHorizontal(): void
  playJump(): void
  playCrouch(): void
}

function isTextEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false

  if (target.closest('input, textarea, select') !== null) return true

  const editableAncestor = target.closest('[contenteditable]')
  return (
    editableAncestor !== null &&
    editableAncestor.getAttribute('contenteditable')?.toLowerCase() !== 'false'
  )
}

function isButtonTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.closest('button') !== null
}

export function usePlaytestKeyboard(commands: PlaytestKeyboardCommands, enabled: boolean): void {
  const heldHorizontalKeys = useRef(new Set<'a' | 'd'>())

  useEffect(() => {
    if (!enabled) return

    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
      if (isTextEditingTarget(event.target)) return
      if (isButtonTarget(event.target) && key !== 'a' && key !== 'd' && key !== 'w' && key !== 's')
        return

      const command = {
        ' ': commands.togglePlaying,
        ArrowLeft: commands.previousFrame,
        ArrowRight: commands.nextFrame,
        Home: commands.firstFrame,
        End: commands.lastFrame,
        l: commands.toggleLoop,
        a: commands.playLeft,
        d: commands.playRight,
        w: commands.playJump,
        s: commands.playCrouch,
      }[key]

      if (command === undefined) return

      event.preventDefault()
      if (event.repeat && (key === ' ' || key === 'l' || key === 'w' || key === 's')) {
        return
      }
      if (key === 'a' || key === 'd') heldHorizontalKeys.current.add(key)
      command()
    }

    const stopHorizontal = () => {
      if (heldHorizontalKeys.current.size === 0) return
      heldHorizontalKeys.current.clear()
      commands.stopHorizontal()
    }

    const onKeyUp = (event: KeyboardEvent) => {
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
      if (key !== 'a' && key !== 'd') return
      if (!heldHorizontalKeys.current.delete(key)) return
      event.preventDefault()
      if (heldHorizontalKeys.current.size === 0) commands.stopHorizontal()
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', stopHorizontal)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', stopHorizontal)
    }
  }, [commands, enabled])
}
