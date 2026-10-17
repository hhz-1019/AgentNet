export type MomentCircle = { id: string; x: number; y: number; radius: number };
export const MOMENT_HOVER_SCALE = 1.1;

// Input and output are in screen pixels: zooming must not amplify the force.
export function momentRepulsion(
  circles: MomentCircle[],
  pointer: { x: number; y: number } | null,
) {
  if (!pointer) return circles.map((circle) => ({ id: circle.id, x: 0, y: 0 }));
  const offsets = circles.map((circle) => {
    const dx = circle.x - pointer.x,
      dy = circle.y - pointer.y;
    const distance = Math.hypot(dx, dy);
    // A broad, gentle falloff lets surrounding faces yield as well. A tiny
    // influence radius pins the nearest face against motionless neighbors.
    const reach = Math.max(0, 1 - Math.max(0, distance - circle.radius) / 900);
    const force =
      Math.min(18, circle.radius * 0.3) *
      reach ** 1.5 *
      Math.min(1, distance / 32);
    return {
      id: circle.id,
      x: distance ? (dx / distance) * force : 0,
      y: distance ? (dy / distance) * force : 0,
    };
  });
  // Keep the dense packing safe even while any one face is enlarged by hover.
  // A shared limiter preserves the direction of the field and avoids jitter
  // from repeatedly pushing individual neighbors out of each other's way.
  let strength = 1;
  for (let i = 0; i < circles.length; i++) {
    for (let j = i + 1; j < circles.length; j++) {
      const a = circles[i],
        b = circles[j];
      const dx = a.x - b.x,
        dy = a.y - b.y;
      const separation = Math.hypot(dx, dy);
      // Only motion toward a neighbor can consume its clearance. Tangential
      // and separating motion must stay free, or the whole field barely moves.
      const closingMotion =
        -(
          dx * (offsets[i].x - offsets[j].x) +
          dy * (offsets[i].y - offsets[j].y)
        ) / separation;
      if (closingMotion <= 0) continue;
      const room =
        separation -
        Math.max(a.radius, b.radius) * MOMENT_HOVER_SCALE -
        Math.min(a.radius, b.radius);
      strength = Math.min(strength, Math.max(0, room - 0.2) / closingMotion);
    }
  }
  return offsets.map((offset) => ({
    id: offset.id,
    x: offset.x * strength,
    y: offset.y * strength,
  }));
}

export function momentBounds(circles: MomentCircle[]) {
  if (!circles.length) return { left: 0, right: 0, top: 0, bottom: 0 };
  return {
    left: Math.min(...circles.map((c) => c.x - c.radius)),
    right: Math.max(...circles.map((c) => c.x + c.radius)),
    top: Math.min(...circles.map((c) => c.y - c.radius)),
    bottom: Math.max(...circles.map((c) => c.y + c.radius)),
  };
}

// A radial lens compresses space and faces together, with no score-dependent size.
export function projectMoment(
  circle: MomentCircle,
  width: number,
  height: number,
): MomentCircle {
  const reach = Math.max(120, Math.min(width, height) * 0.62);
  const t = Math.hypot(circle.x, circle.y) / reach;
  const positionScale = 0.32 + 0.68 / Math.sqrt(1 + t * t);
  const faceScale = 0.32 + 0.68 / (1 + t * t) ** 1.5;
  return {
    ...circle,
    x: circle.x * positionScale,
    y: circle.y * positionScale,
    radius: circle.radius * faceScale,
  };
}

// Invert the lens so a dragged or pinched point follows the user's fingers.
export function unprojectMoment(
  point: { x: number; y: number },
  width: number,
  height: number,
) {
  const distance = Math.hypot(point.x, point.y);
  if (!distance) return { x: 0, y: 0 };
  const reach = Math.max(120, Math.min(width, height) * 0.62);
  let radius = distance;
  for (let i = 0; i < 8; i++) {
    const t = radius / reach;
    radius -=
      (radius * (0.32 + 0.68 / Math.sqrt(1 + t * t)) - distance) /
      (0.32 + 0.68 / (1 + t * t) ** 1.5);
  }
  return { x: (point.x * radius) / distance, y: (point.y * radius) / distance };
}

export function momentViewportScale(
  circles: MomentCircle[],
  width: number,
  height: number,
) {
  if (!circles.length || width <= 0 || height <= 0) return 1;
  const cap =
    width < 600
      ? 140
      : Math.max(176, Math.min(208, Math.min(width, height) * 0.3));
  const inset = Math.max(20, Math.min(48, Math.min(width, height) * 0.05));
  let low = 0,
    high = cap / 152;
  for (let i = 0; i < 20; i++) {
    const scale = (low + high) / 2;
    const bounds = momentBounds(
      circles.map((c) =>
        projectMoment(
          { ...c, x: c.x * scale, y: c.y * scale, radius: c.radius * scale },
          width,
          height,
        ),
      ),
    );
    if (
      Math.max(-bounds.left, bounds.right) <= width / 2 - inset &&
      Math.max(-bounds.top, bounds.bottom) <= height / 2 - inset
    )
      low = scale;
    else high = scale;
  }
  // Framing may enlarge a sparse collection, but never compress a busy network.
  // At rest the lens bottoms out at 32%: 140px keeps mobile faces above 44px;
  // 176px gives desktop peers comfortable detail even at the periphery.
  const comfortableDiameter = width < 600 ? 140 : 176;
  return Math.max(comfortableDiameter / 152, low);
}

// A stable seed gives organic spacing without shuffling on refresh. Rank only
// controls distance from home; it never scales a person's face by a raw score.
export function packMoments(
  groups: { id: string; priority: number; own?: boolean }[],
  aspectRatio = 1,
): MomentCircle[] {
  const ordered = [...groups].sort(
    (a, b) =>
      Number(Boolean(b.own)) - Number(Boolean(a.own)) ||
      b.priority - a.priority ||
      a.id.localeCompare(b.id),
  );
  const aspect = Math.sqrt(Math.max(0.4, Math.min(2.4, aspectRatio)));
  const distance = (x: number, y: number) => Math.hypot(x / aspect, y * aspect);
  const circles: MomentCircle[] = [];
  let seed = 927451;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  let radialFloor = 0,
    sumX = 0,
    sumY = 0;
  for (const group of ordered) {
    if (!circles.length) {
      circles.push({ id: group.id, x: 0, y: 0, radius: 76 });
      continue;
    }
    let best:
      | { x: number; y: number; radial: number; cost: number }
      | undefined;
    const phase = random() * Math.PI * 2;
    const gap = 170 + random() * 16;
    for (const anchor of circles) {
      for (let step = 0; step < 36; step++) {
        const angle = phase + (step * Math.PI * 2) / 36;
        const x = anchor.x + Math.cos(angle) * gap;
        const y = anchor.y + Math.sin(angle) * gap;
        const radial = distance(x, y);
        if (radial < radialFloor - 0.01) continue;
        const cost =
          radial +
          0.65 *
            distance(
              (sumX + x) / (circles.length + 1),
              (sumY + y) / (circles.length + 1),
            );
        if (best && cost >= best.cost) continue;
        if (circles.some((c) => Math.hypot(c.x - x, c.y - y) < 168)) continue;
        best = { x, y, radial, cost };
      }
    }
    const fallbackX = Math.max(
      radialFloor * aspect,
      ...circles.map((c) => c.x + 186),
    );
    const placed = best || {
      x: fallbackX,
      y: 0,
      radial: distance(fallbackX, 0),
    };
    circles.push({ id: group.id, x: placed.x, y: placed.y, radius: 76 });
    radialFloor = placed.radial;
    sumX += placed.x;
    sumY += placed.y;
  }
  return circles;
}
