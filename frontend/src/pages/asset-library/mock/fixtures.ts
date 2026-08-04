import type { ActionTemplate, Character, Frame, Project } from '@/entities'

function livedemoFrames(actionName: 'idle' | 'walk', count: number): Frame[] {
  return Array.from({ length: count }, (_, index) => ({
    imageUrl: `/livedemo/characters/boy/views/side/${actionName}-${String(index + 1).padStart(2, '0')}.png`,
    durationMs: index % 3 === 0 ? null : 100,
    rootMotion: index % 2 === 0 ? { dx: index * 2, dy: index === 4 ? 6 : 0 } : null,
  }))
}

export const mockProjects: Project[] = [
  {
    id: 'project-ember',
    ownerId: 'user-local',
    name: '点灯人 · MVP',
    perspective: 'side',
    directionalMovement: 'four-way',
    spriteSize: { width: 64, height: 64 },
    gameStyle: '低饱和像素绘本',
    sampleImageUrl: null,
    createdAt: '2026-08-01T08:00:00.000Z',
    updatedAt: '2026-08-04T05:00:00.000Z',
  },
  {
    id: 'project-empty',
    ownerId: 'user-local',
    name: '空白海岸',
    perspective: 'isometric',
    directionalMovement: 'eight-way',
    spriteSize: { width: 128, height: 128 },
    gameStyle: '温和纸片质感',
    sampleImageUrl: null,
    createdAt: '2026-08-04T06:00:00.000Z',
    updatedAt: '2026-08-04T06:00:00.000Z',
  },
]

export const mockCharacters: Character[] = [
  {
    id: 'character-mist',
    projectId: 'project-ember',
    name: '轻装信使',
    outfits: [
      {
        id: 'outfit-travel',
        characterId: 'character-mist',
        name: '常态造型',
        candidateCharacterTemplates: [],
        characterTemplateUrl: '/livedemo/characters/boy/base-transparent.png',
        baseFrames: [{ imageUrl: '/livedemo/characters/boy/base-transparent.png' }],
        actions: [
          {
            id: 'action-idle',
            outfitId: 'outfit-travel',
            name: '呼吸待机',
            actionTemplateId: 'template-idle',
            kind: 'preset',
            type: 'idle',
            fps: 8,
            keyFrameIndex: null,
            frames: livedemoFrames('idle', 4),
          },
          {
            id: 'action-walk',
            outfitId: 'outfit-travel',
            name: '行走',
            actionTemplateId: 'template-walk',
            kind: 'preset',
            type: 'walk',
            fps: 10,
            keyFrameIndex: 4,
            frames: livedemoFrames('walk', 8),
          },
        ],
      },
    ],
    createdAt: '2026-08-01T08:30:00.000Z',
    updatedAt: '2026-08-04T05:30:00.000Z',
  },
  {
    id: 'character-stone',
    projectId: 'project-ember',
    name: '暗色游侠',
    outfits: [
      {
        id: 'outfit-starter',
        characterId: 'character-stone',
        name: '旅装',
        candidateCharacterTemplates: [],
        characterTemplateUrl: '/livedemo/characters/lirael/base-transparent.png',
        baseFrames: [{ imageUrl: '/livedemo/characters/lirael/base-transparent.png' }],
        actions: [
          {
            id: 'action-walk',
            outfitId: 'outfit-starter',
            name: '行走',
            actionTemplateId: 'template-walk',
            kind: 'preset',
            type: 'walk',
            fps: 10,
            keyFrameIndex: null,
            frames: Array.from({ length: 4 }, (_, index) => ({
              imageUrl: `/livedemo/characters/lirael/views/side/walk-${String(index + 1).padStart(2, '0')}.png`,
              durationMs: 100,
              rootMotion: null,
            })),
          },
        ],
      },
    ],
    createdAt: '2026-08-03T03:20:00.000Z',
    updatedAt: '2026-08-03T03:20:00.000Z',
  },
  {
    id: 'character-draft',
    projectId: 'project-ember',
    name: '待定角色',
    outfits: [
      {
        id: 'outfit-draft',
        characterId: 'character-draft',
        name: '未命名造型',
        candidateCharacterTemplates: [],
        characterTemplateUrl: null,
        baseFrames: [],
        actions: [],
      },
    ],
    createdAt: '2026-08-04T04:20:00.000Z',
    updatedAt: '2026-08-04T04:20:00.000Z',
  },
]

export const mockActionTemplates: ActionTemplate[] = [
  {
    id: 'template-walk',
    name: '基础行走',
    prompt: '稳定、等速的横向行走循环',
    type: 'walk',
    fps: 10,
    frameCount: 8,
    loop: true,
    scope: 'system',
    projectId: null,
  },
  {
    id: 'template-idle',
    name: '呼吸待机',
    prompt: '保持重心的轻微呼吸循环',
    type: 'idle',
    fps: 8,
    frameCount: 4,
    loop: true,
    scope: 'project',
    projectId: 'project-ember',
  },
  {
    id: 'template-attack',
    name: '短促攻击',
    prompt: '清晰的蓄力、触点和收势',
    type: 'attack',
    fps: 12,
    frameCount: 6,
    loop: false,
    scope: 'system',
    projectId: null,
  },
]
