import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router'

import type {
  CharacterReader,
  Outfit,
  PlaytestInspectionRepository,
  PlaytestInspectionStatus,
} from '@/entities'
import { PageHeader } from '@/shared/ui'
import { InspectionPreview } from './inspection-preview'

/** Playtest 只保存独立核验记录，不修改 Character、WorkflowRun 或产物。 */
export function PlaytestPage({
  characters,
  inspections,
}: {
  characters: CharacterReader
  inspections: PlaytestInspectionRepository
}) {
  const navigate = useNavigate()
  const { characterId = '', outfitId = '' } = useParams()
  const [search] = useSearchParams()
  const runId = search.get('runId') ?? ''
  const revisionId = search.get('revision') ?? ''
  const initialActionId = search.get('actionId') ?? undefined
  const [status, setStatus] = useState<PlaytestInspectionStatus | null>(null)
  const [outfit, setOutfit] = useState<Outfit | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!characterId || !outfitId) return
    let active = true
    void Promise.all([
      characters.get(characterId),
      inspections.getLatest({ characterId, outfitId }),
    ])
      .then(([character, latest]) => {
        if (!active) return
        const targetOutfit = character.outfits.find((item) => item.id === outfitId)
        if (!targetOutfit) throw new Error('角色中不存在指定造型')
        setOutfit(targetOutfit)
        setStatus(latest?.status ?? null)
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : '读取核验数据失败')
      })
    return () => {
      active = false
    }
  }, [characterId, characters, inspections, outfitId])

  async function recordStatus(nextStatus: PlaytestInspectionStatus): Promise<void> {
    if (saving) return
    setSaving(true)
    setSaveError(null)
    try {
      const inspection = await inspections.record({
        characterId,
        outfitId,
        source: runId && revisionId ? { runId, revisionId } : null,
        status: nextStatus,
      })
      setStatus(inspection.status)
    } catch (reason) {
      setSaveError(reason instanceof Error ? reason.message : '核验记录保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <PageHeader
        title="核验台"
        subtitle={`角色 ${characterId || '（无）'}`}
        onBack={() => navigate(-1)}
      />
      {!characterId || !outfitId ? (
        <p className="text-sm text-red-600">缺少角色或造型参数，无法确定核验目标。</p>
      ) : error ? (
        <p className="text-sm text-red-600">加载失败：{error}</p>
      ) : !outfit ? (
        <p className="text-sm text-slate-500">正在读取角色造型…</p>
      ) : (
        <InspectionPreview
          characterId={characterId}
          outfit={outfit}
          initialActionId={initialActionId}
          status={status}
          saving={saving}
          saveError={saveError}
          onRecordStatus={recordStatus}
          onOpenReview={
            runId && revisionId
              ? () =>
                  navigate(
                    `/workflow-editor/${encodeURIComponent(runId)}/review?revision=${encodeURIComponent(revisionId)}`,
                  )
              : undefined
          }
        />
      )}
    </>
  )
}
