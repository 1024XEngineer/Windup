import { BrowserRouter, Route, Routes } from 'react-router'

import { HomePage } from '@/pages/home'
import { HistoryPage } from '@/pages/history'
import { NotFoundPage } from '@/pages/not-found'
import { PlaytestDemoPage } from '@/pages/playtest/demo-page'
import { PlaytestPage } from '@/pages/playtest'
import { ProjectDetailPage } from '@/pages/project-detail'
import { ProjectsPage } from '@/pages/projects'
import { QuickStartPage } from '@/pages/quick-start'
import { WorkflowEditorPage } from '@/pages/workflow-editor'
import { AppShell } from './layout'

/**
 * 路由表与全局外壳。
 * 页面自己获取所需数据，不再由 app 层构造服务后逐层传入。
 */
export function App() {
  return (
    <BrowserRouter>
      <AppShell>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/quick-start" element={<QuickStartPage />} />
          <Route path="/quick-start/:runId" element={<QuickStartPage />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/projects/:projectId" element={<ProjectDetailPage />} />
          <Route path="/projects/:projectId/history" element={<HistoryPage />} />
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
