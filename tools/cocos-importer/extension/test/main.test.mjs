import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createExtension } from '../source/main.js'

function editor() {
  const profile = new Map()
  const dialogs = []
  return {
    App: { version: '3.8.8' },
    Project: { name: 'Game', path: 'D:/Game' },
    Message: {
      request: async () => null,
      send: () => {},
    },
    Profile: {
      async getConfig(packageName, key, scope) {
        return profile.get(`${packageName}:${key}:${scope}`)
      },
      async setConfig(packageName, key, value, scope) {
        profile.set(`${packageName}:${key}:${scope}`, value)
      },
    },
    Dialog: {
      async info(message, options) {
        dialogs.push({ message, options })
      },
    },
    dialogs,
  }
}

test('extension starts the fixed loopback service and closes it on unload', async () => {
  const Editor = editor()
  const calls = []
  const extension = createExtension({
    Editor,
    serverFactory: async (options) => {
      calls.push(options)
      return { close: async () => calls.push('closed') }
    },
  })

  await extension.load()
  assert.equal(calls[0].host, '127.0.0.1')
  assert.equal(calls[0].port, 17_832)
  assert.deepEqual(await calls[0].health(), {
    creatorVersion: '3.8.8',
    projectName: 'Game',
    projectOpen: true,
  })
  await extension.unload()
  assert.equal(calls[1], 'closed')
})

test('extension menu exposes pairing code and persisted connection status', async () => {
  const Editor = editor()
  const extension = createExtension({ Editor, serverFactory: async () => ({ close: async () => {} }) })

  const code = await extension.showPairingCode()
  assert.match(code, /^\d{6}$/)
  assert.match(Editor.dialogs[0].message, new RegExp(code))
  await extension.pairing.pair(code, 'https://windup.example')
  const status = await extension.showConnectionStatus()
  assert.match(status, /https:\/\/windup\.example/)
  assert.equal(Editor.dialogs.length, 2)
})
