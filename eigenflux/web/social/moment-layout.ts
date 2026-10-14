export type MomentCircle = { id: string; x: number; y: number; radius: number };
export const MOMENT_HOVER_SCALE = 1.1;

// Pack in priority order around the most urgent Agent. Tangent candidates keep
// the cluster dense; the radial floor prevents a lower rank displacing it.
export function packMoments(
  groups: { id: string; priority: number }[],
): MomentCircle[] {
  const circles: MomentCircle[] = [];
  const gap = 6;
  let radialFloor = 0;
  for (const group of [...groups].sort(
    (a, b) => b.priority - a.priority || a.id.localeCompare(b.id),
  )) {
    const radius =
      32 + 132 * (Math.max(0, Math.min(130, group.priority)) / 130) ** 3;
    // Reserve the hover envelope so emphasis never covers a neighboring face.
    const footprint = radius * MOMENT_HOVER_SCALE;
    if (!circles.length) {
      circles.push({ id: group.id, x: 0, y: 0, radius });
      continue;
    }
    let best: { x: number; y: number; distance: number } | undefined;
    const phase = circles.length * 2.3999632297;
    for (const anchor of circles) {
      const distance = anchor.radius * MOMENT_HOVER_SCALE + footprint + gap;
      for (let step = 0; step < 48; step++) {
        const angle = phase + (step * Math.PI) / 24;
        const x = anchor.x + Math.cos(angle) * distance;
        const y = anchor.y + Math.sin(angle) * distance;
        const radial = Math.hypot(x, y);
        if (radial < radialFloor - 0.01 || (best && radial >= best.distance))
          continue;
        if (
          circles.some(
            (other) =>
              (other.x - x) ** 2 + (other.y - y) ** 2 <
              (other.radius * MOMENT_HOVER_SCALE + footprint + gap - 0.01) ** 2,
          )
        )
          continue;
        best = { x, y, distance: radial };
      }
    }
    // Always have a non-overlapping fallback, including very large collections.
    const x =
      Math.max(
        radialFloor,
        ...circles.map((c) => c.x + c.radius * MOMENT_HOVER_SCALE),
      ) +
      footprint +
      gap;
    const placed = best || { x, y: 0, distance: x };
    circles.push({ id: group.id, x: placed.x, y: placed.y, radius });
    radialFloor = placed.distance;
  }
  return circles;
}
