import { lazy, Suspense, useMemo } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router'

import {
  createCharacterApis,
  createGenerationApis,
  createMediaApis,
  createPlaytestInspectionApis,
  createProjectApis,
  createUserApis,
  createWorkflowRunStore,
  type UserApis,
} from '@/entities'
import {
  AuthModeProvider,
  ProtectedRoute,
  createLocalUserApis,
  resolveAuthMode,
} from '@/features/auth-session'
import { createWorkflowController } from '@/features/workflow-controller'
import { AssetLibraryPage } from '@/pages/asset-library'
import { CharacterDetailPage } from '@/pages/character-detail'
import { HomePage } from '@/pages/home'
import { HistoryPage } from '@/pages/history'
import { NotFoundPage } from '@/pages/not-found'
import { PlaytestEntryPage } from '@/pages/playtest/entry'
import { PlaytestPage } from '@/pages/playtest'
import { ProjectDetailPage } from '@/pages/project-detail'
import { ProjectCreatePage } from '@/pages/projects/create-page'
import { ProjectsPage } from '@/pages/projects'
import { QuickStartPage } from '@/pages/quick-start'
import { WorkflowEditorPage } from '@/pages/workflow-editor'
import { AppShell } from './layout'
import { createAutoPrepareProject, createQuickStartService } from '@/pages/quick-start/service'
import { createWorkflowEditorService } from '@/pages/workflow-editor/service'
import { request } from '@/shared/api'

const PlaytestDemoPage = import.meta.env.DEV
  ? lazy(() =>
      import('@/pages/playtest/demo-page').then(({ PlaytestDemoPage }) => ({
        default: PlaytestDemoPage,
      })),
    )
  : null

/**
 * 路由表与全局外壳。
 * App 只装配一次共享接口实例，再把页面所需的最小接口集合传入对应路由。
 */
export function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  )
}

/** 路由声明独立导出，测试可在 MemoryRouter 中验证直达地址。 */
export function AppRoutes({ userApis }: { userApis?: UserApis } = {}) {
  const authMode = resolveAuthMode()
  const services = useMemo(() => {
    const sharedUserApis =
      userApis ?? (authMode === 'backend' ? createUserApis() : createLocalUserApis())
    const projectApis = createProjectApis()
    const characterApis = createCharacterApis()
    const inspectionApis = createPlaytestInspectionApis()
    const generationApis = createGenerationApis()
    const mediaApis = createMediaApis()
    const store = createWorkflowRunStore({
      api: {
        fetch: (input, init) => request(typeof input === 'string' ? input : input.url, init),
      },
    })
    const controller = createWorkflowController({ store, generationApis, characterApis })
    const quickStart = createQuickStartService({
      controller,
      prepareProject: createAutoPrepareProject(projectApis),
      characterApis,
      mediaApis,
    })
    const workflowEditor = createWorkflowEditorService({
      controller,
      mediaApis,
      getProject: (projectId) => projectApis.get(projectId),
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
    const playtestApis = {
      projects: projectApis,
      characters: characterApis,
      inspections: inspectionApis,
      deleteAsset: (characterId: string, outfitId: string) =>
        controller.deleteOutfitAsset(characterId, outfitId),
      deleteAction: (characterId: string, outfitId: string, actionId: string) =>
        controller.deletePublishedAction(characterId, outfitId, actionId),
    }
    return {
      userApis: sharedUserApis,
      projectApis,
      characterApis,
      quickStart,
      workflowEditor,
      store,
      playtestApis,
    }
  }, [authMode, userApis])

  return (
    // 本地与真实认证共用会话和页面，差异只留在这里的适配器装配。
    <AuthModeProvider apis={services.userApis}>
      <AppShell>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route
            path="/quick-start"
            element={
              <ProtectedRoute>
                <QuickStartPage service={services.quickStart} />
              </ProtectedRoute>
            }
          />
          <Route
            path="/quick-start/:runId"
            element={
              <ProtectedRoute>
                <QuickStartPage service={services.quickStart} />
              </ProtectedRoute>
            }
          />
          <Route
            path="/projects"
            element={
              <ProtectedRoute>
                <ProjectsPage apis={services.projectApis} />
              </ProtectedRoute>
            }
          />
          <Route
            path="/projects/new"
            element={
              <ProtectedRoute>
                <ProjectCreatePage apis={services.projectApis} />
              </ProtectedRoute>
            }
          />
          <Route
            path="/projects/:projectId"
            element={
              <ProtectedRoute>
                <ProjectDetailPage
                  projectApis={services.projectApis}
                  characterApis={services.characterApis}
                />
              </ProtectedRoute>
            }
          >
            <Route index element={<Navigate replace to="assets" />} />
            <Route path="assets" element={<AssetLibraryPage apis={services.characterApis} />} />
            <Route
              path="assets/:characterId"
              element={<CharacterDetailPage apis={services.characterApis} />}
            />
          </Route>
          <Route
            path="/history"
            element={
              <ProtectedRoute>
                <HistoryPage store={services.store} />
              </ProtectedRoute>
            }
          />
          <Route
            path="/projects/:projectId/history"
            element={
              <ProtectedRoute>
                <HistoryPage store={services.store} />
              </ProtectedRoute>
            }
          />
          <Route
            path="/workflow-editor"
            element={
              <ProtectedRoute>
                <WorkflowEditorPage service={services.workflowEditor} />
              </ProtectedRoute>
            }
          />
          <Route
            path="/workflow-editor/:runId"
            element={
              <ProtectedRoute>
                <WorkflowEditorPage service={services.workflowEditor} />
              </ProtectedRoute>
            }
          />
          <Route
            path="/workflow-editor/:runId/:nodeId"
            element={
              <ProtectedRoute>
                <WorkflowEditorPage service={services.workflowEditor} />
              </ProtectedRoute>
            }
          />
          {PlaytestDemoPage ? (
            <Route
              path="/playtest/demo"
              element={
                <Suspense fallback={null}>
                  <PlaytestDemoPage />
                </Suspense>
              }
            />
          ) : null}
          <Route
            path="/playtest"
            element={
              <ProtectedRoute>
                <PlaytestEntryPage apis={services.playtestApis} />
              </ProtectedRoute>
            }
          />
          <Route
            path="/playtest/:characterId/:outfitId"
            element={
              <ProtectedRoute>
                <PlaytestPage apis={services.playtestApis} />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </AppShell>
    </AuthModeProvider>
  )
}
