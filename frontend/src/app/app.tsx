import { BrowserRouter, Route, Routes } from 'react-router'

import { AssetLibraryPage } from '@/pages/asset-library'
import { HomePage } from '@/pages/home'
import { NotFoundPage } from '@/pages/not-found'
import { PlaytestPage } from '@/pages/playtest'
import { ProjectDetailPage } from '@/pages/project-detail'
import { ProjectsPage } from '@/pages/projects'
import { QuickStartPage } from '@/pages/quick-start'
import { WorkflowEditorPage } from '@/pages/workflow-editor'
import { AppShellRoute } from './layout'

/**
 * 路由表与全局外壳。
 * 页面自己获取所需数据，不再由 app 层构造服务后逐层传入。
 * 外壳的边界画在这张表上：全部路由都在里面，包括根路由——顶栏悬浮不占高度，
 * 首屏仍是满幅，同时首页也才有通往项目资产的常驻入口。
 */
export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShellRoute />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/quick-start" element={<QuickStartPage />} />
          <Route path="/quick-start/:runId" element={<QuickStartPage />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/projects/:projectId" element={<ProjectDetailPage />} />
          <Route path="/projects/:projectId/assets" element={<AssetLibraryPage />} />
          <Route path="/workflow-editor/:runId" element={<WorkflowEditorPage />} />
          <Route path="/workflow-editor/:runId/:stage" element={<WorkflowEditorPage />} />
          <Route path="/playtest/:characterId/:outfitId" element={<PlaytestPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
