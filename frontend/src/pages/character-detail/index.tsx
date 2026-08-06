import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'

import { characterApis, type Action, type Character, type Outfit } from '@/entities'

const ACTION_TYPE_LABELS: Record<string, string> = {
  walk: '行走',
  idle: '待机',
  attack: '攻击',
  custom: '自定义',
}

function actionTypeLabel(type: string) {
  return ACTION_TYPE_LABELS[type] ?? type
}

function orderedFrames(action: Action) {
  return [...action.frames].sort((left, right) => left.index - right.index)
}

function characterName(character: Character) {
  return character.name ?? '未命名角色'
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
    void characterApis.get(characterId).then(
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
  if (!character) return <p className="p-6 text-sm text-[#70766f]">正在读取角色资产…</p>

  const name = characterName(character)
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
            {name}
          </h2>
          <p className="mt-1 text-xs text-[#6d736c]">选择动作卡片查看完整帧序列。</p>
        </div>
        <div className="flex flex-col items-end gap-2">
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
          <div className="text-right">
            <button
              type="button"
              disabled
              aria-label="导出资产包"
              className="cursor-not-allowed rounded-full border border-[#cbd1c8] px-3 py-1.5 text-xs font-semibold text-[#858c84]"
            >
              导出资产包
            </button>
            <p className="mt-1 max-w-xs text-[0.62rem] text-[#858c84]">
              导出能力待 PR #97 合并并完成资产字段接线
            </p>
          </div>
        </div>
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
          <ActionList key={selectedOutfit.id} character={character} outfit={selectedOutfit} />
        </>
      )}
    </section>
  )
}

function OutfitMaster({ character, outfit }: { character: Character; outfit: Outfit }) {
  const name = characterName(character)
  return (
    <section aria-labelledby="outfit-master-title" className="flex min-w-0 items-center gap-4 py-2">
      <div className="h-28 w-28 shrink-0 sm:h-32 sm:w-32">
        {outfit.previewUrl ? (
          <img
            src={outfit.previewUrl}
            alt={`${name}的${outfit.name}预览`}
            className="h-full w-full object-contain [image-rendering:pixelated]"
          />
        ) : (
          <div className="flex h-full items-center justify-center bg-[linear-gradient(135deg,#eceee7_25%,#f7f6f1_25%,#f7f6f1_50%,#eceee7_50%,#eceee7_75%,#f7f6f1_75%)] bg-[length:28px_28px]">
            <span className="rounded-full border border-[#b7bdb4] bg-[#fbfaf6]/90 px-3 py-1 text-xs font-semibold text-[#5f685f]">
              暂无造型预览
            </span>
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <h3
          id="outfit-master-title"
          className="text-lg font-semibold tracking-[-0.03em] text-[#222722]"
        >
          {outfit.name}
        </h3>
        {outfit.description ? (
          <p className="mt-1 text-xs leading-5 text-[#6a716a]">{outfit.description}</p>
        ) : null}
        <p className="mt-2 text-[0.7rem] font-medium text-[#687068]">
          {outfit.actions.length} 个动作
        </p>
      </div>
    </section>
  )
}

function ActionList({ character, outfit }: { character: Character; outfit: Outfit }) {
  const [selectedActionId, setSelectedActionId] = useState<string | null>(null)
  const selectedAction = outfit.actions.find((action) => action.id === selectedActionId) ?? null

  return (
    <section aria-labelledby="action-list-title" className="mt-3">
      <div className="flex items-end justify-between gap-4">
        <h3 id="action-list-title" className="text-lg font-semibold text-[#252a25]">
          动作与帧
        </h3>
        <div className="flex items-center gap-3">
          <span className="text-[0.7rem] text-[#7c837b]">点击卡片展开完整帧</span>
          <button
            type="button"
            aria-label="增加动作"
            disabled
            title="动作生成应进入 Workflow Editor"
            className="cursor-not-allowed rounded-full border border-[#cbd1c8] px-3 py-1.5 text-xs font-semibold text-[#858c84]"
          >
            ＋ 增加动作
          </button>
        </div>
      </div>

      {outfit.actions.length === 0 ? (
        <div className="mt-4 rounded-[1.5rem] border border-dashed border-[#cbd0c8] bg-[#f8f8f4] p-7">
          <h4 className="font-semibold text-[#252a25]">这个造型还没有动作</h4>
          <p className="mt-2 text-sm leading-6 text-[#6d736c]">生成并保存动作后会显示在这里。</p>
        </div>
      ) : (
        <>
          <div
            aria-label="动作卡组"
            className="mt-2 flex min-h-44 items-start overflow-x-auto px-2 pb-4 pt-3"
          >
            {outfit.actions.map((action, index) => {
              const expanded = selectedAction?.id === action.id
              const previewFrame = orderedFrames(action)[0]
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
                    onClick={() => setSelectedActionId(expanded ? null : action.id)}
                    className={`block w-full overflow-hidden rounded-[1.4rem] border bg-white text-left transition duration-500 group-hover:-translate-y-2 ${expanded ? 'border-[#718876] ring-4 ring-[#dfe8df]' : 'border-[#cfd5cd]'}`}
                  >
                    <div className="relative aspect-[16/10] overflow-hidden bg-[#eef1ec]">
                      {previewFrame ? (
                        <img
                          src={previewFrame.imageUrl}
                          alt={`${action.name}帧预览`}
                          className="h-full w-full object-contain p-2 [image-rendering:pixelated]"
                        />
                      ) : (
                        <span className="grid h-full place-items-center text-xs text-[#687068]">
                          暂无帧
                        </span>
                      )}
                    </div>
                    <div className="p-3">
                      <div className="flex items-center justify-between gap-3">
                        <h4 className="font-semibold text-[#252b25]">{action.name}</h4>
                        <span className="text-sm text-[#69756b]">{expanded ? '−' : '↗'}</span>
                      </div>
                      <p className="mt-1 text-xs text-[#747b73]">
                        {actionTypeLabel(action.type)} · {action.fps} FPS · {action.frameCount} 帧 ·{' '}
                        {action.loop ? '循环' : '单次'}
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
              className="action-reveal overflow-hidden rounded-[1.35rem] border border-[#d6dbd4] bg-white p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="text-lg font-semibold text-[#242924]">{selectedAction.name}</h4>
                    <span className="rounded-full bg-[#edf0ea] px-2.5 py-1 text-[0.68rem] font-semibold text-[#566258]">
                      {actionTypeLabel(selectedAction.type)}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-[#747b73]">
                    {selectedAction.fps} FPS · {selectedAction.frameCount} 帧 ·{' '}
                    {selectedAction.loop ? '循环播放' : '单次播放'}
                  </p>
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    aria-label={`重新生成${selectedAction.name}`}
                    disabled
                    title="需要原 WorkflowRun 的版本与步骤上下文"
                    className="cursor-not-allowed rounded-full border border-[#d8dcd5] px-3 py-1.5 text-xs font-semibold text-[#959b94]"
                  >
                    重新生成
                  </button>
                  <button
                    type="button"
                    disabled
                    aria-label="保存为动作模板"
                    title="动作模板后端未提供"
                    className="cursor-not-allowed rounded-full border border-[#d8dcd5] px-3 py-1.5 text-xs font-semibold text-[#959b94]"
                  >
                    保存为动作模板
                  </button>
                </div>
              </div>
              <p className="mt-2 text-[0.65rem] text-[#8a9088]">动作模板后端未提供</p>
              <p className="mt-2 text-[0.68rem] font-medium text-[#687068]">
                {characterName(character)} / {outfit.name} / {selectedAction.name}
              </p>
              <div className="mt-3 overflow-x-auto pb-1">
                <ol className="flex min-w-max gap-2.5">
                  {orderedFrames(selectedAction).map((frame) => (
                    <li key={`${selectedAction.id}-${frame.index}`} className="w-20 shrink-0">
                      <div className="overflow-hidden rounded-xl border border-[#dde0d9]">
                        <img
                          src={frame.imageUrl}
                          alt={`${selectedAction.name}第 ${frame.index + 1} 帧`}
                          className="aspect-square w-full object-contain p-1 [image-rendering:pixelated]"
                        />
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-1 text-[0.65rem] text-[#7b827a]">
                        <span>#{String(frame.index + 1).padStart(2, '0')}</span>
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
            </section>
          ) : null}
        </>
      )}
    </section>
  )
}
