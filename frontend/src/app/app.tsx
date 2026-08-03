import { useMemo } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router'

import { createCharacterApis, createPlaytestInspectionApis, createProjectApis } from '@/entities'
import { AssetLibraryPage } from '@/pages/asset-library'
import { HomePage } from '@/pages/home'
import { NotFoundPage } from '@/pages/not-found'
import { PlaytestPage } from '@/pages/playtest'
import { PlaytestCatalogPage } from '@/pages/playtest/catalog'
import { ProjectDetailPage } from '@/pages/project-detail'
import { ProjectsPage } from '@/pages/projects'
import { QuickStartPage } from '@/pages/quick-start'
import { WorkflowEditorPage } from '@/pages/workflow-editor'
import { AppShell } from './layout'

function PlaytestFromBackend() {
  const apis = useMemo(
    () => ({
      characters: createCharacterApis(),
      projects: createProjectApis(),
      inspections: createPlaytestInspectionApis(),
    }),
    [],
  )

  return <PlaytestPage apis={apis} />
}

/**
 * 路由表与全局外壳。
 * 页面自己获取所需数据，不再由 app 层构造服务后逐层传入。
 */
export function App() {
  const catalogApis = useMemo(
    () => ({ projects: createProjectApis(), characters: createCharacterApis() }),
    [],
  )

  return (
    <BrowserRouter>
      <AppShell>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/quick-start" element={<QuickStartPage />} />
          <Route path="/quick-start/:runId" element={<QuickStartPage />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/projects/:projectId" element={<ProjectDetailPage />} />
          <Route path="/projects/:projectId/assets" element={<AssetLibraryPage />} />
          <Route path="/workflow-editor/:runId" element={<WorkflowEditorPage />} />
          <Route path="/workflow-editor/:runId/:stage" element={<WorkflowEditorPage />} />
          <Route path="/playtest" element={<PlaytestCatalogPage apis={catalogApis} />} />
          <Route path="/playtest/:characterId/:outfitId" element={<PlaytestFromBackend />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </AppShell>
    </BrowserRouter>
  )
}
