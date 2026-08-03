import { describe, expect, it } from 'vitest'

import {
  addCard,
  autoAppend,
  createGraph,
  descendants,
  layout,
  plusOptions,
  removeCard,
  updateCard,
  type Card,
} from './index'

/** 把图推进到「母版已确认」，后面几个用例都从这里开始。 */
function graphWithMaster() {
  let graph = createGraph()
  const origin = graph.cards[0]
  graph = autoAppend(updateCard(graph, origin.id, { status: 'confirmed' }), origin.id, 'candidates')
  const candidates = graph.cards[1]
  graph = autoAppend(
    updateCard(graph, candidates.id, { status: 'confirmed' }),
    candidates.id,
    'master',
  )
  const master = graph.cards[2]
  return { graph: updateCard(graph, master.id, { status: 'confirmed' }), masterId: master.id }
}

describe('加号只列合法下游', () => {
  it('未确认的卡片没有下游，用户无从往下走', () => {
    const graph = createGraph()
    expect(plusOptions(graph.cards[0])).toEqual([])
  })

  it('母版给出生成动作、静态资产与导出，静态资产本期禁用', () => {
    const { graph, masterId } = graphWithMaster()
    const options = plusOptions(graph.cards.find((card) => card.id === masterId) as Card)
    expect(options.map((option) => option.id)).toEqual(['action', 'static', 'export'])
    expect(options.find((option) => option.id === 'static')?.disabled).toBe(true)
  })

  it('首帧只有完整动画一个下游，因此界面不弹菜单', () => {
    const { graph, masterId } = graphWithMaster()
    const next = addCard(graph, masterId, 'preset:walk')
    const firstFrame = next.cards[next.cards.length - 1]
    expect(
      plusOptions(updateCard(next, firstFrame.id, { status: 'confirmed' }).cards.at(-1) as Card),
    ).toHaveLength(1)
  })
})

describe('挂动作', () => {
  it('在母版上重复展开加号可以挂多条并列分支', () => {
    const { graph, masterId } = graphWithMaster()
    const withTwo = addCard(addCard(graph, masterId, 'preset:walk'), masterId, 'preset:idle')
    const branches = withTwo.cards.filter((card) => card.kind === 'first-frame')
    expect(branches).toHaveLength(2)
    expect(branches.every((card) => card.parentId === masterId)).toBe(true)
  })

  it('自定义动作与预设动作是同一种卡片，只是定义来源不同', () => {
    const { graph, masterId } = graphWithMaster()
    const preset = addCard(graph, masterId, 'preset:walk').cards.at(-1) as Card
    const custom = addCard(graph, masterId, 'custom').cards.at(-1) as Card
    expect(preset.kind).toBe(custom.kind)
    expect(preset.action?.kind).toBe('preset')
    expect(custom.action?.kind).toBe('custom')
  })

  it('并列分支各占一行，主干留在第 0 行', () => {
    const { graph, masterId } = graphWithMaster()
    const withTwo = addCard(addCard(graph, masterId, 'preset:walk'), masterId, 'preset:idle')
    const positions = layout(withTwo)
    const [walk, idle] = withTwo.cards.filter((card) => card.kind === 'first-frame')
    expect(positions[masterId].y).toBe(0)
    expect(positions[walk.id].y).not.toBe(positions[idle.id].y)
  })
})

describe('删除连带下游', () => {
  it('删掉首帧会一并移除它下面的动画', () => {
    const { graph, masterId } = graphWithMaster()
    const withWalk = addCard(graph, masterId, 'preset:walk')
    const firstFrame = withWalk.cards.at(-1) as Card
    const withAnimation = addCard(withWalk, firstFrame.id, 'animation')
    expect(descendants(withAnimation, firstFrame.id)).toHaveLength(2)
    expect(removeCard(withAnimation, firstFrame.id).cards).toHaveLength(3)
  })
})
