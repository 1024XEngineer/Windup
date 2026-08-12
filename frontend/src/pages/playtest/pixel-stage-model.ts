const PLAYTEST_CYCLE_DURATION = 3600

export function modulo(value: number, size: number) {
  return ((value % size) + size) % size
}

export function getPlaytestSceneState(time: number) {
  const cycle = modulo(time, PLAYTEST_CYCLE_DURATION) / PLAYTEST_CYCLE_DURATION
  const jumpProgress = cycle >= 0.46 && cycle <= 0.8 ? (cycle - 0.46) / 0.34 : 0
  const jump = jumpProgress > 0 ? -Math.sin(jumpProgress * Math.PI) * 10 : 0
  const runWave = Math.sin(cycle * Math.PI * 16)
  const bob = jumpProgress > 0 ? 0 : runWave > 0 ? -1 : 0
  const runner = {
    cycle,
    jump,
    jumpProgress,
    runWave,
    originX: 38,
    originY: 33 + jump + bob,
  }

  return {
    runner,
    obstacleX: 154 - runner.cycle * 180,
  }
}
