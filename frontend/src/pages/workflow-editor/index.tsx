/**
 * 工作流编辑器 — 直接使用 asset-lab 的 CSS 类名和 HTML 结构。
 * CSS 来自 workflow-shell.css，不自定义样式。
 */
import { useCallback, useState } from 'react'

import { WorkflowCanvas } from './workflow-canvas'
import { NODE_STATUS_LABELS, type StudioMode, type WorkflowNodeType } from './types'
import './workflow-shell.css'

const NODE_INFO: Record<WorkflowNodeType, { title: string; detail: string }> = {
  project: { title: '项目信息', detail: '填写项目名称、视角和美术风格。' },
  source: { title: '选择角色起点', detail: '选择一种母版输入方式：新建或上传参考图。' },
  'master-gen': { title: '生成参考母版', detail: '基于已确认的设定生成 6 张候选母版，约 15 秒。' },
  master: { title: '确认母版', detail: '从候选中选择一张作为身份母版，后续动作均基于此。' },
  'walk-key': { title: 'Walk 第一帧', detail: '描述步态、重心和速度，生成行走动作首帧。' },
  'idle-key': { title: 'Idle 第一帧', detail: '描述呼吸、重心和待机细节，生成待机动作首帧。' },
  'custom-action': { title: '自定义动作', detail: '添加额外动作类型，如攻击、跳跃或特殊动作。' },
  'walk-animation': { title: 'Walk 动画', detail: '首帧确认后，生成完整 8 帧行走循环动画。' },
  'idle-animation': { title: 'Idle 动画', detail: '首帧确认后，生成完整 8 帧待机循环动画。' },
  publish: { title: '正式入库', detail: '母版、Idle 与 Walk 已完成，确认后写入正式资产。' },
}

const GENERATABLE_NODES: WorkflowNodeType[] = ['master-gen', 'master', 'walk-key', 'idle-key', 'walk-animation', 'idle-animation', 'publish']

export function WorkflowEditorPage() {
  const [activeNode, setActiveNode] = useState<WorkflowNodeType | null>(null)
  const [studioMode, setStudioMode] = useState<StudioMode>(null)
  const [generating, setGenerating] = useState(false)

  const handleGenerate = useCallback(() => {
    if (!activeNode || generating) return
    setGenerating(true)
    setTimeout(() => { setGenerating(false); alert(`节点「${NODE_INFO[activeNode].title}」生成完成！`) }, 1500)
  }, [activeNode, generating])

  return (
    <div className="workflow-app" data-route-id="demoBuilder">
      {/* Studio Bar — 与 asset-lab 的 renderStudioBar 结构一致 */}
      <header className="studio-bar">
        <div className="studio-bar__left">
          <a className="studio-bar__brand" href="/">
            <span className="product-brand__mark" aria-hidden="true" />
            <b>Windup</b>
          </a>
          <span className="studio-bar__project">
            <b>{studioMode === 'workflow' ? '节点工作流' : '创作中心'}</b>
            <small>{studioMode === 'workflow' ? '选择素材来源并逐步确认' : '选择一种创作方式'}</small>
          </span>
        </div>
        <div className="studio-bar__right">
          <nav className="studio-bar__nav" aria-label="创作导航">
            <a href="/">首页</a>
            <a href="/projects">项目资产</a>
            <a href="/workflow-editor" className="is-active" aria-current="page">创作</a>
          </nav>
          <div className="studio-bar__actions">
            {studioMode === 'workflow' && <button type="button">整理节点</button>}
            {studioMode === 'workflow' && <button type="button">重置流程</button>}
          </div>
        </div>
      </header>

      {/* Studio Mode Gateway — 与 asset-lab 的 renderStudioModeChooser 结构一致，去掉 AI 智能生成 */}
      {!studioMode && (
        <section className="studio-mode-gateway" data-studio-mode-gateway="">
          <header className="studio-mode-gateway__header">
            <span className="overline">CREATE / WORKFLOW</span>
            <h1>节点工作流</h1>
            <p>从一个项目开始，逐节点连接、生成与确认角色动作资产。</p>
          </header>
          <div className="studio-mode-gateway__choices">
            <button
              className="studio-mode-card studio-mode-card--workflow"
              type="button"
              data-pointer-card=""
              onClick={() => setStudioMode('workflow')}
            >
              <span className="studio-mode-card__eyebrow">STEP BY STEP</span>
              <span className="studio-mode-card__index">01</span>
              <span className="studio-mode-card__copy">
                <small>GUIDED WORKFLOW</small>
                <b>从一个项目开始</b>
                <p>保留从零开始、上传参考图和复用资产库三种来源，逐节点连接、生成与确认。</p>
              </span>
              <span className="studio-mode-card__action">进入工作流  ↗</span>
            </button>
          </div>
        </section>
      )}

      {/* 工作流编辑器主体 — 与 asset-lab 的 node-graph-workspace 结构一致 */}
      {studioMode === 'workflow' && (
        <div className="production-canvas-workspace">
          <div className="node-graph-layout">
            <WorkflowCanvas activeNode={activeNode} onNodeSelect={setActiveNode} />

            <aside className="inspection-panel">
              <header className="inspection-panel__header">
                <span className="overline">INSPECTOR</span>
                <h2>属性与检查</h2>
              </header>
              <div className="inspection-panel__content">
                {activeNode ? (
                  <div className="inspection-panel__node">
                    <div className="inspection-panel__node-info">
                      <span className="overline">SELECTED NODE</span>
                      <h3>{NODE_INFO[activeNode].title}</h3>
                      <p>{NODE_INFO[activeNode].detail}</p>
                    </div>
                    <div className="inspection-panel__meta">
                      <div><dt>状态</dt><dd>{NODE_STATUS_LABELS.ready}</dd></div>
                      <div><dt>节点 ID</dt><dd className="mono">{activeNode}</dd></div>
                    </div>
                    {GENERATABLE_NODES.includes(activeNode) && (
                      <button type="button" className="inspection-panel__generate" onClick={handleGenerate} disabled={generating}>
                        {generating ? '生成中…' : `生成${NODE_INFO[activeNode].title}`}
                      </button>
                    )}
                  </div>
                ) : (
                  <p className="inspection-panel__empty">点击画布中的节点查看属性。</p>
                )}
              </div>
            </aside>
          </div>
        </div>
      )}
    </div>
  )
}
