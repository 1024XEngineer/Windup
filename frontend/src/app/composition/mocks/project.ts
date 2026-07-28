import type { CreateProjectInput, Project, ProjectRepository } from '@/entities'

const SEED_PROJECTS: Project[] = [
  {
    id: '1',
    ownerId: '1',
    workflowId: null,
    name: '像素小骑士',
    perspective: 'side',
    directionalMovement: 'four-way',
    spriteSize: { width: 64, height: 64 },
    gameStyle: '16-bit 像素、暖色调',
    sampleImageUrl: null,
    createdAt: '2026-07-25T10:00:00Z',
    updatedAt: '2026-07-25T10:00:00Z',
  },
  {
    id: '2',
    ownerId: '1',
    workflowId: null,
    name: '森林精灵',
    perspective: 'top-down',
    directionalMovement: 'single',
    spriteSize: { width: 64, height: 64 },
    gameStyle: null,
    sampleImageUrl: null,
    createdAt: '2026-07-26T09:30:00Z',
    updatedAt: '2026-07-26T09:30:00Z',
  },
]

export interface CreateMemoryProjectRepositoryOptions {
  /** 开发界面可用延迟观察加载态；测试直接传 0。 */
  latencyMs?: number
  /** 允许测试固定时间，不从环境变量推断行为。 */
  now?: () => string
}

function cloneProject(project: Project): Project {
  return { ...project, spriteSize: { ...project.spriteSize } }
}

/** 开发专用假实现：模拟业务端口，不模仿 URL 或 HTTP 响应壳。 */
export function createMemoryProjectRepository({
  latencyMs = 0,
  now = () => new Date().toISOString(),
}: CreateMemoryProjectRepositoryOptions = {}): ProjectRepository {
  const store = new Map(SEED_PROJECTS.map((project) => [project.id, cloneProject(project)]))
  let nextId = 3

  async function waitForLatency(): Promise<void> {
    if (latencyMs > 0) await new Promise((resolve) => setTimeout(resolve, latencyMs))
  }

  return {
    adapterKind: 'mock',

    async list(query = {}) {
      await waitForLatency()
      const page = query.page ?? 1
      const pageSize = query.pageSize ?? 20
      const projects = [...store.values()].sort((left, right) => Number(right.id) - Number(left.id))
      const start = (page - 1) * pageSize
      return {
        items: projects.slice(start, start + pageSize).map(cloneProject),
        total: projects.length,
        page,
        pageSize,
      }
    },

    async get(id) {
      await waitForLatency()
      const project = store.get(id)
      if (!project) throw new Error('项目不存在')
      return cloneProject(project)
    },

    async create(input: CreateProjectInput) {
      await waitForLatency()
      if ([...store.values()].some((project) => project.name === input.name)) {
        throw new Error('项目名称已存在')
      }
      const timestamp = now()
      const project: Project = {
        id: String(nextId++),
        ownerId: '1',
        workflowId: null,
        name: input.name,
        perspective: input.perspective,
        directionalMovement: input.directionalMovement,
        spriteSize: { ...input.spriteSize },
        gameStyle: input.gameStyle ?? null,
        sampleImageUrl: input.sampleImageUrl ?? null,
        createdAt: timestamp,
        updatedAt: timestamp,
      }
      store.set(project.id, project)
      return cloneProject(project)
    },

    async remove(id) {
      await waitForLatency()
      if (!store.delete(id)) throw new Error('项目不存在')
    },
  }
}
