import { startServer } from './http-server.js'
import { PairingStore } from './pairing-store.js'
import { CreatorAssets } from './creator-assets.js'
import { ImportJobRunner } from './import-job.js'
import { createImportJobs } from './import-jobs.js'
import { prepareImport } from '../../src/import-core.js'

const PACKAGE_NAME = 'windup-cocos-importer'
const PORT = 17_832

let activeExtension = null

function dialog(Editor, title, message) {
  if (Editor.Dialog?.info) return Editor.Dialog.info(message, { title })
  console.info(`[${title}] ${message}`)
}

function profileAdapter(Editor) {
  return {
    load: () => Editor.Profile.getConfig(PACKAGE_NAME, 'pairing', 'global'),
    save: (value) => Editor.Profile.setConfig(PACKAGE_NAME, 'pairing', value, 'global'),
  }
}

export function createExtension({ Editor, jobs, serverFactory = startServer }) {
  const pairing = new PairingStore({ profile: profileAdapter(Editor) })
  const activeJobs =
    jobs ??
    createImportJobs({
      runner: new ImportJobRunner({
        projectPath: Editor.Project.path,
        assets: new CreatorAssets(Editor),
        prepareImport,
      }),
      projectName: () => Editor.Project.name,
    })
  let server = null

  return {
    pairing,
    async load() {
      try {
        server = await serverFactory({
          host: '127.0.0.1',
          port: PORT,
          pairing,
          jobs: activeJobs,
          health: async () => ({
            creatorVersion: Editor.App.version,
            projectName: Editor.Project.name,
            projectOpen: Boolean(Editor.Project.path),
          }),
        })
        console.info(`[Windup] Cocos 一键导入服务已启动：http://127.0.0.1:${PORT}`)
      } catch (cause) {
        const message = cause?.message === 'BRIDGE_PORT_IN_USE' ? 'BRIDGE_PORT_IN_USE' : 'BRIDGE_START_FAILED'
        console.error(`[Windup] ${message}`, cause)
        throw cause
      }
    },
    async unload() {
      const current = server
      server = null
      await current?.close()
      activeJobs.close?.()
    },
    async showPairingCode() {
      const code = pairing.createCode()
      await dialog(Editor, 'Windup 一键导入', `连接码：${code}\n有效期 5 分钟，请在 Windup 网页中输入。`)
      return code
    },
    async showConnectionStatus() {
      const pairingValue = await profileAdapter(Editor).load()
      const status = pairingValue?.origin
        ? `已授权网页：${pairingValue.origin}\n服务地址：http://127.0.0.1:${PORT}`
        : '尚未授权 Windup 网页。请先选择“显示连接码”。'
      await dialog(Editor, 'Windup 连接状态', status)
      return status
    },
  }
}

export const methods = {
  showPairingCode() {
    return activeExtension?.showPairingCode()
  },
  showConnectionStatus() {
    return activeExtension?.showConnectionStatus()
  },
}

export async function load() {
  activeExtension = createExtension({ Editor: globalThis.Editor })
  await activeExtension.load()
}

export async function unload() {
  const current = activeExtension
  activeExtension = null
  await current?.unload()
}
