import { BrowserRouter, Navigate, Route, Routes } from 'react-router'

import { AssetLibraryPage } from '@/pages/asset-library'
import { CharacterDetailPage } from '@/pages/character-detail'
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
 * 外壳的边界画在这张表上：首页与流程页使用全局顶栏；项目工作区使用自己的
 * 项目导航，不重复套全局外壳。
 */
export function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  )
}

/** 路由声明独立导出，测试用 MemoryRouter 验证直达地址。 */
export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppShellRoute />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/quick-start" element={<QuickStartPage />} />
        <Route path="/quick-start/:runId" element={<QuickStartPage />} />
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/workflow-editor/:runId" element={<WorkflowEditorPage />} />
        <Route path="/workflow-editor/:runId/:stage" element={<WorkflowEditorPage />} />
        <Route path="/playtest/:characterId/:outfitId" element={<PlaytestPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
      <Route path="/projects/:projectId" element={<ProjectDetailPage />}>
        <Route index element={<Navigate replace to="assets" />} />
        <Route path="assets" element={<AssetLibraryPage />} />
        <Route path="assets/:characterId" element={<CharacterDetailPage />} />
      </Route>
    </Routes>
  )
}
