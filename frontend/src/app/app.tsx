import { useMemo } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router'

import {
  createCharacterApis,
  createGenerationApis,
  createProjectApis,
  createWorkflowRunStore,
} from '@/entities'
import { createWorkflowController } from '@/features/workflow-controller'
import { AssetLibraryPage } from '@/pages/asset-library'
import { HomePage } from '@/pages/home'
import { HistoryPage } from '@/pages/history'
import { NotFoundPage } from '@/pages/not-found'
import { PlaytestDemoPage } from '@/pages/playtest/demo-page'
import { PlaytestPage } from '@/pages/playtest'
import { ProjectDetailPage } from '@/pages/project-detail'
import { ProjectCreatePage } from '@/pages/project-create'
import { ProjectsPage } from '@/pages/projects'
import { QuickStartPage } from '@/pages/quick-start'
import { WorkflowEditorPage } from '@/pages/workflow-editor'
import { AppShell } from './layout'
import { createAutoPrepareProject, createQuickStartService } from '@/pages/quick-start/service'
import { createWorkflowEditorService } from '@/pages/workflow-editor/service'

function PlaytestFromBackend() {
  const apis = useMemo(() => ({ characters: createCharacterApis() }), [])
  return <PlaytestPage apis={apis} />
}

/**
 * 路由表与全局外壳。
 * 页面自己获取所需数据，不再由 app 层构造服务后逐层传入。
 */
export function App() {
  const services = useMemo(() => {
    const projectApis = createProjectApis()
    const characterApis = createCharacterApis()
    const generationApis = createGenerationApis()
    const store = createWorkflowRunStore()
    const controller = createWorkflowController({ store, generationApis })
    const quickStart = createQuickStartService({
      controller,
      prepareProject: createAutoPrepareProject(projectApis),
      characterApis,
      generationApis,
    })
    const workflowEditor = createWorkflowEditorService({
      controller,
      confirmCandidate: (runId, selectedImageUrl) =>
        quickStart.confirmCandidate(runId, selectedImageUrl),
      getProject: (projectId) => projectApis.get(projectId),
      approveReview: (runId) => quickStart.approveReview(runId),
      prepareProject: async (input) => {
        const project = await projectApis.create({
          name: input.projectName,
          perspective:
            input.view === 'topdown'
              ? 'top-down'
              : input.view === 'isometric'
                ? 'isometric'
                : 'side',
          directionalMovement:
            input.directions === '8'
              ? 'eight-way'
              : input.directions === '4'
                ? 'four-way'
                : 'single',
          spriteSize: { width: Number(input.canvasSize), height: Number(input.canvasSize) },
          gameStyle: input.style || null,
        })
        return { id: project.id, spriteSize: project.spriteSize }
      },
    })
    return { projectApis, characterApis, quickStart, workflowEditor, store }
  }, [])

  return (
    <BrowserRouter>
      <AppShell>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/quick-start" element={<QuickStartPage service={services.quickStart} />} />
          <Route
            path="/quick-start/:runId"
            element={<QuickStartPage service={services.quickStart} />}
          />
          <Route path="/projects" element={<ProjectsPage apis={services.projectApis} />} />
          <Route path="/projects/new" element={<ProjectCreatePage apis={services.projectApis} />} />
          <Route
            path="/projects/:projectId"
            element={<ProjectDetailPage apis={services.projectApis} />}
          />
          <Route
            path="/projects/:projectId/assets"
            element={<AssetLibraryPage apis={services.characterApis} />}
          />
          <Route path="/history" element={<HistoryPage store={services.store} />} />
          <Route
            path="/projects/:projectId/history"
            element={<HistoryPage store={services.store} />}
          />
          <Route
            path="/workflow-editor"
            element={<WorkflowEditorPage service={services.workflowEditor} />}
          />
          <Route
            path="/workflow-editor/:runId"
            element={<WorkflowEditorPage service={services.workflowEditor} />}
          />
          <Route
            path="/workflow-editor/:runId/:stepId"
            element={<WorkflowEditorPage service={services.workflowEditor} />}
          />
          <Route path="/playtest/demo" element={<PlaytestDemoPage />} />
          <Route path="/playtest/:characterId/:outfitId" element={<PlaytestFromBackend />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </AppShell>
    </BrowserRouter>
  )
}
