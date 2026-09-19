import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const sourcePath = resolve(
  process.argv[2] ?? `${scriptDirectory}/windup-frontend.architecture.json`,
)
const outputPath = resolve(process.argv[3] ?? `${scriptDirectory}/windup-frontend.html`)
const svgFlagIndex = process.argv.indexOf('--svg')
const svgOutputPath =
  svgFlagIndex >= 0
    ? resolve(process.argv[svgFlagIndex + 1] ?? `${scriptDirectory}/windup-frontend.svg`)
    : null

const LIGHT = {
  canvas: '#f3f2ec',
  surface: '#ffffff',
  ink: '#1d251f',
  inkSoft: '#303a32',
  muted: '#687169',
  faint: '#778078',
  line: '#cbd1ca',
  lineStrong: '#8fa092',
  core: '#284331',
  coreSoft: '#dce9df',
  entry: '#8a672a',
  entrySoft: '#f3e8cb',
  contract: '#2a5284',
  contractSoft: '#e4edf7',
  caution: '#6f3928',
  cautionSoft: '#f4e8e1',
  grid: '#dfe3dc',
}

const data = JSON.parse(await readFile(sourcePath, 'utf8'))
validateArchitecture(data)

const svg = renderSvg(data)
await writeFile(outputPath, formatGeneratedHtml(renderHtml(data, svg), outputPath), 'utf8')
if (svgOutputPath) await writeFile(svgOutputPath, svg, 'utf8')

function validateArchitecture(architecture) {
  if (architecture?.schema_version !== 1) throw new Error('只支持 schema_version 1')
  if (!Array.isArray(architecture?.meta?.canvas) || architecture.meta.canvas.length !== 2) {
    throw new Error('meta.canvas 必须是 [width, height]')
  }
  const componentIds = new Set()
  for (const component of architecture.components ?? []) {
    if (!component.id || componentIds.has(component.id)) {
      throw new Error(`组件 ID 缺失或重复：${component.id ?? '<empty>'}`)
    }
    componentIds.add(component.id)
    if (!Array.isArray(component.pos) || !Array.isArray(component.size)) {
      throw new Error(`组件 ${component.id} 缺少 pos / size`)
    }
  }
  const connectionIds = new Set()
  for (const connection of architecture.connections ?? []) {
    if (!connection.id || connectionIds.has(connection.id)) {
      throw new Error(`连线 ID 缺失或重复：${connection.id ?? '<empty>'}`)
    }
    connectionIds.add(connection.id)
    if (!componentIds.has(connection.from) || !componentIds.has(connection.to)) {
      throw new Error(`连线 ${connection.id} 引用了不存在的组件`)
    }
    if (!Array.isArray(connection.route) || connection.route.length < 2) {
      throw new Error(`连线 ${connection.id} 缺少 route`)
    }
  }
  for (const view of architecture.meta.views ?? []) {
    for (const id of view.focus ?? []) {
      if (!componentIds.has(id)) throw new Error(`视图 ${view.id} 引用了不存在的组件 ${id}`)
    }
  }
}

function formatGeneratedHtml(html, filePath) {
  const formatter = resolve(scriptDirectory, '../../node_modules/.bin/oxfmt')
  if (!existsSync(formatter)) return html
  const result = spawnSync(formatter, ['--stdin-filepath', filePath], {
    input: html,
    encoding: 'utf8',
  })
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || 'oxfmt 无法格式化生成的 HTML')
  }
  return result.stdout
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function wrapText(value, maxUnits) {
  const text = String(value).trim()
  if (!text) return []
  const units = [...text].map((character) => ({
    character,
    width: /[\u2e80-\u9fff\uff00-\uffef]/u.test(character) ? 1 : 0.58,
  }))
  const lines = []
  let line = ''
  let width = 0
  let lastSoftBreak = -1
  for (const unit of units) {
    line += unit.character
    width += unit.width
    if (unit.character === ' ' || unit.character === '·' || unit.character === '/') {
      lastSoftBreak = line.length
    }
    if (width <= maxUnits) continue
    if (lastSoftBreak > 0) {
      lines.push(line.slice(0, lastSoftBreak).trim())
      line = line.slice(lastSoftBreak).trimStart()
    } else {
      lines.push(line.slice(0, -1))
      line = unit.character
    }
    width = [...line].reduce(
      (sum, character) => sum + (/[\u2e80-\u9fff\uff00-\uffef]/u.test(character) ? 1 : 0.58),
      0,
    )
    lastSoftBreak = -1
  }
  if (line) lines.push(line.trim())
  return lines.filter(Boolean)
}

function textBlock(lines, x, y, options = {}) {
  const {
    className = 'node-copy',
    lineHeight = 17,
    anchor = 'start',
    maxLines = lines.length,
    fill = className === 'node-label'
      ? LIGHT.ink
      : className === 'node-tag'
        ? LIGHT.faint
        : LIGHT.muted,
  } = options
  return `<text class="${className}" x="${x}" y="${y}" text-anchor="${anchor}" fill="${fill}">${lines
    .slice(0, maxLines)
    .map(
      (line, index) =>
        `<tspan x="${x}" dy="${index === 0 ? 0 : lineHeight}">${escapeXml(line)}</tspan>`,
    )
    .join('')}</text>`
}

function renderSvg(architecture) {
  const [width, height] = architecture.meta.canvas
  const componentById = new Map(
    architecture.components.map((component) => [component.id, component]),
  )
  const connectionMarkup = architecture.connections
    .map((connection) => renderConnection(connection))
    .join('\n')
  const componentMarkup = architecture.components
    .map((component) => renderComponent(component, architecture))
    .join('\n')
  const boundaries = architecture.boundaries.map(renderBoundary).join('\n')
  const header = renderHeader(architecture)
  const legend = renderLegend()
  const grid = renderGrid(width, height)

  for (const connection of architecture.connections) {
    if (!componentById.has(connection.from) || !componentById.has(connection.to)) {
      throw new Error(`无法渲染连线 ${connection.id}`)
    }
  }

  return `<svg id="windup-frontend-architecture" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-labelledby="diagram-title diagram-desc" data-theme="light" data-view="overview" fill="${LIGHT.canvas}" style="background:${LIGHT.canvas}">
  <title id="diagram-title">${escapeXml(architecture.meta.title)}</title>
  <desc id="diagram-desc">${escapeXml(architecture.meta.subtitle)}。Quick Start 与 Workflow Editor 汇入同一个 WorkflowController 和 WorkflowRun，再把审核后的 Character 资产交给资产库、Playtest 与导出包。</desc>
  <defs>
    <marker id="arrow-entry" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" class="arrow-entry-head" fill="${LIGHT.entry}"/></marker>
    <marker id="arrow-core" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" class="arrow-core-head" fill="${LIGHT.core}"/></marker>
    <marker id="arrow-contract" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" class="arrow-contract-head" fill="${LIGHT.contract}"/></marker>
    <marker id="arrow-caution" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" class="arrow-caution-head" fill="${LIGHT.caution}"/></marker>
  </defs>
  <style>
    svg {
      --canvas: #f3f2ec;
      --surface: #ffffff;
      --surface-muted: #e7eae5;
      --ink: #1d251f;
      --ink-soft: #303a32;
      --muted: #687169;
      --faint: #778078;
      --line: #cbd1ca;
      --line-strong: #8fa092;
      --core: #284331;
      --core-soft: #dce9df;
      --entry: #8a672a;
      --entry-soft: #f3e8cb;
      --contract: #2a5284;
      --contract-soft: #e4edf7;
      --caution: #6f3928;
      --caution-soft: #f4e8e1;
      --grid: #dfe3dc;
      --shadow: #1d251f;
      color-scheme: light;
      background: var(--canvas);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans SC", sans-serif;
    }
    svg[data-theme="dark"] {
      --canvas: #101512;
      --surface: #18201a;
      --surface-muted: #202a23;
      --ink: #edf2ec;
      --ink-soft: #d9e1da;
      --muted: #aab5ac;
      --faint: #87958a;
      --line: #334238;
      --line-strong: #607366;
      --core: #8fbaa0;
      --core-soft: #22382b;
      --entry: #d5ad65;
      --entry-soft: #3a3020;
      --contract: #86aee0;
      --contract-soft: #1c3048;
      --caution: #d49a7e;
      --caution-soft: #3c2922;
      --grid: #1b241e;
      --shadow: #000000;
      color-scheme: dark;
    }
    text { fill: var(--ink); }
    .canvas { fill: var(--canvas); }
    .grid-line { stroke: var(--grid); stroke-width: 1; vector-effect: non-scaling-stroke; }
    .boundary { fill: none; stroke: var(--line); stroke-width: 1.5; vector-effect: non-scaling-stroke; }
    .boundary-backend { stroke: var(--contract); stroke-dasharray: 7 8; }
    .boundary-label { fill: var(--muted); font-size: 12px; font-weight: 700; letter-spacing: .16em; }
    .header-kicker { fill: var(--core); font-size: 12px; font-weight: 800; letter-spacing: .18em; }
    .header-title { font-family: ui-serif, "Songti SC", "Noto Serif SC", serif; font-size: 48px; font-weight: 700; letter-spacing: -.045em; }
    .header-subtitle { fill: var(--muted); font-size: 16px; font-weight: 500; letter-spacing: .01em; }
    .truth-number { fill: var(--core); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; font-weight: 800; letter-spacing: .12em; }
    .truth-title { fill: var(--ink-soft); font-size: 12px; font-weight: 700; }
    .legend-copy { fill: var(--muted); font-size: 11px; font-weight: 650; letter-spacing: .04em; }
    .node { cursor: pointer; transition: opacity 180ms ease; outline: none; }
    .node-shape { fill: var(--surface); stroke: var(--line-strong); stroke-width: 1.35; vector-effect: non-scaling-stroke; }
    .node:hover .node-shape, .node:focus-visible .node-shape, .node[data-selected="true"] .node-shape { stroke-width: 2.6; }
    .node:focus-visible .focus-ring { opacity: 1; }
    .focus-ring { fill: none; stroke: var(--core); stroke-width: 3; stroke-dasharray: 2 5; opacity: 0; vector-effect: non-scaling-stroke; }
    .node-entry .node-shape { fill: var(--entry-soft); stroke: var(--entry); }
    .node-core .node-shape { fill: var(--core-soft); stroke: var(--core); }
    .node-caution .node-shape { fill: var(--caution-soft); stroke: var(--caution); stroke-dasharray: 6 5; }
    .node-contract .node-shape { fill: var(--contract-soft); stroke: var(--contract); stroke-dasharray: 5 5; }
    .node-surface .node-shape { fill: var(--surface); stroke: var(--line-strong); }
    .node-platform .node-shape { fill: var(--surface); stroke: var(--line); }
    .node-label { fill: var(--ink); font-size: 18px; font-weight: 760; letter-spacing: -.018em; }
    .node-copy { fill: var(--muted); font-size: 12px; font-weight: 520; }
    .node-tag { fill: var(--faint); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 9.5px; font-weight: 750; letter-spacing: .09em; }
    .node-glyph { fill: none; stroke: currentColor; stroke-width: 1.6; vector-effect: non-scaling-stroke; }
    .node-entry .node-glyph { color: var(--entry); }
    .node-core .node-glyph { color: var(--core); }
    .node-caution .node-glyph { color: var(--caution); }
    .node-surface .node-glyph { color: var(--core); }
    .workflow-rail { fill: none; stroke: var(--core); stroke-width: 2.2; vector-effect: non-scaling-stroke; }
    .workflow-branch { fill: none; stroke: var(--core); stroke-width: 1.25; stroke-dasharray: 4 5; vector-effect: non-scaling-stroke; }
    .workflow-branch-note { fill: var(--surface); stroke: var(--core); }
    .workflow-stage { fill: var(--surface); stroke: var(--core); stroke-width: 1.6; vector-effect: non-scaling-stroke; }
    .workflow-stage-number { fill: var(--core); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10px; font-weight: 800; text-anchor: middle; }
    .workflow-stage-label { fill: var(--ink-soft); font-size: 10px; font-weight: 650; text-anchor: middle; }
    .asset-spine { fill: none; stroke: var(--core); stroke-width: 1.5; vector-effect: non-scaling-stroke; }
    .asset-pixel { fill: var(--core); }
    .asset-label { fill: var(--ink-soft); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; font-weight: 700; }
    .connection { fill: none; stroke-linecap: square; stroke-linejoin: round; stroke-width: 1.8; vector-effect: non-scaling-stroke; transition: opacity 180ms ease, stroke-width 180ms ease; }
    .connection-entry { stroke: var(--entry); marker-end: url(#arrow-entry); }
    .connection-core, .connection-feedback { stroke: var(--core); marker-end: url(#arrow-core); }
    .connection-feedback { stroke-dasharray: 4 5; }
    .connection-optional { stroke: var(--core); stroke-dasharray: 2 7; marker-end: url(#arrow-core); }
    .connection-contract { stroke: var(--contract); stroke-dasharray: 6 7; marker-end: url(#arrow-contract); opacity: .72; }
    .connection-caution { stroke: var(--caution); stroke-dasharray: 6 5; marker-end: url(#arrow-caution); }
    .arrow-entry-head { fill: var(--entry); }
    .arrow-core-head { fill: var(--core); }
    .arrow-contract-head { fill: var(--contract); }
    .arrow-caution-head { fill: var(--caution); }
    .connection-label { fill: var(--muted); stroke: var(--canvas); stroke-width: 6; paint-order: stroke; font-size: 10px; font-weight: 680; text-anchor: middle; letter-spacing: .02em; }
    [data-view-dimmed="true"] { opacity: .1; }
    [data-related="true"] { opacity: 1; }
    .connection[data-related="true"] { stroke-width: 3.2; }
    .node[data-related="true"] .node-shape { stroke-width: 2.25; }
    @media (prefers-reduced-motion: reduce) { .node, .connection { transition: none; } }
  </style>
  <rect class="canvas" width="${width}" height="${height}" fill="${LIGHT.canvas}"/>
  ${grid}
  ${header}
  ${boundaries}
  ${legend}
  <g id="connections">${connectionMarkup}</g>
  <g id="components">${componentMarkup}</g>
</svg>`
}

function renderGrid(width, height) {
  const lines = []
  for (let x = 50; x < width; x += 50) {
    lines.push(
      `<line class="grid-line" x1="${x}" y1="175" x2="${x}" y2="1155" stroke="${LIGHT.grid}" stroke-width="1" opacity="${x % 200 === 50 ? 0.55 : 0.22}"/>`,
    )
  }
  for (let y = 180; y < height; y += 50) {
    lines.push(
      `<line class="grid-line" x1="50" y1="${y}" x2="1750" y2="${y}" stroke="${LIGHT.grid}" stroke-width="1" opacity="${y % 200 === 180 ? 0.55 : 0.22}"/>`,
    )
  }
  return `<g aria-hidden="true">${lines.join('')}</g>`
}

function renderHeader(architecture) {
  const truths = architecture.truths.slice(0, 3)
  const truthMarkup = truths
    .map((truth, index) => {
      const x = 1120 + index * 220
      const lines = wrapText(truth.title, 14)
      return `<g aria-hidden="true">
        <text class="truth-number" x="${x}" y="68" fill="${LIGHT.core}">${escapeXml(truth.number)}</text>
        ${textBlock(lines, x, 91, { className: 'truth-title', lineHeight: 17, maxLines: 2, fill: LIGHT.inkSoft })}
      </g>`
    })
    .join('')
  return `<g id="diagram-header">
    <text class="header-kicker" x="70" y="52" fill="${LIGHT.core}">FRONTEND ARCHITECTURE · 2026.08</text>
    <text class="header-title" x="70" y="108" fill="${LIGHT.ink}">${escapeXml(architecture.meta.title)}</text>
    <text class="header-subtitle" x="72" y="142" fill="${LIGHT.muted}">${escapeXml(architecture.meta.subtitle)}</text>
    <line x1="1020" y1="45" x2="1020" y2="142" stroke="${LIGHT.line}" stroke-width="1"/>
    ${truthMarkup}
  </g>`
}

function renderBoundary(boundary) {
  const [x, y] = boundary.pos
  const [width, height] = boundary.size
  const backend = boundary.id === 'backend'
  return `<g aria-hidden="true">
    <rect class="boundary ${backend ? 'boundary-backend' : ''}" x="${x}" y="${y}" width="${width}" height="${height}" rx="${backend ? 10 : 22}" fill="none" stroke="${backend ? LIGHT.contract : LIGHT.line}" stroke-width="1.5" ${backend ? 'stroke-dasharray="7 8"' : ''}/>
    <text class="boundary-label" x="${x + 20}" y="${y + 24}" fill="${LIGHT.muted}">${escapeXml(boundary.label)}</text>
  </g>`
}

function renderLegend() {
  return `<g aria-hidden="true" transform="translate(1260 205)">
    <circle cx="0" cy="0" r="5" fill="${LIGHT.entry}"/><text class="legend-copy" x="12" y="4" fill="${LIGHT.muted}">用户入口</text>
    <circle cx="104" cy="0" r="5" fill="${LIGHT.core}"/><text class="legend-copy" x="116" y="4" fill="${LIGHT.muted}">前端状态</text>
    <circle cx="218" cy="0" r="5" fill="${LIGHT.contract}"/><text class="legend-copy" x="230" y="4" fill="${LIGHT.muted}">后端契约</text>
    <circle cx="334" cy="0" r="5" fill="${LIGHT.caution}"/><text class="legend-copy" x="346" y="4" fill="${LIGHT.muted}">当前分叉</text>
  </g>`
}

function connectionPaint(variant) {
  if (variant === 'entry') return { stroke: LIGHT.entry, marker: 'arrow-entry', dash: null }
  if (variant === 'contract')
    return { stroke: LIGHT.contract, marker: 'arrow-contract', dash: '6 7' }
  if (variant === 'caution') return { stroke: LIGHT.caution, marker: 'arrow-caution', dash: '6 5' }
  if (variant === 'feedback') return { stroke: LIGHT.core, marker: 'arrow-core', dash: '4 5' }
  if (variant === 'optional') return { stroke: LIGHT.core, marker: 'arrow-core', dash: '2 7' }
  return { stroke: LIGHT.core, marker: 'arrow-core', dash: null }
}

function renderConnection(connection) {
  const points = connection.route.map(([x, y]) => `${x},${y}`).join(' ')
  const [labelX, labelY] = connection.label_pos
  const paint = connectionPaint(connection.variant)
  return `<g class="connection-group" data-connection-id="${escapeXml(connection.id)}" data-from="${escapeXml(connection.from)}" data-to="${escapeXml(connection.to)}">
    <polyline class="connection connection-${escapeXml(connection.variant)}" points="${points}" fill="none" stroke="${paint.stroke}" stroke-width="1.8" ${paint.dash ? `stroke-dasharray="${paint.dash}"` : ''} marker-end="url(#${paint.marker})"/>
    <text class="connection-label" x="${labelX}" y="${labelY}" fill="${LIGHT.muted}" stroke="${LIGHT.canvas}" stroke-width="6" paint-order="stroke">${escapeXml(connection.label)}</text>
  </g>`
}

function renderComponent(component, architecture) {
  if (component.shape === 'rail') return renderRail(component)
  if (component.shape === 'controller') return renderController(component)
  if (component.shape === 'workflow') return renderWorkflow(component, architecture.workflow_stages)
  if (component.shape === 'asset-tree') return renderAssetTree(component, architecture.asset_tree)
  return renderCard(component)
}

function renderNodeWrapper(component, innerMarkup, focusRadius = 12) {
  const [x, y] = component.pos
  const [width, height] = component.size
  return `<g class="node node-${escapeXml(component.kind)}" data-node-id="${escapeXml(component.id)}" tabindex="0" role="button" aria-label="查看 ${escapeXml(component.label)} 的说明">
    <title>${escapeXml(component.label)}：${escapeXml(component.sublabel ?? '')}</title>
    <rect class="focus-ring" x="${x - 5}" y="${y - 5}" width="${width + 10}" height="${height + 10}" rx="${focusRadius + 4}" fill="none" stroke="${LIGHT.core}" stroke-width="3" stroke-dasharray="2 5" opacity="0"/>
    ${innerMarkup}
  </g>`
}

function nodePaint(kind) {
  if (kind === 'entry') return { fill: LIGHT.entrySoft, stroke: LIGHT.entry }
  if (kind === 'core') return { fill: LIGHT.coreSoft, stroke: LIGHT.core }
  if (kind === 'caution') return { fill: LIGHT.cautionSoft, stroke: LIGHT.caution }
  if (kind === 'contract') return { fill: LIGHT.contractSoft, stroke: LIGHT.contract }
  if (kind === 'platform') return { fill: LIGHT.surface, stroke: LIGHT.line }
  return { fill: LIGHT.surface, stroke: LIGHT.lineStrong }
}

function renderRail(component) {
  const [x, y] = component.pos
  const [width, height] = component.size
  const parts = component.label.split(' · ')
  const paint = nodePaint(component.kind)
  const inner = `<rect class="node-shape" x="${x}" y="${y}" width="${width}" height="${height}" rx="12" fill="${paint.fill}" stroke="${paint.stroke}" stroke-width="1.35"/>
    <g aria-hidden="true" transform="translate(${x + 18} ${y + 13})">
      <rect width="8" height="8" fill="${LIGHT.core}"/><rect x="10" width="8" height="8" fill="${LIGHT.entry}"/><rect x="20" width="8" height="8" fill="${LIGHT.contract}"/>
    </g>
    <text class="node-tag" x="${x + 62}" y="${y + 19}" fill="${LIGHT.faint}">${escapeXml(parts.join('  /  ').toUpperCase())}</text>
    <text class="node-copy" x="${x + width - 18}" y="${y + 19}" text-anchor="end" fill="${LIGHT.muted}">${escapeXml(component.sublabel)}</text>`
  return renderNodeWrapper(component, inner, 12)
}

function renderCard(component) {
  const [x, y] = component.pos
  const [width, height] = component.size
  const radius =
    component.shape === 'endpoint' ? height / 2 : component.shape === 'surface-small' ? 12 : 18
  const labelLines = wrapText(component.label, Math.max(9, (width - 58) / 15))
  const copyLines = wrapText(component.sublabel, Math.max(12, (width - 28) / 11.5))
  const glyph = renderGlyph(component, x + 24, y + 25)
  const labelY = y + (component.shape === 'endpoint' ? 28 : 39)
  const copyY = component.shape === 'endpoint' ? y + 47 : y + 65
  const paint = nodePaint(component.kind)
  const inner = `<rect class="node-shape" x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" fill="${paint.fill}" stroke="${paint.stroke}" stroke-width="1.35" ${component.kind === 'caution' || component.kind === 'contract' ? 'stroke-dasharray="6 5"' : ''}/>
    ${glyph}
    ${component.tag ? `<text class="node-tag" x="${x + width - 16}" y="${y + 18}" text-anchor="end" fill="${LIGHT.faint}">${escapeXml(component.tag)}</text>` : ''}
    ${textBlock(labelLines, x + (component.shape === 'endpoint' ? width / 2 : 46), labelY, { className: 'node-label', lineHeight: 19, anchor: component.shape === 'endpoint' ? 'middle' : 'start', maxLines: 2, fill: LIGHT.ink })}
    ${textBlock(copyLines, x + (component.shape === 'endpoint' ? width / 2 : 18), copyY, { className: 'node-copy', lineHeight: 16, anchor: component.shape === 'endpoint' ? 'middle' : 'start', maxLines: component.shape === 'surface-small' ? 1 : 2, fill: LIGHT.muted })}`
  return renderNodeWrapper(component, inner, radius)
}

function renderGlyph(component, x, y) {
  const paint = nodePaint(component.kind)
  if (component.shape === 'endpoint') return ''
  if (component.shape === 'entry') {
    return `<g class="node-glyph" aria-hidden="true" fill="none" stroke="${paint.stroke}" stroke-width="1.6"><rect x="${x - 8}" y="${y - 8}" width="12" height="12"/><rect x="${x}" y="${y}" width="12" height="12"/></g>`
  }
  if (component.shape === 'publisher') {
    return `<g class="node-glyph" aria-hidden="true" fill="none" stroke="${paint.stroke}" stroke-width="1.6"><path d="M${x - 8} ${y - 7}V${y + 7}M${x - 8} ${y}H${x + 6}M${x + 1} ${y - 5}L${x + 7} ${y}L${x + 1} ${y + 5}"/></g>`
  }
  if (component.shape === 'surface' || component.shape === 'surface-small') {
    return `<g class="node-glyph" aria-hidden="true" fill="none" stroke="${paint.stroke}" stroke-width="1.6"><path d="M${x} ${y - 9}L${x + 9} ${y}L${x} ${y + 9}L${x - 9} ${y}Z"/><circle cx="${x}" cy="${y}" r="2"/></g>`
  }
  return `<g class="node-glyph" aria-hidden="true" fill="none" stroke="${paint.stroke}" stroke-width="1.6"><circle cx="${x - 6}" cy="${y}" r="3"/><circle cx="${x + 6}" cy="${y - 6}" r="3"/><circle cx="${x + 6}" cy="${y + 6}" r="3"/><path d="M${x - 3} ${y}L${x + 3} ${y - 5}M${x - 3} ${y}L${x + 3} ${y + 5}"/></g>`
}

function renderController(component) {
  const [x, y] = component.pos
  const [width, height] = component.size
  const copyLines = wrapText(component.sublabel, 22)
  const paint = nodePaint(component.kind)
  const inner = `<rect class="node-shape" x="${x}" y="${y}" width="${width}" height="${height}" rx="34" fill="${paint.fill}" stroke="${paint.stroke}" stroke-width="1.35"/>
    <rect x="${x - 7}" y="${y + 43}" width="14" height="34" rx="3" fill="${LIGHT.core}"/>
    <rect x="${x + width - 7}" y="${y + 88}" width="14" height="34" rx="3" fill="${LIGHT.core}"/>
    <g class="node-glyph" aria-hidden="true" transform="translate(${x + 38} ${y + 45})" fill="none" stroke="${LIGHT.core}" stroke-width="1.6">
      <circle cx="0" cy="0" r="16"/><circle cx="0" cy="0" r="5"/><path d="M-11 -11L11 11M11 -11L-11 11"/>
    </g>
    <text class="node-tag" x="${x + 22}" y="${y + 24}" fill="${LIGHT.faint}">${escapeXml(component.tag)}</text>
    <text class="node-label" x="${x + 22}" y="${y + 90}" style="font-size:23px" fill="${LIGHT.ink}">${escapeXml(component.label)}</text>
    ${textBlock(copyLines, x + 22, y + 118, { className: 'node-copy', lineHeight: 17, maxLines: 2, fill: LIGHT.muted })}
    <text class="node-tag" x="${x + 22}" y="${y + height - 18}" fill="${LIGHT.faint}">COMMANDS · PERSIST · SUBSCRIBE · RESUME</text>`
  return renderNodeWrapper(component, inner, 34)
}

function renderWorkflow(component, stages) {
  const [x, y] = component.pos
  const [width, height] = component.size
  const startX = x + 55
  const endX = x + width - 55
  const railY = y + 120
  const stageStep = (endX - startX) / (stages.length - 1)
  const stageMarkup = stages
    .map((stage, index) => {
      const stageX = startX + index * stageStep
      return `<g aria-hidden="true">
        <circle class="workflow-stage" cx="${stageX}" cy="${railY}" r="22" fill="${LIGHT.surface}" stroke="${LIGHT.core}" stroke-width="1.6"/>
        <text class="workflow-stage-number" x="${stageX}" y="${railY + 4}" fill="${LIGHT.core}">${escapeXml(stage.short)}</text>
        <text class="workflow-stage-label" x="${stageX}" y="${railY + 44}" fill="${LIGHT.inkSoft}">${escapeXml(stage.label)}</text>
      </g>`
    })
    .join('')
  const branchStart = startX + stageStep
  const paint = nodePaint(component.kind)
  const inner = `<rect class="node-shape" x="${x}" y="${y}" width="${width}" height="${height}" rx="26" fill="${paint.fill}" stroke="${paint.stroke}" stroke-width="1.35"/>
    <text class="node-tag" x="${x + 24}" y="${y + 27}" fill="${LIGHT.faint}">${escapeXml(component.tag)}</text>
    <text class="node-label" x="${x + 24}" y="${y + 61}" style="font-size:24px" fill="${LIGHT.ink}">${escapeXml(component.label)}</text>
    <text class="node-copy" x="${x + 24}" y="${y + 84}" fill="${LIGHT.muted}">${escapeXml(component.sublabel)}</text>
    <line class="workflow-rail" x1="${startX}" y1="${railY}" x2="${endX}" y2="${railY}" stroke="${LIGHT.core}" stroke-width="2.2"/>
    ${stageMarkup}
    <path class="workflow-branch" d="M${branchStart} ${railY + 22}V${railY + 108}H${endX - 8}" fill="none" stroke="${LIGHT.core}" stroke-width="1.25" stroke-dasharray="4 5"/>
    <rect class="workflow-branch-note" x="${branchStart + 18}" y="${railY + 88}" width="${endX - branchStart - 24}" height="42" rx="10" fill="${LIGHT.surface}" stroke="${LIGHT.core}" stroke-dasharray="3 5"/>
    <text class="node-copy" x="${branchStart + 34}" y="${railY + 105}" fill="${LIGHT.muted}">每个 Action 重复 03 → 06；多个动作共享角色母版后可并行</text>
    <text class="node-tag" x="${branchStart + 34}" y="${railY + 121}" fill="${LIGHT.faint}">dependsOnNodeIds · nodeId + taskId · phase / status</text>`
  return renderNodeWrapper(component, inner, 26)
}

function renderAssetTree(component, items) {
  const [x, y] = component.pos
  const [width, height] = component.size
  const startY = y + 70
  const rows = items
    .map((item, index) => {
      const rowY = startY + index * 19
      const pixelX = x + 25 + item.depth * 18
      return `<g aria-hidden="true">
        ${index > 0 ? `<line class="asset-spine" x1="${pixelX - 10}" y1="${rowY - 15}" x2="${pixelX - 10}" y2="${rowY}" stroke="${LIGHT.core}" stroke-width="1.5"/>` : ''}
        <rect class="asset-pixel" x="${pixelX}" y="${rowY - 8}" width="8" height="8" fill="${LIGHT.core}"/>
        <text class="asset-label" x="${pixelX + 16}" y="${rowY}" fill="${LIGHT.inkSoft}">${escapeXml(item.label)}</text>
      </g>`
    })
    .join('')
  const paint = nodePaint(component.kind)
  const inner = `<rect class="node-shape" x="${x}" y="${y}" width="${width}" height="${height}" rx="26" fill="${paint.fill}" stroke="${paint.stroke}" stroke-width="1.35"/>
    <text class="node-tag" x="${x + 22}" y="${y + 24}" fill="${LIGHT.faint}">${escapeXml(component.tag)}</text>
    <text class="node-label" x="${x + 22}" y="${y + 52}" style="font-size:21px" fill="${LIGHT.ink}">${escapeXml(component.label)}</text>
    ${rows}
    <path class="asset-spine" d="M${x + 25} ${startY - 15}V${startY + 68}" fill="none" stroke="${LIGHT.core}" stroke-width="1.5"/>
    <text class="node-tag" x="${x + width - 18}" y="${y + height - 18}" text-anchor="end" fill="${LIGHT.faint}">character_data</text>`
  return renderNodeWrapper(component, inner, 26)
}

function renderHtml(architecture, svg) {
  const safeData = JSON.stringify(architecture).replaceAll('<', '\\u003c')
  const shortRevision = architecture.meta.repository.revision.slice(0, 7)
  return `<!doctype html>
<html lang="zh-CN" data-theme="light">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <meta name="theme-color" content="#f3f2ec" media="(prefers-color-scheme: light)">
  <meta name="theme-color" content="#101512" media="(prefers-color-scheme: dark)">
  <meta name="generator" content="Windup frontend architecture renderer">
  <title>${escapeXml(architecture.meta.title)} · ${escapeXml(architecture.meta.subtitle)}</title>
  <script>
    (function () {
      try {
        var stored = localStorage.getItem('windup-architecture-theme')
        var theme = stored === 'dark' || stored === 'light'
          ? stored
          : (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
        document.documentElement.dataset.theme = theme
      } catch (_) {}
    })()
  </script>
  <style>
    :root {
      color-scheme: light;
      --page: #e8e9e3;
      --chrome: rgba(255, 255, 255, .9);
      --chrome-solid: #ffffff;
      --ink: #1d251f;
      --muted: #687169;
      --line: #cbd1ca;
      --accent: #284331;
      --accent-soft: #dce9df;
      --canvas-shadow: 0 26px 80px rgb(29 37 31 / 15%);
    }
    :root[data-theme="dark"] {
      color-scheme: dark;
      --page: #0b0f0c;
      --chrome: rgba(24, 32, 26, .92);
      --chrome-solid: #18201a;
      --ink: #edf2ec;
      --muted: #aab5ac;
      --line: #334238;
      --accent: #8fbaa0;
      --accent-soft: #22382b;
      --canvas-shadow: 0 28px 90px rgb(0 0 0 / 40%);
    }
    * { box-sizing: border-box; }
    html, body { min-height: 100%; margin: 0; }
    body {
      background: var(--page);
      color: var(--ink);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans SC", sans-serif;
      overflow: hidden;
    }
    button, a { font: inherit; touch-action: manipulation; }
    button:focus-visible, a:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 3px;
    }
    .toolbar {
      position: fixed;
      inset: 14px 16px auto 16px;
      z-index: 20;
      display: flex;
      min-height: 46px;
      align-items: center;
      gap: 10px;
      padding: 7px 9px 7px 14px;
      border: 1px solid var(--line);
      border-radius: 15px;
      background: var(--chrome);
      box-shadow: 0 12px 32px rgb(29 37 31 / 10%);
      backdrop-filter: blur(18px) saturate(.9);
    }
    .brand {
      display: flex;
      min-width: 210px;
      align-items: baseline;
      gap: 9px;
      margin-right: 6px;
      white-space: nowrap;
    }
    .brand strong { font-family: ui-serif, "Songti SC", serif; font-size: 17px; }
    .brand span { color: var(--muted); font-size: 11px; font-weight: 650; letter-spacing: .08em; text-transform: uppercase; }
    .view-tabs { display: flex; min-width: 0; gap: 2px; overflow-x: auto; scrollbar-width: none; }
    .view-tabs::-webkit-scrollbar { display: none; }
    .tool-button, .view-button {
      min-height: 32px;
      border: 0;
      border-radius: 9px;
      background: transparent;
      color: var(--muted);
      cursor: pointer;
      font-size: 12px;
      font-weight: 680;
      letter-spacing: .015em;
      white-space: nowrap;
    }
    .view-button { padding: 0 11px; }
    .tool-button { display: grid; min-width: 34px; place-items: center; padding: 0 9px; }
    .tool-button:hover, .view-button:hover { background: var(--accent-soft); color: var(--accent); }
    .view-button[aria-pressed="true"] { background: var(--accent); color: var(--chrome-solid); }
    :root[data-theme="dark"] .view-button[aria-pressed="true"] { color: #101512; }
    .toolbar-separator { width: 1px; height: 24px; flex: 0 0 auto; background: var(--line); }
    .toolbar-actions { display: flex; gap: 2px; margin-left: auto; }
    .revision { color: var(--muted); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10px; white-space: nowrap; }
    .stage {
      width: 100vw;
      height: 100dvh;
      overflow: auto;
      overscroll-behavior: contain;
      padding: 78px 24px 24px;
    }
    .diagram-wrap {
      width: max(1120px, calc((100dvh - 112px) * 1.5));
      max-width: 1800px;
      margin: 0 auto;
      transform: scale(var(--viewer-zoom, 1));
      transform-origin: top center;
      transition: transform 160ms ease;
    }
    #windup-frontend-architecture {
      display: block;
      width: 100%;
      height: auto;
      border: 1px solid var(--line);
      border-radius: 22px;
      box-shadow: var(--canvas-shadow);
    }
    .view-note {
      position: fixed;
      left: 32px;
      bottom: 24px;
      z-index: 10;
      max-width: min(560px, calc(100vw - 64px));
      padding: 9px 12px;
      border: 1px solid var(--line);
      border-radius: 10px;
      background: var(--chrome);
      color: var(--muted);
      font-size: 12px;
      line-height: 1.55;
      backdrop-filter: blur(14px);
    }
    .inspector {
      position: fixed;
      inset: 76px 16px 16px auto;
      z-index: 30;
      width: min(390px, calc(100vw - 32px));
      overflow: auto;
      overscroll-behavior: contain;
      padding: 22px;
      border: 1px solid var(--line);
      border-radius: 18px;
      background: var(--chrome-solid);
      box-shadow: 0 26px 80px rgb(29 37 31 / 24%);
      transform: translateX(calc(100% + 28px));
      transition: transform 180ms cubic-bezier(.2, .8, .2, 1);
    }
    .inspector[data-open="true"] { transform: translateX(0); }
    .inspector-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
    .inspector-tag { margin: 0 0 8px; color: var(--accent); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10px; font-weight: 800; letter-spacing: .1em; }
    .inspector h2 { margin: 0; font-family: ui-serif, "Songti SC", serif; font-size: 27px; line-height: 1.18; letter-spacing: -.035em; text-wrap: balance; }
    .inspector-subtitle { margin: 10px 0 0; color: var(--muted); font-size: 13px; line-height: 1.65; }
    .inspector-close { min-width: 36px; min-height: 36px; border: 0; border-radius: 10px; background: transparent; color: var(--muted); cursor: pointer; font-size: 20px; }
    .inspector-close:hover { background: var(--accent-soft); color: var(--accent); }
    .inspector h3 { margin: 24px 0 10px; padding-top: 18px; border-top: 1px solid var(--line); font-size: 11px; letter-spacing: .11em; text-transform: uppercase; }
    .inspector ul { margin: 0; padding: 0; list-style: none; }
    .inspector-detail { position: relative; padding: 0 0 10px 17px; color: var(--ink); font-size: 13px; line-height: 1.65; }
    .inspector-detail::before { content: ""; position: absolute; left: 0; top: .65em; width: 6px; height: 6px; background: var(--accent); }
    .source-link { display: block; padding: 10px 0; border-top: 1px solid var(--line); color: var(--ink); text-decoration: none; }
    .source-link:first-child { border-top: 0; }
    .source-link:hover { color: var(--accent); }
    .source-label { display: block; font-size: 12px; font-weight: 700; }
    .source-path { display: block; margin-top: 4px; overflow-wrap: anywhere; color: var(--muted); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10px; line-height: 1.45; }
    .noscript { margin: 100px auto; max-width: 42rem; padding: 24px; }
    @media (max-width: 900px) {
      .toolbar { inset: 8px 8px auto 8px; overflow-x: auto; }
      .brand { min-width: auto; }
      .brand span, .revision { display: none; }
      .stage { padding: 66px 10px 18px; }
      .view-note { left: 18px; bottom: 14px; max-width: calc(100vw - 36px); }
      .inspector { inset: 64px 8px 8px auto; width: min(390px, calc(100vw - 16px)); }
    }
    @media (prefers-reduced-motion: reduce) {
      .diagram-wrap, .inspector { transition: none; }
    }
    @media print {
      .toolbar, .view-note, .inspector { display: none !important; }
      body { overflow: visible; background: white; }
      .stage { width: auto; height: auto; overflow: visible; padding: 0; }
      .diagram-wrap { width: 100%; max-width: none; transform: none !important; }
      #windup-frontend-architecture { border: 0; border-radius: 0; box-shadow: none; }
    }
  </style>
</head>
<body>
  <header class="toolbar" aria-label="架构图工具栏">
    <div class="brand"><strong>Windup</strong><span>Frontend Map</span></div>
    <nav class="view-tabs" aria-label="阅读视图" id="view-tabs"></nav>
    <span class="toolbar-separator" aria-hidden="true"></span>
    <span class="revision">main@${escapeXml(shortRevision)}</span>
    <div class="toolbar-actions">
      <button class="tool-button" id="zoom-out" type="button" aria-label="缩小">−</button>
      <button class="tool-button" id="zoom-reset" type="button" aria-label="重置缩放">100%</button>
      <button class="tool-button" id="zoom-in" type="button" aria-label="放大">＋</button>
      <button class="tool-button" id="theme-toggle" type="button" aria-label="切换深浅主题">◐</button>
      <button class="tool-button" id="download-svg" type="button">SVG</button>
      <button class="tool-button" id="download-png" type="button">PNG</button>
    </div>
  </header>
  <main class="stage" id="stage">
    <div class="diagram-wrap" id="diagram-wrap">${svg}</div>
  </main>
  <p class="view-note" id="view-note" aria-live="polite"></p>
  <aside class="inspector" id="inspector" aria-labelledby="inspector-title" data-open="false">
    <div class="inspector-header">
      <div>
        <p class="inspector-tag" id="inspector-tag"></p>
        <h2 id="inspector-title"></h2>
        <p class="inspector-subtitle" id="inspector-subtitle"></p>
      </div>
      <button class="inspector-close" id="inspector-close" type="button" aria-label="关闭详情">×</button>
    </div>
    <h3>Architecture notes</h3>
    <ul id="inspector-details"></ul>
    <h3>Source anchors</h3>
    <div id="inspector-sources"></div>
  </aside>
  <noscript><p class="noscript">请启用 JavaScript 查看交互式源码索引；图本身仍可打印或导出。</p></noscript>
  <script id="architecture-data" type="application/json">${safeData}</script>
  <script>
    (function () {
      'use strict'
      var data = JSON.parse(document.getElementById('architecture-data').textContent)
      var svg = document.getElementById('windup-frontend-architecture')
      var root = document.documentElement
      var inspector = document.getElementById('inspector')
      var nodeById = Object.fromEntries(data.components.map(function (item) { return [item.id, item] }))
      var zoom = 1
      var activeView = 'overview'
      var selectedId = null

      function syncTheme() {
        var theme = root.dataset.theme === 'dark' ? 'dark' : 'light'
        svg.dataset.theme = theme
        try { localStorage.setItem('windup-architecture-theme', theme) } catch (_) {}
      }

      function setTheme(theme) {
        root.dataset.theme = theme
        syncTheme()
      }

      function renderViewTabs() {
        var tabs = document.getElementById('view-tabs')
        data.meta.views.forEach(function (view, index) {
          var button = document.createElement('button')
          button.type = 'button'
          button.className = 'view-button'
          button.textContent = view.label
          button.dataset.viewId = view.id
          button.setAttribute('aria-pressed', index === 0 ? 'true' : 'false')
          button.addEventListener('click', function () { setView(view.id) })
          tabs.appendChild(button)
        })
      }

      function setView(viewId) {
        var view = data.meta.views.find(function (item) { return item.id === viewId }) || data.meta.views[0]
        activeView = view.id
        var focus = new Set(view.focus || data.components.map(function (item) { return item.id }))
        svg.dataset.view = view.id
        svg.querySelectorAll('[data-node-id]').forEach(function (node) {
          node.dataset.viewDimmed = focus.has(node.dataset.nodeId) ? 'false' : 'true'
        })
        svg.querySelectorAll('[data-connection-id]').forEach(function (group) {
          var visible = focus.has(group.dataset.from) && focus.has(group.dataset.to)
          group.dataset.viewDimmed = visible ? 'false' : 'true'
        })
        document.querySelectorAll('.view-button').forEach(function (button) {
          button.setAttribute('aria-pressed', button.dataset.viewId === view.id ? 'true' : 'false')
        })
        document.getElementById('view-note').textContent = view.note
        clearRelated()
      }

      function clearRelated() {
        svg.querySelectorAll('[data-related]').forEach(function (item) { item.removeAttribute('data-related') })
      }

      function highlightRelated(id) {
        clearRelated()
        var selected = svg.querySelector('[data-node-id="' + CSS.escape(id) + '"]')
        if (selected) selected.dataset.related = 'true'
        svg.querySelectorAll('[data-connection-id]').forEach(function (connection) {
          if (connection.dataset.from !== id && connection.dataset.to !== id) return
          connection.dataset.related = 'true'
          var peerId = connection.dataset.from === id ? connection.dataset.to : connection.dataset.from
          var peer = svg.querySelector('[data-node-id="' + CSS.escape(peerId) + '"]')
          if (peer) peer.dataset.related = 'true'
        })
      }

      function showInspector(id) {
        var item = nodeById[id]
        if (!item) return
        selectedId = id
        svg.querySelectorAll('[data-node-id]').forEach(function (node) {
          node.dataset.selected = node.dataset.nodeId === id ? 'true' : 'false'
        })
        document.getElementById('inspector-tag').textContent = item.tag || item.kind.toUpperCase()
        document.getElementById('inspector-title').textContent = item.label
        document.getElementById('inspector-subtitle').textContent = item.sublabel || ''
        var details = document.getElementById('inspector-details')
        details.replaceChildren()
        ;(item.details || []).forEach(function (detail) {
          var li = document.createElement('li')
          li.className = 'inspector-detail'
          li.textContent = detail
          details.appendChild(li)
        })
        var sources = document.getElementById('inspector-sources')
        sources.replaceChildren()
        ;(item.sources || []).forEach(function (source) {
          var link = document.createElement('a')
          link.className = 'source-link'
          link.target = '_blank'
          link.rel = 'noreferrer'
          link.href = data.meta.repository.url + '/blob/' + data.meta.repository.revision + '/' + source.path + '#L' + source.line
          var label = document.createElement('span')
          label.className = 'source-label'
          label.textContent = source.label
          var path = document.createElement('span')
          path.className = 'source-path'
          path.textContent = source.path + ':' + source.line
          link.append(label, path)
          sources.appendChild(link)
        })
        inspector.dataset.open = 'true'
        highlightRelated(id)
      }

      function closeInspector() {
        inspector.dataset.open = 'false'
        selectedId = null
        svg.querySelectorAll('[data-selected]').forEach(function (node) { node.removeAttribute('data-selected') })
        clearRelated()
      }

      function setZoom(next) {
        zoom = Math.max(.65, Math.min(1.45, next))
        document.getElementById('diagram-wrap').style.setProperty('--viewer-zoom', String(zoom))
        document.getElementById('zoom-reset').textContent = Math.round(zoom * 100) + '%'
      }

      function cleanSvgClone() {
        var clone = svg.cloneNode(true)
        clone.dataset.theme = root.dataset.theme === 'dark' ? 'dark' : 'light'
        clone.dataset.view = activeView
        clone.removeAttribute('style')
        clone.querySelectorAll('[data-view-dimmed], [data-related], [data-selected]').forEach(function (item) {
          item.removeAttribute('data-view-dimmed')
          item.removeAttribute('data-related')
          item.removeAttribute('data-selected')
        })
        return clone
      }

      function downloadBlob(blob, filename) {
        var url = URL.createObjectURL(blob)
        var link = document.createElement('a')
        link.href = url
        link.download = filename
        link.click()
        setTimeout(function () { URL.revokeObjectURL(url) }, 1000)
      }

      function exportSvg() {
        var clone = cleanSvgClone()
        var markup = new XMLSerializer().serializeToString(clone)
        downloadBlob(new Blob([markup], { type: 'image/svg+xml;charset=utf-8' }), 'windup-frontend-architecture.svg')
      }

      function exportPng() {
        var clone = cleanSvgClone()
        var markup = new XMLSerializer().serializeToString(clone)
        var blob = new Blob([markup], { type: 'image/svg+xml;charset=utf-8' })
        var url = URL.createObjectURL(blob)
        var image = new Image()
        image.onload = function () {
          var scale = 2
          var canvas = document.createElement('canvas')
          canvas.width = data.meta.canvas[0] * scale
          canvas.height = data.meta.canvas[1] * scale
          var context = canvas.getContext('2d')
          context.drawImage(image, 0, 0, canvas.width, canvas.height)
          URL.revokeObjectURL(url)
          canvas.toBlob(function (png) {
            if (png) downloadBlob(png, 'windup-frontend-architecture.png')
          }, 'image/png')
        }
        image.src = url
      }

      renderViewTabs()
      syncTheme()
      setView('overview')

      svg.querySelectorAll('[data-node-id]').forEach(function (node) {
        node.addEventListener('click', function () { showInspector(node.dataset.nodeId) })
        node.addEventListener('keydown', function (event) {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            showInspector(node.dataset.nodeId)
          }
        })
        node.addEventListener('mouseenter', function () { if (!selectedId) highlightRelated(node.dataset.nodeId) })
        node.addEventListener('mouseleave', function () { if (!selectedId) clearRelated() })
      })

      document.getElementById('inspector-close').addEventListener('click', closeInspector)
      document.getElementById('theme-toggle').addEventListener('click', function () {
        setTheme(root.dataset.theme === 'dark' ? 'light' : 'dark')
      })
      document.getElementById('zoom-out').addEventListener('click', function () { setZoom(zoom - .1) })
      document.getElementById('zoom-reset').addEventListener('click', function () { setZoom(1) })
      document.getElementById('zoom-in').addEventListener('click', function () { setZoom(zoom + .1) })
      document.getElementById('download-svg').addEventListener('click', exportSvg)
      document.getElementById('download-png').addEventListener('click', exportPng)
      window.addEventListener('keydown', function (event) {
        if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return
        if (event.key === 'Escape') closeInspector()
        if (event.key.toLowerCase() === 't') setTheme(root.dataset.theme === 'dark' ? 'light' : 'dark')
        if (event.key === '0') setZoom(1)
        if (event.key === '+' || event.key === '=') setZoom(zoom + .1)
        if (event.key === '-') setZoom(zoom - .1)
        var index = Number(event.key) - 1
        if (Number.isInteger(index) && data.meta.views[index]) setView(data.meta.views[index].id)
      })
    })()
  </script>
</body>
</html>
`
}
