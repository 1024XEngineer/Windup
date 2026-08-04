import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'

import type { Action, ActionType, Character, Outfit } from '@/entities'
import { mockCharacterApis, useExtractedAssets } from '@/pages/asset-library/mock'

const ACTION_TYPE_LABELS: Record<ActionType, string> = {
  walk: '行走',
  idle: '待机',
  attack: '攻击',
  jump: '跳跃',
  custom: '自定义',
}

function actionPreviewUrl(action: Action) {
  const firstFrame = action.frames[0]?.imageUrl ?? ''
  return firstFrame.replace(/(?:idle|walk)-01\.png$/, `${action.type}-preview.gif`)
}

export function CharacterDetailPage() {
  const { projectId, characterId } = useParams()
  const [character, setCharacter] = useState<Character | null>(null)
  const [selectedOutfitId, setSelectedOutfitId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    if (!projectId || !characterId) {
      setError('缺少角色定位信息')
      return () => {
        active = false
      }
    }

    setCharacter(null)
    setSelectedOutfitId(null)
    setError(null)
    void mockCharacterApis.get(characterId).then(
      (nextCharacter) => {
        if (!active) return
        if (nextCharacter.projectId !== projectId) {
          setError('这个角色不属于当前项目')
          return
        }
        setCharacter(nextCharacter)
        setSelectedOutfitId(nextCharacter.outfits[0]?.id ?? null)
      },
      () => {
        if (active) setError('这个角色不存在或暂时无法读取')
      },
    )

    return () => {
      active = false
    }
  }, [characterId, projectId])

  if (error) {
    return (
      <p
        role="alert"
        className="m-6 rounded-xl border border-[#d8c7bd] bg-[#fff8f2] p-5 text-sm text-[#7a3f2a]"
      >
        {error}
      </p>
    )
  }

  if (!character) {
    return <p className="p-6 text-sm text-[#70766f]">正在读取角色资产…</p>
  }

  const selectedOutfit =
    character.outfits.find((outfit) => outfit.id === selectedOutfitId) ??
    character.outfits[0] ??
    null

  return (
    <section aria-labelledby="character-title" className="p-4 lg:px-6 lg:py-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Link
            to={`/projects/${projectId}/assets`}
            className="text-xs font-semibold text-[#657066] underline decoration-[#b9c0b8] underline-offset-4 hover:text-[#263f2d]"
          >
            返回资产库
          </Link>
          <h2
            id="character-title"
            className="mt-2 text-2xl font-semibold tracking-[-0.035em] text-[#20241f]"
          >
            {character.name}
          </h2>
          <p className="mt-1 text-xs text-[#6d736c]">选择动作卡片，展开帧并直接提取资产。</p>
        </div>
        {selectedOutfit ? (
          <label className="flex items-center gap-2 text-xs font-medium text-[#697169]">
            <span>造型</span>
            <select
              aria-label="选择造型"
              value={selectedOutfit.id}
              onChange={(event) => setSelectedOutfitId(event.target.value)}
              className="rounded-full border border-[#ccd2ca] bg-white px-3 py-2 text-sm font-semibold text-[#2e382f] outline-none focus:border-[#748478]"
            >
              {character.outfits.map((outfit) => (
                <option key={outfit.id} value={outfit.id}>
                  {outfit.name} · {outfit.actions.length} 动作
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      {character.outfits.length === 0 || !selectedOutfit ? (
        <div className="mt-6 rounded-[1.5rem] border border-dashed border-[#cbd0c8] bg-[#f8f8f4] p-7">
          <h3 className="font-semibold text-[#252a25]">这个角色还没有造型</h3>
        </div>
      ) : (
        <>
          <div className="mt-3">
            <OutfitMaster character={character} outfit={selectedOutfit} />
          </div>

          <ActionList character={character} outfit={selectedOutfit} />
        </>
      )}
    </section>
  )
}

function OutfitMaster({ character, outfit }: { character: Character; outfit: Outfit }) {
  return (
    <section aria-labelledby="outfit-master-title" className="flex min-w-0 items-center gap-4 py-2">
      <div className="h-28 w-28 shrink-0 sm:h-32 sm:w-32">
        {outfit.characterTemplateUrl ? (
          <img
            src={outfit.characterTemplateUrl}
            alt={`${character.name}的${outfit.name}母版`}
            className="h-full w-full object-contain [image-rendering:pixelated]"
          />
        ) : (
          <div className="flex h-full items-center justify-center bg-[linear-gradient(135deg,#eceee7_25%,#f7f6f1_25%,#f7f6f1_50%,#eceee7_50%,#eceee7_75%,#f7f6f1_75%)] bg-[length:28px_28px]">
            <span className="rounded-full border border-[#b7bdb4] bg-[#fbfaf6]/90 px-3 py-1 text-xs font-semibold text-[#5f685f]">
              母版未定稿
            </span>
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div>
          <h3
            id="outfit-master-title"
            className="text-lg font-semibold tracking-[-0.03em] text-[#222722]"
          >
            {outfit.name}
          </h3>
          <p className="mt-1 text-xs leading-5 text-[#6a716a]">
            母版是这套造型后续动作生成与一致性检查的视觉基准。
          </p>
        </div>
        <p className="mt-2 text-[0.7rem] font-medium text-[#687068]">
          母版{outfit.characterTemplateUrl ? '已确认' : '待确认'} · {outfit.actions.length} 个动作
        </p>
      </div>
    </section>
  )
}

function ActionList({ character, outfit }: { character: Character; outfit: Outfit }) {
  const { add: addExtractedAsset } = useExtractedAssets()
  const [pickerOpen, setPickerOpen] = useState(false)
  const [selectedActionId, setSelectedActionId] = useState<string | null>(null)
  const [extractionStatus, setExtractionStatus] = useState<string | null>(null)
  const selectedAction = outfit.actions.find((action) => action.id === selectedActionId) ?? null

  function saveActionTemplate(action: Action) {
    addExtractedAsset({
      kind: 'action',
      name: `${action.name}模板`,
      source: `${character.name} / ${outfit.name} / ${action.name}`,
      previewImageUrl: actionPreviewUrl(action),
      sourceAction: action,
    })
    setExtractionStatus(`已将「${action.name}」保存为动作模板（演示）`)
  }

  return (
    <section aria-labelledby="action-list-title" className="mt-3">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-[0.66rem] font-semibold uppercase tracking-[0.18em] text-[#7a827a]">
            Action instances
          </p>
          <h3 id="action-list-title" className="mt-0.5 text-lg font-semibold text-[#252a25]">
            动作与帧
          </h3>
        </div>
        <span className="text-[0.7rem] text-[#7c837b]">点击卡片展开完整帧</span>
      </div>

      {outfit.actions.length === 0 ? (
        <div className="mt-4 rounded-[1.5rem] border border-dashed border-[#cbd0c8] bg-[#f8f8f4] p-7">
          <h4 className="font-semibold text-[#252a25]">这个造型还没有动作</h4>
          <p className="mt-2 text-sm leading-6 text-[#6d736c]">
            母版已经就位，可以从这里继续补充第一个动作。
          </p>
        </div>
      ) : (
        <>
          <div
            aria-label="动作卡组"
            className="mt-2 flex min-h-44 items-start overflow-x-auto px-2 pb-4 pt-3"
          >
            {outfit.actions.map((action, index) => {
              const expanded = selectedAction?.id === action.id
              return (
                <article
                  key={action.id}
                  aria-label={`动作 ${action.name}`}
                  className={`group relative w-44 shrink-0 transition-[transform,margin] duration-500 ease-[cubic-bezier(.2,.9,.25,1)] ${index ? '-ml-9' : ''} ${expanded ? '-translate-y-1 rotate-0' : index % 2 ? 'translate-y-1 rotate-[2deg]' : 'rotate-[-2deg]'}`}
                  style={{ zIndex: expanded ? outfit.actions.length + 1 : index + 1 }}
                >
                  <button
                    type="button"
                    aria-label={`${expanded ? '收起' : '展开'}${action.name}`}
                    aria-expanded={expanded}
                    onClick={() => {
                      setSelectedActionId(expanded ? null : action.id)
                      setExtractionStatus(null)
                    }}
                    className={`block w-full overflow-hidden rounded-[1.4rem] border bg-white text-left transition duration-500 group-hover:-translate-y-2 ${expanded ? 'border-[#718876] ring-4 ring-[#dfe8df]' : 'border-[#cfd5cd]'}`}
                  >
                    <div className="relative aspect-[16/10] overflow-hidden bg-[#eef1ec]">
                      <img
                        src={actionPreviewUrl(action)}
                        alt={`${action.name}动画预览`}
                        className="h-full w-full object-contain p-2 [image-rendering:pixelated]"
                      />
                      <span className="absolute right-3 top-3 rounded-full bg-white/90 px-2 py-1 text-[0.62rem] font-semibold text-[#516054]">
                        GIF
                      </span>
                    </div>
                    <div className="p-3">
                      <div className="flex items-center justify-between gap-3">
                        <h4 className="font-semibold text-[#252b25]">{action.name}</h4>
                        <span className="text-sm text-[#69756b]">{expanded ? '−' : '↗'}</span>
                      </div>
                      <p className="mt-1 text-xs text-[#747b73]">
                        {ACTION_TYPE_LABELS[action.type]} · {action.fps} FPS ·{' '}
                        {action.frames.length} 帧
                      </p>
                    </div>
                  </button>
                </article>
              )
            })}
          </div>

          {selectedAction ? (
            <section
              aria-label={`${selectedAction.name}完整帧序列`}
              className="animate-[action-reveal_520ms_cubic-bezier(.2,.9,.25,1)] overflow-hidden rounded-[1.35rem] border border-[#d6dbd4] bg-white p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="text-lg font-semibold text-[#242924]">{selectedAction.name}</h4>
                    <span className="rounded-full bg-[#edf0ea] px-2.5 py-1 text-[0.68rem] font-semibold text-[#566258]">
                      {ACTION_TYPE_LABELS[selectedAction.type]}
                    </span>
                    {selectedAction.keyFrameIndex !== null ? (
                      <span className="rounded-full border border-[#d8c89e] bg-[#fff9e9] px-2.5 py-1 text-[0.68rem] font-semibold text-[#74613c]">
                        关键帧 {selectedAction.keyFrameIndex + 1}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-2 text-xs text-[#747b73]">
                    {selectedAction.fps} FPS · {selectedAction.frames.length} 帧
                  </p>
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => saveActionTemplate(selectedAction)}
                    className="rounded-full bg-[#263f2d] px-3 py-1.5 text-xs font-semibold text-white"
                  >
                    保存为动作模板
                  </button>
                  <Link
                    to={`/playtest/${character.id}/${outfit.id}`}
                    className="rounded-full border border-[#bdc4ba] px-3 py-1.5 text-xs font-semibold text-[#435047] hover:border-[#6e796f]"
                  >
                    预览{selectedAction.name}
                  </Link>
                  <button
                    type="button"
                    className="rounded-full border border-[#bdc4ba] px-3 py-1.5 text-xs font-semibold text-[#435047] hover:border-[#6e796f]"
                  >
                    重新生成
                  </button>
                </div>
              </div>
              <p className="mt-2 text-[0.68rem] font-medium text-[#687068]">
                {character.name} / {outfit.name} / {selectedAction.name}
              </p>
              <div className="mt-3 overflow-x-auto pb-1">
                <ol className="flex min-w-max gap-2.5">
                  {selectedAction.frames.map((frame, index) => (
                    <li key={`${selectedAction.id}-${index}`} className="w-20 shrink-0">
                      <div
                        className={`overflow-hidden rounded-xl border ${index === selectedAction.keyFrameIndex ? 'border-[#a78a4f] ring-2 ring-[#ead9a5]/55' : 'border-[#dde0d9]'}`}
                      >
                        <img
                          src={frame.imageUrl}
                          alt={`${selectedAction.name}第 ${index + 1} 帧`}
                          className="aspect-square w-full object-contain p-1 [image-rendering:pixelated]"
                        />
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-1 text-[0.65rem] text-[#7b827a]">
                        <span>#{String(index + 1).padStart(2, '0')}</span>
                        <span>
                          {frame.durationMs === null
                            ? `按 ${selectedAction.fps} FPS`
                            : `${frame.durationMs} ms`}
                        </span>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
              {extractionStatus ? (
                <p role="status" className="mt-2 text-xs font-medium text-[#315039]">
                  {extractionStatus}
                </p>
              ) : null}
            </section>
          ) : null}
        </>
      )}

      <button
        type="button"
        onClick={() => setPickerOpen(true)}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-[1.1rem] border border-dashed border-[#aeb6ac] px-4 py-2 text-xs font-semibold text-[#435047] transition hover:border-[#6e796f]"
      >
        <span aria-hidden="true" className="text-lg font-light">
          ＋
        </span>
        加动作
      </button>
      {pickerOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="生成新动作"
          className="mt-4 rounded-xl border border-[#cfd6ce] bg-white p-5 shadow-[0_18px_45px_rgba(35,44,36,0.12)]"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <h4 className="font-semibold text-[#252b25]">生成新动作</h4>
              <p className="mt-1 text-xs text-[#727a72]">
                新动作由生成工作流产出；动作模板复用将在 WorkflowEditor 的增加节点中提供。
              </p>
            </div>
            <button
              type="button"
              aria-label="关闭新动作面板"
              onClick={() => setPickerOpen(false)}
              className="rounded-md px-2 py-1 text-[#6f786f] hover:bg-[#f1f3ef]"
            >
              ×
            </button>
          </div>
          <button
            type="button"
            className="mt-4 rounded-full bg-[#263f2d] px-4 py-2 text-xs font-semibold text-white"
          >
            前往生成工作流
          </button>
        </div>
      ) : null}
    </section>
  )
}
