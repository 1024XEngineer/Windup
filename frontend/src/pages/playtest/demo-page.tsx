import { useMemo } from 'react'
import { useLocation } from 'react-router'

import type { Character } from '@/entities/character'
import {
  PLAYTEST_DEMO_CHARACTER,
  PLAYTEST_DEMO_CHARACTER_ID,
  PLAYTEST_DEMO_ACTION_ID,
  PLAYTEST_DEMO_OUTFIT_ID,
} from './testing/demo-character'
import { PlaytestWorkbench } from './workbench'

interface DemoPageState {
  characterImageUrl?: string
}

/**
 * 开发预览入口。
 *
 * 当从 Quick Start 导出时，location.state 携带 characterImageUrl，
 * 用选中的角色图覆盖 demo 角色的母版和 base frame。
 */
export function PlaytestDemoPage() {
  const location = useLocation()
  const state = location.state as DemoPageState | null
  const characterImageUrl = state?.characterImageUrl

  const character = useMemo(
    () =>
      characterImageUrl
        ? overrideCharacterImage(PLAYTEST_DEMO_CHARACTER, characterImageUrl)
        : PLAYTEST_DEMO_CHARACTER,
    [characterImageUrl],
  )

  return (
    <PlaytestWorkbench
      character={character}
      outfitId={PLAYTEST_DEMO_OUTFIT_ID}
      initialActionId={PLAYTEST_DEMO_ACTION_ID}
    />
  )
}

function overrideCharacterImage(base: Character, imageUrl: string): Character {
  return {
    ...base,
    outfits: base.outfits.map((outfit) => ({
      ...outfit,
      characterTemplateUrl: imageUrl,
      candidateCharacterTemplates: [
        {
          id: `${PLAYTEST_DEMO_CHARACTER_ID}-quick-start`,
          imageUrl,
          attemptId: 'quick-start-export',
        },
      ],
      baseFrames: [{ imageUrl }],
    })),
  }
}
