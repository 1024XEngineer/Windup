import { BrowserRouter, Route, Routes } from 'react-router'

import { AssetLibraryPage } from '@/pages/asset-library'
import { HomePage } from '@/pages/home'
import { NotFoundPage } from '@/pages/not-found'
import { PlaytestPage } from '@/pages/playtest'
import { ProjectDetailPage } from '@/pages/project-detail'
import { ProjectsPage } from '@/pages/projects'
import { QuickStartPage } from '@/pages/quick-start'
import { WorkflowEditorPage } from '@/pages/workflow-editor'
import type { AppServices } from './composition'
import { RouteErrorBoundary } from './error-boundary'
import { AppShell } from './layout'

/** 路由表与全局外壳。app 层只做启动与装配。 */
export function App({ services }: { services: AppServices }) {
  return (
    <BrowserRouter>
      <AppShell>
        <AppRoutes services={services} />
      </AppShell>
    </BrowserRouter>
  )
}

function AppRoutes({ services }: { services: AppServices }) {
  return (
    <RouteErrorBoundary>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/quick-start" element={<QuickStartPage quickStart={services.quickStart} />} />
        <Route
          path="/quick-start/:runId"
          element={<QuickStartPage quickStart={services.quickStart} />}
        />
        <Route path="/projects" element={<ProjectsPage repository={services.projects} />} />
        <Route
          path="/projects/:projectId"
          element={
            <ProjectDetailPage
              repository={services.projects}
              characters={services.characters}
              createWorkflowRun={(input) => services.workflowRuns.create(input)}
            />
          }
        />
        <Route path="/projects/:projectId/assets" element={<AssetLibraryPage />} />
        <Route
          path="/workflow-editor/:runId"
          element={
            <WorkflowEditorPage
              services={{
                workflowRuns: services.workflowRuns,
                productionEngine: services.productionEngine,
                workflowRestart: services.workflowRestart,
                workflowController: services.workflowController,
                imageUpload: services.imageUpload,
              }}
            />
          }
        />
        <Route
          path="/workflow-editor/:runId/:stage"
          element={
            <WorkflowEditorPage
              services={{
                workflowRuns: services.workflowRuns,
                productionEngine: services.productionEngine,
                workflowRestart: services.workflowRestart,
                workflowController: services.workflowController,
                imageUpload: services.imageUpload,
              }}
            />
          }
        />
        <Route
          path="/playtest/:characterId/:outfitId"
          element={
            <PlaytestPage
              characters={services.characters}
              inspections={services.playtestInspections}
            />
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </RouteErrorBoundary>
  )
}
