// 验 uuidForPath 确定性 + RFC 4122 格式 + 不同 path 不同 uuid。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildCocosMetaFiles, uuidForPath } from '../src/cocos-bridge.js'

test('uuidForPath 总是 Cocos 可保留的 RFC 4122 UUID', () => {
  const u = uuidForPath('windup-imports/Hero/Ranger/animations/Walk.anim')
  assert.equal(u.length, 36, `length=${u.length}`)
  assert.match(u, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
})

test('uuidForPath 确定性:同 path → 同 uuid', () => {
  const u1 = uuidForPath('windup-imports/Hero/Ranger/animations/Walk.anim')
  const u2 = uuidForPath('windup-imports/Hero/Ranger/animations/Walk.anim')
  assert.equal(u1, u2)
})

test('uuidForPath 唯一性:不同 path → 不同 uuid', () => {
  const u1 = uuidForPath('a')
  const u2 = uuidForPath('b')
  const u3 = uuidForPath('c')
  assert.notEqual(u1, u2)
  assert.notEqual(u2, u3)
  assert.notEqual(u1, u3)
})

test('uuidForPath 带 namespace 前缀,不和 Cocos 内部 UUID 撞', () => {
  // 使用标准 UUID 形态,避免 Creator 将短 ID 重写成另一套内部 UUID。
  const u = uuidForPath('assets/scenes/main.scene')
  assert.match(u, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
})

test('buildCocosMetaFiles 生成 Cocos 3.x image 子资源结构', () => {
  const plan = {
    packFolder: 'windup-imports/Hero/Ranger',
    spriteFrames: [
      {
        sourcePath: 'character/master.png',
        cocosPath: 'windup-imports/Hero/Ranger/textures/Hero-master.png',
        rect: { x: 0, y: 0, w: 64, h: 64 },
        trim: { x: 0, y: 0, w: 64, h: 64 },
      },
    ],
    animations: [],
    prefab: {
      cocosPath: 'windup-imports/Hero/Ranger/prefabs/Hero-Ranger.prefab',
      nodeName: 'Hero-Ranger',
      anchor: { x: 0.5, y: 0.08 },
      canvas: { w: 64, h: 64 },
    },
  }
  const files = buildCocosMetaFiles({ package: { character_name: 'Hero' } }, plan, 'Hero-Ranger')
  const meta = JSON.parse(files['windup-imports/Hero/Ranger/textures/Hero-master.png.meta'])
  assert.equal(meta.importer, 'image')
  assert.equal(meta.subMetas['6c48a'].uuid, `${meta.uuid}@6c48a`)
  assert.equal(meta.subMetas.f9941.uuid, `${meta.uuid}@f9941`)
  assert.equal(meta.subMetas.f9941.name, 'spriteFrame')
  assert.equal(meta.subMetas.f9941.userData.imageUuidOrDatabaseUri, `${meta.uuid}@6c48a`)
  assert.equal(meta.userData.redirect, `${meta.uuid}@6c48a`)
})

test('buildCocosMetaFiles 生成 Creator 3.8 可播放的 SpriteFrame 对象轨道', () => {
  const packFolder = 'windup-imports/Hero/Ranger'
  const framePaths = [0, 1].map((index) => `${packFolder}/textures/Idle_${index}.png`)
  const plan = {
    packFolder,
    spriteFrames: framePaths.map((cocosPath, index) => ({
      sourcePath: `frames/Idle_${index}.png`,
      cocosPath,
      rect: { x: 0, y: 0, w: 64, h: 64 },
      trim: { x: 0, y: 0, w: 64, h: 64 },
    })),
    animations: [{
      name: 'Idle',
      direction: 'default',
      fps: 12,
      loop: true,
      duration: 1 / 6,
      frames: framePaths.map((spriteFramePath, index) => ({
        spriteFramePath,
        index,
        time: index === 0 ? 0 : 0.1,
        duration: 1 / 12,
      })),
    }],
    prefab: {
      cocosPath: `${packFolder}/prefabs/Hero-Ranger.prefab`,
      nodeName: 'Hero-Ranger',
      anchor: { x: 0.5, y: 0.08 },
      canvas: { w: 64, h: 64 },
    },
  }

  const files = buildCocosMetaFiles({ package: { character_name: 'Hero' } }, plan, 'Hero-Ranger')
  const clip = JSON.parse(files[`${packFolder}/animations/Idle.anim`])

  assert.equal(clip._duration, 1 / 6)
  assert.equal('duration' in clip, false)
  assert.equal('curveData' in clip, false)
  assert.equal(clip._tracks.length, 1)

  const track = clip._tracks[0]
  assert.equal(track.__type__, 'cc.animation.ObjectTrack')
  assert.deepEqual(track._binding.path._paths, [
    { __type__: 'cc.animation.ComponentPath', component: 'cc.Sprite' },
    'spriteFrame',
  ])
  assert.deepEqual(track._channel._curve._times, [0, 0.1])
  assert.deepEqual(
    track._channel._curve._values.map(({ __uuid__ }) => __uuid__),
    framePaths.map((path) => `${uuidForPath(path)}@f9941`),
  )

  const prefab = JSON.parse(files[`${packFolder}/prefabs/Hero-Ranger.prefab`])
  const uiTransform = prefab.find((entry) => entry.__type__ === 'cc.UITransform')
  const sprite = prefab.find((entry) => entry.__type__ === 'cc.Sprite')
  assert.deepEqual(uiTransform._contentSize, { __type__: 'cc.Size', width: 64, height: 64 })
  assert.equal(sprite._sizeMode, 0)
  assert.equal(sprite._isTrimmedMode, false)
})
