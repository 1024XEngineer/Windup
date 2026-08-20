import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildManifestFromLegacyMeta, parseManifest, validateManifest } from '../src/manifest-reader.js'

const VALID = {
  schema_version: 'windup-cocos-import-1.0.0',
  experimental: true,
  engine: 'cocos-creator',
  upstream_issue: 94,
  package: {
    character_id: 'c1',
    character_name: 'Hero',
    outfit_id: 'o1',
    outfit_name: 'Ranger',
    canvas: { w: 64, h: 64 },
  },
  master: {
    file: 'character/master.png',
    anchor: { x: 0.5, y: 0.92 },
    anchor_cocos: { x: 0.5, y: 0.08 },
  },
  actions: [
    {
      id: 'walk',
      name: 'Walk',
      export_name: 'Walk',
      direction: 'default',
      fps: 8,
      loop: true,
      quality_status: 'passed',
      anchor: { x: 0.5, y: 0.92 },
      anchor_cocos: { x: 0.5, y: 0.08 },
      foot_y: 58,
      frames: [
        { index: 0, file: 'Walk_000.png', duration_ms: 125 },
        { index: 1, file: 'Walk_001.png', duration_ms: 125 },
      ],
      atlas: {
        file: 'atlas/Walk.png',
        cols: 2,
        rows: 1,
        cell: { w: 64, h: 64 },
      },
    },
  ],
}

test('parseManifest 接受合法 manifest', () => {
  const m = parseManifest(JSON.stringify(VALID))
  assert.equal(m.engine, 'cocos-creator')
  assert.equal(m.actions.length, 1)
})

test('parseManifest 接受 1.1 constant-fps 的 null 帧时长', () => {
  const v11 = JSON.parse(JSON.stringify(VALID))
  v11.schema_version = 'windup-cocos-import-1.1.0'
  v11.actions[0].timing_mode = 'constant-fps'
  for (const frame of v11.actions[0].frames) frame.duration_ms = null
  const manifest = parseManifest(JSON.stringify(v11))
  assert.equal(manifest.actions[0].timing_mode, 'constant-fps')
  assert.deepEqual(manifest.actions[0].frames.map((frame) => frame.duration_ms), [null, null])
})

test('parseManifest 拒绝 1.1 的非法 timing_mode', () => {
  const broken = JSON.parse(JSON.stringify(VALID))
  broken.schema_version = 'windup-cocos-import-1.1.0'
  broken.actions[0].timing_mode = 'rounded-milliseconds'
  assert.throws(() => parseManifest(JSON.stringify(broken)), /timing_mode/)
})

test('parseManifest 拒绝非 JSON', () => {
  assert.throws(() => parseManifest('{not json'), /不是合法 JSON/)
})

test('parseManifest 拒绝缺字段', () => {
  const broken = JSON.parse(JSON.stringify(VALID))
  delete broken.package.character_id
  assert.throws(() => parseManifest(JSON.stringify(broken)), /缺少字段.*character_id/)
})

test('parseManifest 拒绝错误 engine', () => {
  const broken = { ...JSON.parse(JSON.stringify(VALID)), engine: 'unity' }
  assert.throws(() => parseManifest(JSON.stringify(broken)), /engine/)
})

test('parseManifest 拒绝非 experimental', () => {
  const broken = { ...JSON.parse(JSON.stringify(VALID)), experimental: false }
  assert.throws(() => parseManifest(JSON.stringify(broken)), /experimental/)
})

test('parseManifest 拒绝错误 schema_version', () => {
  const broken = { ...JSON.parse(JSON.stringify(VALID)), schema_version: 'something-else' }
  assert.throws(() => parseManifest(JSON.stringify(broken)), /schema_version/)
})

test('parseManifest 只接受明确支持的 schema_version', () => {
  for (const schema_version of ['windup-cocos-import-0.9.0', 'windup-cocos-import-1.2.0', 'windup-cocos-import-next']) {
    const broken = { ...JSON.parse(JSON.stringify(VALID)), schema_version }
    assert.throws(() => parseManifest(JSON.stringify(broken)), /schema_version/)
  }
})

test('parseManifest 拒绝错误 direction', () => {
  const broken = JSON.parse(JSON.stringify(VALID))
  broken.actions[0].direction = 'upside_down'
  assert.throws(() => parseManifest(JSON.stringify(broken)), /direction 非法/)
})

test('parseManifest 拒绝错误 quality_status', () => {
  const broken = JSON.parse(JSON.stringify(VALID))
  broken.actions[0].quality_status = 'maybe'
  assert.throws(() => parseManifest(JSON.stringify(broken)), /quality_status 非法/)
})

test('parseManifest 接受只有角色母版的空 actions 包', () => {
  const characterOnly = { ...JSON.parse(JSON.stringify(VALID)), actions: [] }
  assert.deepEqual(parseManifest(JSON.stringify(characterOnly)).actions, [])
})

test('parseManifest 拒绝非正 canvas', () => {
  const broken = JSON.parse(JSON.stringify(VALID))
  broken.package.canvas.w = 0
  assert.throws(() => parseManifest(JSON.stringify(broken)), /canvas\.w/)
})

test('parseManifest 拒绝非连续帧序号', () => {
  const broken = JSON.parse(JSON.stringify(VALID))
  broken.actions[0].frames[1].index = 3
  assert.throws(() => parseManifest(JSON.stringify(broken)), /index 必须从 0 连续递增/)
})

test('parseManifest 拒绝不安全的素材路径', () => {
  const broken = JSON.parse(JSON.stringify(VALID))
  broken.master.file = '../outside.png'
  assert.throws(() => parseManifest(JSON.stringify(broken)), /master\.file.*安全的相对路径/)
})

test('parseManifest 拒绝 Windows 盘符、反斜杠和 NUL 素材路径', () => {
  for (const file of ['C:/outside.png', 'frames\\walk.png', 'frames/evil\0.png']) {
    const broken = JSON.parse(JSON.stringify(VALID))
    broken.master.file = file
    assert.throws(() => parseManifest(JSON.stringify(broken)), /安全的相对路径/)
  }
})

test('parseManifest 拒绝超出图集容量的帧', () => {
  const broken = JSON.parse(JSON.stringify(VALID))
  broken.actions[0].atlas.cols = 1
  broken.actions[0].atlas.rows = 1
  assert.throws(() => parseManifest(JSON.stringify(broken)), /超出图集容量/)
})

test('parseManifest 限制动作数、单动作帧数和总帧数', () => {
  const tooManyActions = JSON.parse(JSON.stringify(VALID))
  tooManyActions.actions = Array.from({ length: 129 }, (_, index) => ({
    ...tooManyActions.actions[0],
    id: `action-${index}`,
  }))
  assert.throws(() => validateManifest(tooManyActions), /动作数超过限制/)

  const makeFrames = (count) => Array.from({ length: count }, (_, index) => ({
    index,
    file: `frame-${index}.png`,
    duration_ms: 1,
  }))
  const tooManyInAction = JSON.parse(JSON.stringify(VALID))
  tooManyInAction.actions[0].frames = makeFrames(2049)
  tooManyInAction.actions[0].atlas = { ...tooManyInAction.actions[0].atlas, cols: 2049 }
  assert.throws(() => validateManifest(tooManyInAction), /单动作帧数超过限制/)

  const tooManyTotal = JSON.parse(JSON.stringify(VALID))
  tooManyTotal.actions = [2048, 2048, 1].map((count, actionIndex) => ({
    ...tooManyTotal.actions[0],
    id: `action-${actionIndex}`,
    frames: makeFrames(count),
    atlas: { ...tooManyTotal.actions[0].atlas, cols: count },
  }))
  assert.throws(() => validateManifest(tooManyTotal), /总帧数超过限制/)
})

test('validateManifest 接受对象,parseManifest 接受字符串', () => {
  const m = validateManifest(VALID)
  assert.equal(m.engine, 'cocos-creator')
  const m2 = parseManifest(JSON.stringify(VALID))
  assert.deepEqual(m, m2)
})

test('buildManifestFromLegacyMeta 兼容旧版 action-assets 包', () => {
  const legacy = {
    schema_version: '1.1.0',
    stage: 'action-assets',
    character: { id: 46, name: '网站看板娘', image: 'character/master.png' },
    outfit: { id: 'outfit-default', name: '默认造型' },
    canvas: { w: 256, h: 256 },
    actions: [
      {
        id: 'idle',
        name: '待机',
        fps: 12,
        loop: true,
        quality_status: 'passed',
        anchor: { x: 0.5, y: 0.92 },
        foot_y: 235,
        frames: [{ index: 0, file: '待机_000.png' }],
        atlas: { file: 'atlas/待机.png', cols: 8, rows: 4, cell: { w: 256, h: 256 } },
      },
    ],
  }
  const manifest = buildManifestFromLegacyMeta(legacy)
  assert.equal(manifest.schema_version, 'windup-cocos-import-1.1.0')
  assert.equal(manifest.package.character_id, '46')
  assert.equal(manifest.package.character_name, '网站看板娘')
  assert.equal(manifest.master.anchor_cocos.x, 0.5)
  assert.ok(Math.abs(manifest.master.anchor_cocos.y - 0.08) < 1e-10)
  assert.equal(manifest.actions[0].export_name, '待机')
  assert.equal(manifest.actions[0].timing_mode, 'constant-fps')
  assert.equal(manifest.actions[0].frames[0].duration_ms, null)
})
