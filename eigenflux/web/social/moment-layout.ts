export type MomentCircle = { id: string; x: number; y: number; radius: number };
export const MOMENT_HOVER_SCALE = 1.1;

export function momentViewportScale(
  circles: MomentCircle[],
  width: number,
  height: number,
) {
  const baseline = Math.max(
    0.85,
    Math.min(1.35, Math.min(width, height) / 520),
  );
  if (circles.length < 5 || width <= 0 || height <= 0) return baseline;
  // Cover the viewport, including its corners, rather than fit the whole
  // cluster inside it. Sample its silhouette around the central priority item;
  // the extra margin puts the outer faces beyond the stationary edge fade.
  let scale = baseline;
  for (let step = 0; step < 64; step++) {
    const angle = (step * Math.PI) / 32;
    const dx = Math.cos(angle),
      dy = Math.sin(angle);
    const reach = Math.max(
      ...circles.map((c) => c.x * dx + c.y * dy + c.radius),
    );
    const viewportReach =
      (width / 2) * Math.abs(dx) + (height / 2) * Math.abs(dy) + 48;
    scale = Math.max(scale, viewportReach / reach);
  }
  return scale;
}

// Pack in priority order around the most urgent Agent. Tangent candidates keep
// the cluster dense; the radial floor prevents a lower rank displacing it.
export function packMoments(
  groups: { id: string; priority: number }[],
): MomentCircle[] {
  const circles: MomentCircle[] = [];
  // Only the currently emphasized face grows; reserving both neighbors' full
  // hover envelopes makes the resting cluster look unnecessarily scattered.
  const spacing = (a: number, b: number) =>
    a + b + Math.max(a, b) * (MOMENT_HOVER_SCALE - 1) + 2;
  let radialFloor = 0;
  for (const group of [...groups].sort(
    (a, b) => b.priority - a.priority || a.id.localeCompare(b.id),
  )) {
    const radius =
      32 + 132 * (Math.max(0, Math.min(130, group.priority)) / 130) ** 3;
    if (!circles.length) {
      circles.push({ id: group.id, x: 0, y: 0, radius });
      continue;
    }
    let best: { x: number; y: number; distance: number } | undefined;
    const phase = circles.length * 2.3999632297;
    for (const anchor of circles) {
      const distance = spacing(anchor.radius, radius);
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
              (spacing(other.radius, radius) - 0.01) ** 2,
          )
        )
          continue;
        best = { x, y, distance: radial };
      }
    }
    // Always have a non-overlapping fallback, including very large collections.
    const x = Math.max(
      radialFloor,
      ...circles.map((c) => c.x + spacing(c.radius, radius)),
    );
    const placed = best || { x, y: 0, distance: x };
    circles.push({ id: group.id, x: placed.x, y: placed.y, radius });
    radialFloor = placed.distance;
  }
  return circles;
}
