import type { BakeJob, MasterPrecheckReport, Render3DApis, Render3DAsset } from '@/entities'

/**
 * 三渲二资产的测试替身。
 *
 * 默认档刻意做成"母版通过、无警告 / 资产还没建"——这是最常见的背景，让不关心这条链的
 * 用例不必自己拼一份。要测闸的用例显式覆盖对应方法，覆盖不到的地方仍然是可预测的默认，
 * 而不是 undefined 引发的运行时崩溃。
 */
export const RENDER3D_COST: Render3DAsset['cost'] = {
  model3dCredits: 20,
  autorigCredits: 10,
  totalCredits: 30,
  billing: 'postpaid',
  scope: 'per_outfit_once',
}

export function acceptedReport(
  overrides: Partial<MasterPrecheckReport> = {},
): MasterPrecheckReport {
  return {
    accepted: true,
    rejectCode: null,
    detail: '母版 400×600，主体 80×420（w/h 0.19，占幅 14.0%）',
    facts: {
      width: 400,
      height: 600,
      subjectRatio: 0.19,
      subjectAreaRatio: 0.14,
      limbSegments: [2, 2, 2, 2],
      components: [33600],
    },
    warnings: [],
    ...overrides,
  }
}

export function absentAsset(overrides: Partial<Render3DAsset> = {}): Render3DAsset {
  return {
    state: 'absent',
    model3dUrl: null,
    reviewModelUrl: null,
    // 两个都是必填。替身给 undefined 的话,"面板拿不到动作表"这一类回归在这里
    // 看不出来 —— 类型对不上才是它该有的样子。
    bakedMotions: [],
    bakeableMotions: [],
    error: null,
    cost: RENDER3D_COST,
    ...overrides,
  }
}

/** 一个刚挂出来的出帧任务。数字取自实测口径:竖屏 1536×2560、8 帧、覆盖率阈值 0.005。 */
export function bakeJob(overrides: Partial<BakeJob> = {}): BakeJob {
  return {
    taskId: 1,
    modelUrl: 'https://media.example.com/media/model-3d/rigged.glb',
    clip: 'walk',
    direction: 'e',
    cameraYaw: 0,
    frames: 8,
    width: 1536,
    height: 2560,
    material: 'cel',
    minCoverage: 0.005,
    deadlineAt: 4_102_444_800,
    received: 0,
    ...overrides,
  }
}

export function stubRender3DApis(overrides: Partial<Render3DApis> = {}): Render3DApis {
  return {
    precheckMaster: async () => acceptedReport(),
    getOutfitAsset: async () => absentAsset(),
    buildOutfitAsset: async () => absentAsset({ state: 'awaiting_review' }),
    approveOutfitAsset: async () => absentAsset({ state: 'ready' }),
    addOutfitMotion: async (_c, _o, motion) =>
      absentAsset({ state: 'ready', bakedMotions: [motion] }),
    discardOutfitAsset: async () => absentAsset(),
    getBakeJob: async () => null,
    putBakeFrame: async () => 1,
    completeBake: async () => undefined,
    failBake: async () => undefined,
    ...overrides,
  }
}
