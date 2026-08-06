import { useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'

import {
  CHARACTER_PERSPECTIVE,
  DIRECTIONAL_MOVEMENT,
  projectApis,
  type CharacterPerspective,
  type DirectionalMovement,
} from '@/entities'
import { ApiError, getCurrentUserId } from '@/shared/api'
import { ProjectCreatePixelMark } from './pixel-mark'

/**
 * 项目名称上限跟随后端 `windup_project.project_name` 的 String(20)。
 * 后端 PR #126 想放宽到 64，这里按更严的一边取值，两种契约下都能提交成功。
 */
const NAME_MAX_LENGTH = 20

/** 精灵宽高的合法区间由后端 ProjectCreate 的 Field(ge=32, le=2048) 决定。 */
const SPRITE_MIN = 32
const SPRITE_MAX = 2048

/** 常用档位只是快捷填充，用户仍可以填这三档之外的任意合法宽高。 */
const SPRITE_PRESETS = [128, 256, 512]

const GAME_STYLE_MAX_LENGTH = 240

/** 创建真实项目；首页画布入口与项目中心的新建按钮共用这一页。 */
export function ProjectCreatePage() {
  const navigate = useNavigate()
  const ownerId = getCurrentUserId()

  const [name, setName] = useState('')
  const [perspective, setPerspective] = useState<CharacterPerspective>('side')
  const [directionalMovement, setDirectionalMovement] = useState<DirectionalMovement>('single')
  const [spriteWidth, setSpriteWidth] = useState('256')
  const [spriteHeight, setSpriteHeight] = useState('256')
  const [gameStyle, setGameStyle] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** 同一批事件里 submitting 还是上一次 render 的值，按钮变灰之前的重复提交只能靠这个挡。 */
  const inFlight = useRef(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (inFlight.current || !ownerId) return

    const trimmedName = name.trim()
    const width = Number(spriteWidth)
    const height = Number(spriteHeight)
    if (!trimmedName) return setError('请填写项目名称')
    if (trimmedName.length > NAME_MAX_LENGTH)
      return setError(`项目名称最多 ${NAME_MAX_LENGTH} 个字`)
    if (![width, height].every(isLegalSpriteLength)) {
      return setError(`精灵宽高需要是 ${SPRITE_MIN} 到 ${SPRITE_MAX} 之间的整数`)
    }

    inFlight.current = true
    setSubmitting(true)
    setError(null)
    try {
      const project = await projectApis.create({
        ownerId,
        name: trimmedName,
        perspective,
        directionalMovement,
        spriteSize: { width, height },
        gameStyle: gameStyle.trim() || null,
      })
      navigate(`/projects/${project.id}`)
    } catch (cause) {
      // 业务错误（如重名）由后端给出具体原因，原样转达；传输错误对用户没有信息量，收敛成一句。
      setError(
        cause instanceof ApiError && cause.kind === 'business' ? cause.message : '项目暂时无法创建',
      )
      inFlight.current = false
      setSubmitting(false)
    }
  }

  return (
    <div className="grid min-h-[calc(100vh-4rem)] w-full bg-[#e5e8e3] text-[#191b18] lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
      <aside className="hidden place-content-center justify-items-center gap-8 px-10 pb-16 pt-24 lg:grid">
        <ProjectCreatePixelMark />
        <p className="max-w-72 text-center text-xs leading-6 text-[#747973]">
          项目决定角色资产的视角、朝向与精灵尺寸。这些约束建立之后会跟着项目下的每一个角色。
        </p>
      </aside>

      {/* pt-24 与 PageContainer 同源：给 fixed 顶栏（top-3.5 加最小高 3.625rem）让位，改顶栏尺寸时一起改。 */}
      <section className="bg-white/70 px-6 pb-12 pt-24 sm:px-12 lg:px-16 lg:pb-20 lg:pt-28">
        <form
          noValidate
          onSubmit={submit}
          onChange={() => setError(null)}
          className="mx-auto grid max-w-2xl gap-7"
        >
          <header>
            <p className="font-mono text-[10px] font-semibold tracking-[0.18em] text-[#8b9089]">
              PROJECT SETUP
            </p>
            <h1 className="mt-3 font-serif text-4xl font-medium tracking-[-0.045em]">新建项目</h1>
            <p className="mt-3 text-sm leading-6 text-[#666b64]">
              只确定项目级的题材与规格；角色和动作在项目内再逐个创建。
            </p>
          </header>

          <div className="grid gap-2">
            <label className="text-xs font-semibold text-[#41473f]" htmlFor="project-name">
              项目名称
            </label>
            <input
              id="project-name"
              value={name}
              maxLength={NAME_MAX_LENGTH}
              placeholder="例如：雾港来信"
              onChange={(event) => setName(event.target.value)}
              className="rounded-xl border border-[#d5d9d2] bg-[#f5f5f2] px-4 py-3 text-sm outline-none focus-visible:border-[#8f978d]"
            />
            <small className="text-[10px] text-[#8b9089]">
              最多 {NAME_MAX_LENGTH} 个字，同一账号下不能重名。
            </small>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <div className="grid gap-2">
              <label className="text-xs font-semibold text-[#41473f]" htmlFor="project-perspective">
                游戏视角
              </label>
              <select
                id="project-perspective"
                value={perspective}
                onChange={(event) => setPerspective(event.target.value as CharacterPerspective)}
                className="rounded-xl border border-[#d5d9d2] bg-[#f5f5f2] px-4 py-3 text-sm outline-none focus-visible:border-[#8f978d]"
              >
                {Object.entries(CHARACTER_PERSPECTIVE).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-2">
              <label className="text-xs font-semibold text-[#41473f]" htmlFor="project-movement">
                朝向
              </label>
              <select
                id="project-movement"
                value={directionalMovement}
                onChange={(event) =>
                  setDirectionalMovement(event.target.value as DirectionalMovement)
                }
                className="rounded-xl border border-[#d5d9d2] bg-[#f5f5f2] px-4 py-3 text-sm outline-none focus-visible:border-[#8f978d]"
              >
                {Object.entries(DIRECTIONAL_MOVEMENT).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <fieldset className="grid gap-3">
            <legend className="text-xs font-semibold text-[#41473f]">精灵尺寸</legend>
            <div className="flex flex-wrap gap-2">
              {SPRITE_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => {
                    setSpriteWidth(String(preset))
                    setSpriteHeight(String(preset))
                  }}
                  aria-pressed={spriteWidth === String(preset) && spriteHeight === String(preset)}
                  className="rounded-full border border-[#d5d9d2] px-4 py-1.5 text-xs text-[#41473f] aria-pressed:border-[#252825] aria-pressed:bg-[#252825] aria-pressed:text-white"
                >
                  {preset} × {preset}
                </button>
              ))}
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="grid gap-2">
                <label className="text-[10px] text-[#8b9089]" htmlFor="project-sprite-width">
                  宽度（像素）
                </label>
                <input
                  id="project-sprite-width"
                  type="number"
                  inputMode="numeric"
                  min={SPRITE_MIN}
                  max={SPRITE_MAX}
                  value={spriteWidth}
                  onChange={(event) => setSpriteWidth(event.target.value)}
                  className="rounded-xl border border-[#d5d9d2] bg-[#f5f5f2] px-4 py-3 text-sm outline-none focus-visible:border-[#8f978d]"
                />
              </div>
              <div className="grid gap-2">
                <label className="text-[10px] text-[#8b9089]" htmlFor="project-sprite-height">
                  高度（像素）
                </label>
                <input
                  id="project-sprite-height"
                  type="number"
                  inputMode="numeric"
                  min={SPRITE_MIN}
                  max={SPRITE_MAX}
                  value={spriteHeight}
                  onChange={(event) => setSpriteHeight(event.target.value)}
                  className="rounded-xl border border-[#d5d9d2] bg-[#f5f5f2] px-4 py-3 text-sm outline-none focus-visible:border-[#8f978d]"
                />
              </div>
            </div>
          </fieldset>

          <div className="grid gap-2">
            <label className="text-xs font-semibold text-[#41473f]" htmlFor="project-style">
              画风约束
            </label>
            <textarea
              id="project-style"
              rows={3}
              value={gameStyle}
              maxLength={GAME_STYLE_MAX_LENGTH}
              placeholder="例如：低饱和像素风、细长比例、深灰旅行服"
              onChange={(event) => setGameStyle(event.target.value)}
              className="resize-none rounded-xl border border-[#d5d9d2] bg-[#f5f5f2] px-4 py-3 text-sm outline-none focus-visible:border-[#8f978d]"
            />
          </div>

          {error ? (
            <p
              role="alert"
              className="rounded-xl border border-[#d8c7bd] bg-[#fff8f2] px-4 py-3 text-sm text-[#7a3f2a]"
            >
              {error}
            </p>
          ) : null}

          <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-[#d8dbd4] pt-6">
            <small id="project-create-hint" className="max-w-sm text-[11px] leading-5 text-[#747973]">
              {ownerId
                ? '创建后进入该项目的资产工作区。'
                : '登录模块尚未接入，暂时拿不到当前账号，创建入口保持关闭。'}
            </small>
            <button
              type="submit"
              disabled={submitting || !ownerId}
              aria-describedby="project-create-hint"
              className="rounded-full bg-[#252825] px-6 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-[#a4aaa2]"
            >
              {submitting ? '正在创建…' : '创建项目'}
            </button>
          </footer>
        </form>
      </section>
    </div>
  )
}

function isLegalSpriteLength(value: number) {
  return Number.isSafeInteger(value) && value >= SPRITE_MIN && value <= SPRITE_MAX
}
