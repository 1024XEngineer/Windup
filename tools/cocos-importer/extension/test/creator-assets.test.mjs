import { test } from 'node:test'
import assert from 'node:assert/strict'

import { CreatorAssets } from '../source/creator-assets.js'

test('CreatorAssets isolates the Creator 3.8.8 AssetDB message contract', async () => {
  const calls = []
  const Editor = {
    Message: {
      async request(...args) {
        calls.push(['request', ...args])
        if (args[1] === 'query-asset-info') return { uuid: 'asset-uuid', url: args[2] }
        return true
      },
      send(...args) {
        calls.push(['send', ...args])
      },
    },
  }
  const assets = new CreatorAssets(Editor)

  await assets.refresh('db://assets/windup-imports/Hero/Ranger')
  assert.deepEqual(await assets.query('db://assets/windup-imports/Hero/Ranger/p.prefab'), {
    uuid: 'asset-uuid',
    url: 'db://assets/windup-imports/Hero/Ranger/p.prefab',
  })
  await assets.reveal('db://assets/windup-imports/Hero/Ranger/p.prefab')

  assert.deepEqual(calls, [
    ['request', 'asset-db', 'refresh-asset', 'db://assets/windup-imports/Hero/Ranger'],
    ['request', 'asset-db', 'query-asset-info', 'db://assets/windup-imports/Hero/Ranger/p.prefab'],
    ['request', 'asset-db', 'query-asset-info', 'db://assets/windup-imports/Hero/Ranger/p.prefab'],
    ['send', 'assets', 'twinkle', 'asset-uuid'],
  ])
})

test('CreatorAssets rejects missing assets before attempting to reveal them', async () => {
  const Editor = {
    Message: {
      request: async () => null,
      send: () => assert.fail('must not reveal a missing asset'),
    },
  }
  await assert.rejects(
    () => new CreatorAssets(Editor).reveal('db://assets/missing.prefab'),
    /CREATOR_ASSET_NOT_FOUND/,
  )
})
