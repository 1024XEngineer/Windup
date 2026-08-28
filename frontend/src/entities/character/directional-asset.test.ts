import { describe, expect, it } from 'vitest'

import {
  characterTemplatesFromImages,
  characterTemplatesFromViewSheetCells,
  type Action,
  type CharacterTemplate,
} from '.'
import {
  assertMultiDirectionAssetPublishable,
  characterDataVersionForWrite,
  validateDirectionalAsset,
} from './directional-asset'

function realTemplate(direction: CharacterTemplate['direction']): CharacterTemplate {
  return {
    direction,
    sourceDirection: null,
    mirrorX: false,
    imageUrl: `https://example.com/${direction}.png`,
  }
}

function realAction(directions: readonly CharacterTemplate['direction'][]): Action {
  return {
    id: 'idle',
    outfitId: 'default',
    name: '待机',
    type: 'idle',
    loop: true,
    fps: 12,
    frameCount: 1,
    frames: [],
    sequences: directions.map((direction) => ({
      direction,
      sourceDirection: null,
      mirrorX: false,
      frameCount: 1,
      frames: [{ index: 0, imageUrl: `${direction}.png`, durationMs: 83 }],
    })),
  }
}

describe('validateDirectionalAsset', () => {
  it('persists a merged four-view sheet with source images and a relation-only west mirror', () => {
    expect(
      characterTemplatesFromViewSheetCells([
        {
          direction: 'south',
          imageUrl: 'https://example.com/south.png',
          sourceDirection: null,
          mirrorX: false,
        },
        {
          direction: 'east',
          imageUrl: 'https://example.com/east.png',
          sourceDirection: null,
          mirrorX: false,
        },
        {
          direction: 'north',
          imageUrl: 'https://example.com/north.png',
          sourceDirection: null,
          mirrorX: false,
        },
        {
          direction: 'west',
          imageUrl: 'https://example.com/west-preview.png',
          sourceDirection: 'east',
          mirrorX: true,
        },
      ]),
    ).toEqual([
      realTemplate('south'),
      realTemplate('east'),
      realTemplate('north'),
      {
        direction: 'west',
        sourceDirection: 'east',
        mirrorX: true,
        imageUrl: null,
      },
    ])
  })

  it('rejects a complete-looking sheet whose west cell points at the wrong source', () => {
    expect(() =>
      characterTemplatesFromViewSheetCells([
        {
          direction: 'south',
          imageUrl: 'https://example.com/south.png',
          sourceDirection: null,
          mirrorX: false,
        },
        {
          direction: 'east',
          imageUrl: 'https://example.com/east.png',
          sourceDirection: null,
          mirrorX: false,
        },
        {
          direction: 'north',
          imageUrl: 'https://example.com/north.png',
          sourceDirection: null,
          mirrorX: false,
        },
        {
          direction: 'west',
          imageUrl: 'https://example.com/west-preview.png',
          sourceDirection: 'north',
          mirrorX: true,
        },
      ]),
    ).toThrow('方向 sheet 镜像关系不符合四向/八向规格')
  })

  it('把显式上传的西向母版持久化为真实方向而不是东向镜像', () => {
    expect(
      characterTemplatesFromImages({
        east: 'https://example.com/east.png',
        west: 'https://example.com/west.png',
        north: 'https://example.com/north.png',
        south: 'https://example.com/south.png',
      }),
    ).toEqual([
      realTemplate('east'),
      realTemplate('west'),
      realTemplate('north'),
      realTemplate('south'),
    ])
  })

  it('rejects an independently persisted west that contradicts the merged mirror contract', () => {
    const directions = ['east', 'west', 'north', 'south'] as const

    expect(
      validateDirectionalAsset(2, 'four-way', directions.map(realTemplate), [
        realAction(directions),
      ]),
    ).toEqual({
      complete: false,
      problems: ['角色母版缺少镜像方向：west', '动作 idle 缺少镜像方向：west'],
    })
  })

  it('accepts the merged source-and-mirror contract for a version 2 four-way asset', () => {
    const directions = ['east', 'north', 'south'] as const
    const templates: CharacterTemplate[] = [
      ...directions.map(realTemplate),
      { direction: 'west', sourceDirection: 'east', mirrorX: true, imageUrl: null },
    ]
    const action = realAction(directions)
    action.sequences?.push({
      direction: 'west',
      sourceDirection: 'east',
      mirrorX: true,
      frameCount: 1,
      frames: [],
    })

    expect(validateDirectionalAsset(2, 'four-way', templates, [action])).toEqual({
      complete: true,
      problems: [],
    })
  })

  it('keeps east-to-west derivation valid for a version 2 single asset', () => {
    const action = realAction(['east'])
    action.sequences?.push({
      direction: 'west',
      sourceDirection: 'east',
      mirrorX: true,
      frameCount: 1,
      frames: [],
    })

    expect(
      validateDirectionalAsset(
        2,
        'single',
        [
          realTemplate('east'),
          { direction: 'west', sourceDirection: 'east', mirrorX: true, imageUrl: null },
        ],
        [action],
      ),
    ).toEqual({ complete: true, problems: [] })
  })

  it('rejects a real diagonal direction outside a four-way specification', () => {
    const directions = ['east', 'west', 'north', 'south', 'north_east'] as const

    expect(
      validateDirectionalAsset(2, 'four-way', directions.map(realTemplate), [
        realAction(directions),
      ]),
    ).toEqual({
      complete: false,
      problems: [
        '角色母版缺少镜像方向：west',
        '角色母版包含规格外方向：north_east',
        '动作 idle 缺少镜像方向：west',
        '动作 idle 包含规格外方向：north_east',
      ],
    })
  })

  it('does not treat a version 1 mirror asset as complete for a multi-direction project', () => {
    expect(validateDirectionalAsset(1, 'four-way', [], [])).toEqual({
      complete: false,
      problems: ['旧版镜像资产不能作为完整的多方向资产发布'],
    })
  })

  it('reports a non-east real direction in a single-direction asset', () => {
    expect(
      validateDirectionalAsset(
        2,
        'single',
        [realTemplate('east'), realTemplate('north')],
        [realAction(['east'])],
      ),
    ).toEqual({
      complete: false,
      problems: [
        '角色母版缺少镜像方向：west',
        '角色母版包含规格外方向：north',
        '动作 idle 缺少镜像方向：west',
        '单向资产包含无效方向：north',
      ],
    })
  })
})

describe('characterDataVersionForWrite', () => {
  it('keeps version 1 for east/west-only assets', () => {
    expect(
      characterDataVersionForWrite(1, [realTemplate('east')], [realAction(['east', 'west'])]),
    ).toBe(1)
  })

  it('stamps version 2 when a four-way sequence is present', () => {
    expect(
      characterDataVersionForWrite(1, [realTemplate('east')], [realAction(['east', 'north'])]),
    ).toBe(2)
  })
})

describe('assertMultiDirectionAssetPublishable', () => {
  it('does not block single-direction publishes', () => {
    expect(() => assertMultiDirectionAssetPublishable(1, 'single', [], [])).not.toThrow()
  })

  it('raises the first completeness problem after stamping version 2', () => {
    expect(() =>
      assertMultiDirectionAssetPublishable(2, 'four-way', [realTemplate('east')], []),
    ).toThrow('角色母版缺少真实方向：north、south')
  })
})
