import { BrowserRouter, Route, Routes } from 'react-router'

import { AssetLibraryPage } from '@/pages/asset-library'
import { HomePage } from '@/pages/home'
import { NotFoundPage } from '@/pages/not-found'
import { PlaytestPage } from '@/pages/playtest'
import { ProjectDetailPage } from '@/pages/project-detail'
import { ProjectsPage } from '@/pages/projects'
import { QuickStartPage } from '@/pages/quick-start'
import { WorkflowEditorPage } from '@/pages/workflow-editor'
import { RouteErrorBoundary } from './error-boundary'
import { AppShell } from './layout'

/** 路由表与全局外壳。app 层只做启动与装配。 */
export function App() {
  return (
    <BrowserRouter>
      <AppShell>
        <AppRoutes />
      </AppShell>
    </BrowserRouter>
  )
}

function AppRoutes() {
  return (
    <RouteErrorBoundary>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/quick-start" element={<QuickStartPage />} />
        <Route path="/quick-start/:runId" element={<QuickStartPage />} />
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/projects/:projectId" element={<ProjectDetailPage />} />
        <Route path="/projects/:projectId/assets" element={<AssetLibraryPage />} />
        <Route path="/workflow-editor/:runId" element={<WorkflowEditorPage />} />
        <Route path="/workflow-editor/:runId/:stage" element={<WorkflowEditorPage />} />
        <Route path="/playtest/:characterId" element={<PlaytestPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </RouteErrorBoundary>
  )
}
