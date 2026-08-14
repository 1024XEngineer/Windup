import { useRef, useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router'

import {
  CHARACTER_PERSPECTIVE,
  DIRECTIONAL_MOVEMENT,
  projectApis,
  workflowRunApis,
  type CharacterPerspective,
  type DirectionalMovement,
  type Project,
  type WorkflowNode,
} from '@/entities'
import { ApiError, getApiAccessToken } from '@/shared/api'
import { ProjectCreatePixelMark } from './pixel-mark'

/**
 * 项目名称上限跟随 main 上 `windup_project.project_name` 的 `String(20)`。
 * 尚未合入的两个后端 PR 在这里不一致（PR 75 限 20、PR 126 放宽到 64），取更严的一边，
 * 哪条先落地都能提交成功；放宽是加法，反过来会立刻退回重名与截断。
 */
const NAME_MAX_LENGTH = 20

/**
 * 精灵宽高的合法区间。写在前端是因为 main 的后端还没有 `/projects` 路由，
 * 取值依据是 Issue 141 的产品规则（与未合入的 PR 75 / PR 126 请求校验一致）。
 */
const SPRITE_MIN = 32
const SPRITE_MAX = 2048

/** 常用档位只是快捷填充，用户仍可以填这三档之外的任意合法宽高。 */
const SPRITE_PRESETS = [128, 256, 512]

/**
 * 画风约束的长度上限只存在于前端：后端 `game_style` 是没有长度约束的 Text。
 * 定这个数是为了让它维持在「一句风格描述」的量级，不是契约要求。
 */
const GAME_STYLE_MAX_LENGTH = 240

/** 创建真实项目；首页画布入口与项目中心的新建按钮共用这一页。 */
export function ProjectCreatePage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const opensWorkflowEditor = searchParams.get('entry') === 'workflow-editor'
  /**
   * 能不能建项目只取决于有没有登录：后端 `/projects` 不在鉴权白名单里，
   * 归属也从 access token 里取。登录模块尚未接入时没有人注册 provider，
   * 这里拿到 null，入口保持禁用并写明原因，不塞占位值让它看起来能用。
   */
  const signedIn = Boolean(getApiAccessToken())

  const [name, setName] = useState('')
  const [perspective, setPerspective] = useState<CharacterPerspective>('side')
  const [directionalMovement, setDirectionalMovement] = useState<DirectionalMovement>('single')
  const [spriteWidth, setSpriteWidth] = useState('256')
  const [spriteHeight, setSpriteHeight] = useState('256')
  const [gameStyle, setGameStyle] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [createdProject, setCreatedProject] = useState<Project | null>(null)
  /** 同一批事件里 submitting 还是上一次 render 的值，按钮变灰之前的重复提交只能靠这个挡。 */
  const inFlight = useRef(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (inFlight.current || !signedIn) return

    const trimmedName = name.trim()
    const width = Number(spriteWidth)
    const height = Number(spriteHeight)
    if (createdProject === null) {
      if (!trimmedName) return setError('请填写项目名称')
      if (trimmedName.length > NAME_MAX_LENGTH)
        return setError(`项目名称最多 ${NAME_MAX_LENGTH} 个字`)
      if (![width, height].every(isLegalSpriteLength)) {
        return setError(`精灵宽高需要是 ${SPRITE_MIN} 到 ${SPRITE_MAX} 之间的整数`)
      }
    }

    inFlight.current = true
    setSubmitting(true)
    setError(null)
    let project = createdProject
    try {
      if (project === null) {
        project = await projectApis.create({
          name: trimmedName,
          perspective,
          directionalMovement,
          spriteSize: { width, height },
          gameStyle: gameStyle.trim() || null,
        })
        if (opensWorkflowEditor) setCreatedProject(project)
      }
      if (opensWorkflowEditor) {
        const workflow = await workflowRunApis.create({
          projectId: project.id,
          nodes: initialWorkflowNodes(),
        })
        navigate(`/workflow-editor/${encodeURIComponent(workflow.id)}`)
        return
      }
      navigate(`/projects/${project.id}`)
    } catch (cause) {
      // 业务错误（如重名）由后端给出具体原因，原样转达；传输错误对用户没有信息量，收敛成一句。
      setError(
        opensWorkflowEditor && project !== null
          ? '项目已创建，但工作流暂时无法创建'
          : cause instanceof ApiError && cause.kind === 'business'
            ? cause.message
            : '项目暂时无法创建',
      )
      inFlight.current = false
      setSubmitting(false)
    }
  }

  return (
    <div className="grid min-h-[calc(100vh-4rem)] w-full bg-app-canvas text-app-ink lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
      <aside className="hidden place-content-center justify-items-center gap-8 px-10 pb-16 pt-24 lg:grid">
        <ProjectCreatePixelMark />
        <p className="max-w-72 text-center text-xs leading-6 text-app-muted">
          项目决定角色资产的视角、朝向与精灵尺寸。这些约束建立之后会跟着项目下的每一个角色。
        </p>
      </aside>

      {/* pt-24 与 PageContainer 同源：给 fixed 顶栏（top-3.5 加最小高 3.625rem）让位，改顶栏尺寸时一起改。 */}
      <section className="bg-app-surface-raised/70 px-6 pb-12 pt-24 sm:px-12 lg:px-16 lg:pb-20 lg:pt-28">
        <form
          noValidate
          onSubmit={submit}
          onChange={() => setError(null)}
          className="mx-auto grid max-w-2xl gap-7"
        >
          <header>
            <p className="font-mono text-[10px] font-semibold tracking-[0.18em] text-app-faint">
              PROJECT SETUP
            </p>
            <h1 className="mt-3 font-serif text-4xl font-medium tracking-[-0.045em]">新建项目</h1>
            <p className="mt-3 text-sm leading-6 text-app-muted">
              只确定项目级的题材与规格；角色和动作在项目内再逐个创建。
            </p>
          </header>

          <div className="grid gap-2">
            <label className="text-xs font-semibold text-app-ink-soft" htmlFor="project-name">
              项目名称
            </label>
            <input
              id="project-name"
              value={name}
              disabled={createdProject !== null}
              maxLength={NAME_MAX_LENGTH}
              placeholder="例如：雾港来信"
              onChange={(event) => setName(event.target.value)}
              className="rounded-xl border border-app-line bg-app-surface px-4 py-3 text-sm outline-none focus-visible:border-app-accent"
            />
            <small className="text-[10px] text-app-faint">
              最多 {NAME_MAX_LENGTH} 个字，同一账号下不能重名。
            </small>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <div className="grid gap-2">
              <label
                className="text-xs font-semibold text-app-ink-soft"
                htmlFor="project-perspective"
              >
                游戏视角
              </label>
              <select
                id="project-perspective"
                value={perspective}
                disabled={createdProject !== null}
                onChange={(event) => setPerspective(event.target.value as CharacterPerspective)}
                className="rounded-xl border border-app-line bg-app-surface px-4 py-3 text-sm outline-none focus-visible:border-app-accent"
              >
                {Object.entries(CHARACTER_PERSPECTIVE).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-2">
              <label className="text-xs font-semibold text-app-ink-soft" htmlFor="project-movement">
                朝向
              </label>
              <select
                id="project-movement"
                value={directionalMovement}
                disabled={createdProject !== null}
                onChange={(event) =>
                  setDirectionalMovement(event.target.value as DirectionalMovement)
                }
                className="rounded-xl border border-app-line bg-app-surface px-4 py-3 text-sm outline-none focus-visible:border-app-accent"
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
            <legend className="text-xs font-semibold text-app-ink-soft">精灵尺寸</legend>
            <div className="flex flex-wrap gap-2">
              {SPRITE_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  disabled={createdProject !== null}
                  onClick={() => {
                    setSpriteWidth(String(preset))
                    setSpriteHeight(String(preset))
                    // 按钮点击不是表单的 change 事件，收不到表单上那个清错误的处理，只能自己清。
                    setError(null)
                  }}
                  aria-pressed={spriteWidth === String(preset) && spriteHeight === String(preset)}
                  className="rounded-full border border-app-line px-4 py-1.5 text-xs text-app-ink-soft aria-pressed:border-app-accent aria-pressed:bg-app-accent aria-pressed:text-app-on-accent"
                >
                  {preset} × {preset}
                </button>
              ))}
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="grid gap-2">
                <label className="text-[10px] text-app-faint" htmlFor="project-sprite-width">
                  宽度（像素）
                </label>
                <input
                  id="project-sprite-width"
                  type="number"
                  inputMode="numeric"
                  min={SPRITE_MIN}
                  max={SPRITE_MAX}
                  value={spriteWidth}
                  disabled={createdProject !== null}
                  onChange={(event) => setSpriteWidth(event.target.value)}
                  className="rounded-xl border border-app-line bg-app-surface px-4 py-3 text-sm outline-none focus-visible:border-app-accent"
                />
              </div>
              <div className="grid gap-2">
                <label className="text-[10px] text-app-faint" htmlFor="project-sprite-height">
                  高度（像素）
                </label>
                <input
                  id="project-sprite-height"
                  type="number"
                  inputMode="numeric"
                  min={SPRITE_MIN}
                  max={SPRITE_MAX}
                  value={spriteHeight}
                  disabled={createdProject !== null}
                  onChange={(event) => setSpriteHeight(event.target.value)}
                  className="rounded-xl border border-app-line bg-app-surface px-4 py-3 text-sm outline-none focus-visible:border-app-accent"
                />
              </div>
            </div>
          </fieldset>

          <div className="grid gap-2">
            <label className="text-xs font-semibold text-app-ink-soft" htmlFor="project-style">
              画风约束
            </label>
            <textarea
              id="project-style"
              rows={3}
              value={gameStyle}
              disabled={createdProject !== null}
              maxLength={GAME_STYLE_MAX_LENGTH}
              placeholder="例如：低饱和像素风、细长比例、深灰旅行服"
              onChange={(event) => setGameStyle(event.target.value)}
              className="resize-none rounded-xl border border-app-line bg-app-surface px-4 py-3 text-sm outline-none focus-visible:border-app-accent"
            />
          </div>

          {error ? (
            <p
              role="alert"
              className="rounded-xl border border-app-danger-line bg-app-danger-soft px-4 py-3 text-sm text-app-danger"
            >
              {error}
            </p>
          ) : null}

          <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-app-line pt-6">
            <small
              id="project-create-hint"
              className="max-w-sm text-[11px] leading-5 text-app-muted"
            >
              {signedIn
                ? opensWorkflowEditor
                  ? createdProject
                    ? '项目已经创建；重试只会继续创建工作流，不会重复创建项目。'
                    : '创建项目和初始工作流后，直接进入工作流画布。'
                  : '创建后进入该项目的资产工作区。'
                : '创建项目需要先登录。登录模块尚未接入，创建入口暂时保持关闭。'}
            </small>
            <button
              type="submit"
              disabled={submitting || !signedIn}
              aria-describedby="project-create-hint"
              className="rounded-full bg-app-accent px-6 py-3 text-sm font-semibold text-app-on-accent hover:bg-app-accent-hover disabled:cursor-not-allowed disabled:bg-app-line-strong"
            >
              {submitting
                ? createdProject
                  ? '正在重试…'
                  : '正在创建…'
                : createdProject
                  ? '重试进入工作流'
                  : '创建项目'}
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

/** 手动画布从角色设定开始，节点关系与 Workflow Editor 的正式入口契约一致。 */
function initialWorkflowNodes(): WorkflowNode[] {
  return [
    {
      id: 'character-setup',
      type: 'character-setup',
      status: 'active',
      phase: 'configuring',
      dependsOnNodeIds: [],
      generations: [],
      error: null,
      input: { prompt: '', referenceMedia: [] },
    },
    {
      id: 'character-template',
      type: 'character-template',
      status: 'locked',
      phase: 'ready',
      dependsOnNodeIds: ['character-setup'],
      generations: [],
      error: null,
      selectedImageUrl: null,
    },
  ]
}
