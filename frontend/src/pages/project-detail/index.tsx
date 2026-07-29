import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router'

import { CHARACTER_PERSPECTIVE, DIRECTIONAL_MOVEMENT, useProject } from '@/entities'
import type {
  Character,
  CharacterReader,
  CreateWorkflowRunInput,
  ProjectRepository,
  WorkflowRun,
} from '@/entities'
import { PageHeader } from '@/shared/ui'

/**
 * 单个项目的内容浏览：项目约束 + 项目下的全部内容（一期只角色，后续加动作模板、穿戴）。
 * 与项目列表是两页，07-22 会议要求两页都要有。
 */
export function ProjectDetailPage({
  repository,
  characters,
  createWorkflowRun,
}: {
  repository: ProjectRepository
  characters: CharacterReader
  createWorkflowRun: (input: CreateWorkflowRunInput) => Promise<WorkflowRun>
}) {
  const navigate = useNavigate()
  const { projectId = '' } = useParams()
  const { data: project, loading, error } = useProject(repository, projectId)
  const [projectCharacters, setProjectCharacters] = useState<Character[]>([])
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)

  useEffect(() => {
    if (!projectId) return
    let active = true
    void characters
      .listByProject(projectId)
      .then((items) => {
        if (active) setProjectCharacters(items)
      })
      .catch(() => {
        if (active) setProjectCharacters([])
      })
    return () => {
      active = false
    }
  }, [characters, projectId])

  async function startWorkflow(input: CreateWorkflowRunInput): Promise<void> {
    setStarting(true)
    setStartError(null)
    try {
      const run = await createWorkflowRun(input)
      const stage = input.purpose === 'add_action' ? '/action-setup' : ''
      navigate(`/workflow-editor/${encodeURIComponent(run.id)}${stage}`)
    } catch (reason) {
      setStartError(reason instanceof Error ? reason.message : '创建工作流失败')
    } finally {
      setStarting(false)
    }
  }

  return (
    <>
      <PageHeader
        title={project?.name ?? '项目'}
        subtitle={project ? `项目 ${project.id}` : undefined}
        onBack={() => navigate('/projects')}
        actions={
          project ? (
            <button
              type="button"
              disabled={starting}
              onClick={() =>
                void startWorkflow({
                  projectId: project.id,
                  driver: 'manual',
                  purpose: 'create_character',
                })
              }
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-40"
            >
              开始工作流
            </button>
          ) : null
        }
      />
      {loading ? <p className="text-sm text-slate-400">加载中…</p> : null}
      {error ? <p className="text-sm text-red-500">加载失败：{error.message}</p> : null}
      {project ? (
        <>
          <dl className="mb-6 grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
            <dt className="text-slate-500">精灵尺寸</dt>
            <dd>
              {project.spriteSize.width}×{project.spriteSize.height}
            </dd>
            <dt className="text-slate-500">视角</dt>
            <dd>{CHARACTER_PERSPECTIVE[project.perspective]}</dd>
            <dt className="text-slate-500">移动方向</dt>
            <dd>{DIRECTIONAL_MOVEMENT[project.directionalMovement]}</dd>
            <dt className="text-slate-500">画风</dt>
            <dd>{project.gameStyle ?? '未设置'}</dd>
          </dl>
          {startError ? <p className="text-sm text-red-600">启动失败：{startError}</p> : null}
          <section className="mt-6 space-y-3" aria-label="项目角色">
            <h2 className="font-medium">角色</h2>
            {projectCharacters.length === 0 ? (
              <p className="text-sm text-slate-400">当前项目还没有角色。</p>
            ) : (
              projectCharacters.map((character) => (
                <article key={character.id} className="rounded-lg border border-slate-200 p-4">
                  <p className="font-medium">{character.name}</p>
                  {character.outfits.map((outfit) => (
                    <button
                      key={outfit.id}
                      type="button"
                      disabled={
                        starting || !outfit.characterTemplateUrl || outfit.baseFrames.length === 0
                      }
                      onClick={() =>
                        outfit.characterTemplateUrl && outfit.baseFrames.length > 0
                          ? void startWorkflow({
                              projectId: project.id,
                              driver: 'manual',
                              purpose: 'add_action',
                              characterId: character.id,
                              outfitId: outfit.id,
                              characterTemplateUrl: outfit.characterTemplateUrl,
                              baseFrameUrls: outfit.baseFrames.map((frame) => frame.imageUrl),
                            })
                          : undefined
                      }
                      className="mt-2 rounded border border-slate-300 px-3 py-2 text-sm"
                    >
                      为 {outfit.name} 添加动作
                    </button>
                  ))}
                </article>
              ))
            )}
          </section>
          <button
            type="button"
            onClick={() => navigate(`/projects/${encodeURIComponent(project.id)}/assets`)}
            className="mt-3 rounded-lg border border-slate-200 px-4 py-2 text-sm hover:border-slate-400"
          >
            查看本项目资产库
          </button>
        </>
      ) : null}
    </>
  )
}
