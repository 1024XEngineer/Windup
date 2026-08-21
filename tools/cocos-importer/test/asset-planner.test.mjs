import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planImport } from '../src/asset-planner.js'

const MANIFEST = {
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
        { index: 2, file: 'Walk_002.png', duration_ms: 0 },
      ],
      atlas: { file: 'atlas/Walk.png', cols: 3, rows: 1, cell: { w: 64, h: 64 } },
    },
    {
      id: 'attack',
      name: 'Attack',
      export_name: 'Attack',
      direction: 'east',
      fps: 12,
      loop: false,
      quality_status: 'passed',
      anchor: { x: 0.5, y: 0.92 },
      anchor_cocos: { x: 0.5, y: 0.08 },
      foot_y: 58,
      frames: [
        { index: 0, file: 'Attack_000.png', duration_ms: 100 },
        { index: 1, file: 'Attack_001.png', duration_ms: 200 },
      ],
      atlas: { file: 'atlas/Attack.png', cols: 2, rows: 1, cell: { w: 64, h: 64 } },
    },
  ],
}

test('planImport 规划 master + N 个动作 + atlas', () => {
  const plan = planImport(MANIFEST)
  assert.equal(plan.packFolder, 'windup-imports/Hero/Ranger')
  // 1 master + 2 actions: Walk(3 frames + 1 atlas) + Attack(2 frames + 1 atlas) = 8
  assert.equal(plan.spriteFrames.length, 1 + 4 + 3)
  assert.equal(plan.animations.length, 2)
})

test('planImport master anchor 来自 manifest', () => {
  const plan = planImport(MANIFEST)
  assert.equal(plan.prefab.anchor.x, 0.5)
  assert.equal(plan.prefab.anchor.y, 0.08)
  assert.equal(plan.prefab.canvas.w, 64)
  assert.equal(plan.prefab.canvas.h, 64)
})

test('planImport 动画 duration 等于帧 duration_ms 之和(秒)', () => {
  const plan = planImport(MANIFEST)
  const walk = plan.animations.find((a) => a.name === 'Walk')
  // 125 + 125 + 125(fallback 1000/8)=375ms = 0.375s
  assert.ok(Math.abs(walk.duration - 0.375) < 0.01, `walk.duration=${walk.duration}`)
})

test('planImport 保留 export_name 且不重复追加方向后缀', () => {
  const plan = planImport(MANIFEST)
  const walk = plan.animations.find((a) => a.name === 'Walk')
  assert.ok(walk, 'Walk animation 存在')
  assert.equal(walk.direction, 'default')
  const attack = plan.animations.find((a) => a.name === 'Attack')
  assert.ok(attack, 'Attack 存在')
  assert.equal(attack.direction, 'east')
})

test('planImport spriteFrame 路径与 export_name 对齐', () => {
  const plan = planImport(MANIFEST)
  const walkFrames = plan.spriteFrames.filter((s) => s.cocosPath.includes('/Walk/'))
  assert.equal(walkFrames.length, 4) // 3 frames + 1 atlas
  assert.ok(walkFrames.some((s) => s.cocosPath.endsWith('/Walk/Walk_000.png')))
  assert.ok(walkFrames.some((s) => s.cocosPath.endsWith('/Walk/atlas.png')))
  // 源路径:master=character/master.png,frames=frames/<action>/<file>,atlas=atlas/<file>.png
  assert.ok(walkFrames.find((s) => s.cocosPath.endsWith('Walk_000.png')).sourcePath === 'frames/Walk/Walk_000.png')
  assert.ok(walkFrames.find((s) => s.cocosPath.endsWith('atlas.png')).sourcePath === 'atlas/Walk.png')
  const secondFrame = walkFrames.find((s) => s.cocosPath.endsWith('Walk_001.png'))
  assert.deepEqual(secondFrame.rect, { x: 0, y: 0, w: 64, h: 64 })
})

test('planImport 使用 manifest 声明的 atlas 文件路径', () => {
  const custom = JSON.parse(JSON.stringify(MANIFEST))
  custom.actions[0].atlas.file = 'atlas/custom-walk.png'
  const plan = planImport(custom)
  const atlas = plan.spriteFrames.find((s) => s.cocosPath.endsWith('/Walk/atlas.png'))
  assert.equal(atlas.sourcePath, 'atlas/custom-walk.png')
})

test('planImport 接受 master 缺失 foot_y(向后兼容)', () => {
  const broken = JSON.parse(JSON.stringify(MANIFEST))
  delete broken.master.foot_y
  const plan = planImport(broken)
  assert.equal(plan.prefab.footY, 0)
})

test('planImport 对 1.1 constant-fps 使用精确 index/fps 时间', () => {
  const manifest = JSON.parse(JSON.stringify(MANIFEST))
  manifest.schema_version = 'windup-cocos-import-1.1.0'
  manifest.actions = [manifest.actions[0]]
  manifest.actions[0].fps = 12
  manifest.actions[0].timing_mode = 'constant-fps'
  for (const frame of manifest.actions[0].frames) frame.duration_ms = null

  const animation = planImport(manifest).animations[0]
  assert.deepEqual(animation.frames.map((frame) => frame.time), [0, 1 / 12, 2 / 12])
  assert.deepEqual(animation.frames.map((frame) => frame.duration), [1 / 12, 1 / 12, 1 / 12])
  assert.equal(animation.duration, 3 / 12)
})
