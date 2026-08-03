import { useCallback, useEffect, useRef, useState } from 'react'

import type {
  PlaytestInspectionApis,
  PlaytestInspectionStatus,
  PlaytestInspectionTarget,
} from '@/entities/playtest-inspection'

interface PlaytestInspectionState {
  status: PlaytestInspectionStatus | null
  loading: boolean
  saving: boolean
  error: string | null
}

const EMPTY_STATE: PlaytestInspectionState = {
  status: null,
  loading: false,
  saving: false,
  error: null,
}

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message.trim() ? cause.message : fallback
}

export function usePlaytestInspection(
  apis: Pick<PlaytestInspectionApis, 'get' | 'save'> | undefined,
  target: PlaytestInspectionTarget | null,
) {
  const [state, setState] = useState<PlaytestInspectionState>(EMPTY_STATE)
  const operationId = useRef(0)

  useEffect(() => {
    const currentOperation = ++operationId.current
    if (apis === undefined || target === null) {
      setState(EMPTY_STATE)
      return
    }

    let active = true
    setState({ ...EMPTY_STATE, loading: true })
    void apis.get(target).then(
      (inspection) => {
        if (active && operationId.current === currentOperation) {
          setState({ ...EMPTY_STATE, status: inspection?.status ?? null })
        }
      },
      (cause: unknown) => {
        if (active && operationId.current === currentOperation) {
          setState({
            ...EMPTY_STATE,
            error: errorMessage(cause, '核验记录读取失败'),
          })
        }
      },
    )

    return () => {
      active = false
    }
  }, [apis, target])

  const save = useCallback(
    async (status: PlaytestInspectionStatus) => {
      if (apis === undefined || target === null) return

      const currentOperation = ++operationId.current
      setState((current) => ({ ...current, saving: true, error: null }))
      try {
        const inspection = await apis.save({ ...target, status })
        if (operationId.current === currentOperation) {
          setState({ ...EMPTY_STATE, status: inspection.status })
        }
      } catch (cause) {
        if (operationId.current === currentOperation) {
          setState((current) => ({
            ...current,
            saving: false,
            error: errorMessage(cause, '核验记录保存失败'),
          }))
        }
      }
    },
    [apis, target],
  )

  return { ...state, save, available: apis !== undefined && target !== null }
}
