import {
  createProject,
  createWorkflowRun,
  type CreateProjectInput,
  type CreateWorkflowRunInput,
  type Project,
  type WorkflowRun,
} from '@/entities'
import {
  planMvpQuickStartProject,
  type QuickStartInput,
  type QuickStartProjectPlanner,
} from './model/project-planner'

export interface QuickStartDependencies {
  planProject: QuickStartProjectPlanner
  createProject: (input: CreateProjectInput) => Promise<Project>
  createWorkflowRun: (input: CreateWorkflowRunInput) => Promise<WorkflowRun>
}

export interface QuickStartStartResult {
  project: Project
  run: WorkflowRun
}

export function createQuickStartStarter(dependencies: QuickStartDependencies) {
  return async (input: QuickStartInput): Promise<QuickStartStartResult> => {
    const prompt = input.prompt.trim()
    if (!prompt) throw new Error('请先描述要制作的角色。')

    const project = await dependencies.createProject(
      await dependencies.planProject({ ...input, prompt }),
    )
    const run = await dependencies.createWorkflowRun({
      projectId: project.id,
      driver: 'ai',
      prompt,
    })
    return { project, run }
  }
}

export const startQuickStart = createQuickStartStarter({
  planProject: planMvpQuickStartProject,
  createProject,
  createWorkflowRun,
})
