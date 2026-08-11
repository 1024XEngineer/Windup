import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router'

import { AssetLibraryPage } from '@/pages/asset-library'
import { CharacterDetailPage } from '@/pages/character-detail'
import { HomePage } from '@/pages/home'
import { NotFoundPage } from '@/pages/not-found'
import { PlaytestPage } from '@/pages/playtest'
import { ProjectDetailPage } from '@/pages/project-detail'
import { ProjectCreatePage } from '@/pages/project-create'
import { ProjectsPage } from '@/pages/projects'
import { QuickStartPage } from '@/pages/quick-start'
import { ProtectedRoute } from '@/features/auth-guard'
import { AppShellRoute } from './layout'

const WorkflowEditorPage = lazy(() =>
  import('@/pages/workflow-editor').then(({ WorkflowEditorPage: Page }) => ({ default: Page })),
)

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

function LazyWorkflowEditorPage() {
  return (
    <Suspense fallback={<div aria-label="正在加载工作流编辑器" />}>
      <WorkflowEditorPage />
    </Suspense>
  )
}

/** 路由声明独立导出，测试用 MemoryRouter 验证直达地址。 */
export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppShellRoute />}>
        <Route path="/" element={<HomePage />} />
        <Route element={<ProtectedRoute />}>
          <Route path="/quick-start" element={<QuickStartPage />} />
          <Route path="/quick-start/:runId" element={<QuickStartPage />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/projects/new" element={<ProjectCreatePage />} />
          <Route path="/workflow-editor/:runId" element={<LazyWorkflowEditorPage />} />
          <Route path="/workflow-editor/:runId/:stage" element={<LazyWorkflowEditorPage />} />
          <Route path="/playtest/:characterId/:outfitId" element={<PlaytestPage />} />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Route>
      <Route element={<ProtectedRoute />}>
        <Route path="/projects/:projectId" element={<ProjectDetailPage />}>
          <Route index element={<Navigate replace to="assets" />} />
          <Route path="assets" element={<AssetLibraryPage />} />
          <Route path="assets/:characterId" element={<CharacterDetailPage />} />
        </Route>
      </Route>
    </Routes>
  )
}
