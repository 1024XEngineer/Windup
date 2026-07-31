import { useMemo } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router'

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
import {
  createProjectApis,
  createGenerationApis,
  createTaskApis,
} from './adapters'
import { createRealQuickStartService } from '@/pages/quick-start/service'

/**
 * 路由表与全局外壳。
 * 页面自己获取所需数据，不再由 app 层构造服务后逐层传入。
 */
export function App() {
  const quickStartService = useMemo(() => {
    const projectApis = createProjectApis()
    const generationApis = createGenerationApis()
    const taskApis = createTaskApis()
    return createRealQuickStartService({ projectApis, generationApis, taskApis })
  }, [])

  return (
    <BrowserRouter>
      <AppShell>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/quick-start" element={<QuickStartPage service={quickStartService} />} />
          <Route path="/quick-start/:runId" element={<QuickStartPage service={quickStartService} />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/projects/new" element={<ProjectCreatePage />} />
          <Route path="/projects/:projectId" element={<ProjectDetailPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/projects/:projectId/history" element={<HistoryPage />} />
          <Route path="/workflow-editor" element={<WorkflowEditorPage />} />
          <Route path="/workflow-editor/:runId" element={<WorkflowEditorPage />} />
          <Route path="/workflow-editor/:runId/:stage" element={<WorkflowEditorPage />} />
          <Route path="/playtest/demo" element={<PlaytestDemoPage />} />
          <Route path="/playtest/:characterId/:outfitId" element={<PlaytestPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </AppShell>
    </BrowserRouter>
  )
}
