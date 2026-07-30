import {
  PLAYTEST_DEMO_CHARACTER,
  PLAYTEST_DEMO_ACTION_ID,
  PLAYTEST_DEMO_OUTFIT_ID,
} from './testing/demo-character'
import { PlaytestWorkbench } from './workbench'

/** Explicit development fixture entry point. It intentionally bypasses all production APIs. */
export function PlaytestDemoPage() {
  return (
    <PlaytestWorkbench
      character={PLAYTEST_DEMO_CHARACTER}
      outfitId={PLAYTEST_DEMO_OUTFIT_ID}
      initialActionId={PLAYTEST_DEMO_ACTION_ID}
    />
  )
}
