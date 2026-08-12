interface RailProgressInput {
  sectionHeight: number
  sectionTop: number
  viewportHeight: number
}

export function calculateCapabilitiesRailProgress({
  sectionHeight,
  sectionTop,
  viewportHeight,
}: RailProgressInput) {
  const viewportTravel = Math.max(viewportHeight + sectionHeight, 1)
  return Math.min(1, Math.max(0, (viewportHeight - sectionTop) / viewportTravel))
}
