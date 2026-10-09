import { entryOutline, type EntryPoint } from './brand-entry-outline.ts';

export const entryTiming = { morph: 1000, reveal: 1100 };
export type EntryPhase = 'loading' | 'morph' | 'reveal';
const paper = '#f5f1e8';
const ink = '#302c26';
const font = '"Iowan Old Style", "Songti SC", "Noto Serif SC", SimSun, serif';
export const clampEntry = (value: number) => Math.max(0, Math.min(1, value));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (value: number) => {
  const t = clampEntry(value);
  return t * t * (3 - 2 * t);
};
export const entryEase = (value: number) => {
  const t = clampEntry(value);
  return t === 0 || t === 1
    ? t
    : t < 0.5
      ? 2 ** (20 * t - 10) / 2
      : (2 - 2 ** (-20 * t + 10)) / 2;
};

function rectangle(x0: number, x1: number, height: number): EntryPoint[] {
  const y = height / 2;
  const sides: EntryPoint[] = [
    [x0, -y],
    [x1, -y],
    [x1, y],
    [x0, y],
  ];
  const lengths = [x1 - x0, height, x1 - x0, height];
  const perimeter = lengths.reduce((a, b) => a + b, 0);
  return Array.from({ length: 256 }, (_, index) => {
    let distance = (perimeter * index) / 256;
    let side = 0;
    while (distance > lengths[side] && side < 3) distance -= lengths[side++];
    const a = sides[side],
      b = sides[(side + 1) % 4];
    return [
      mix(a[0], b[0], distance / lengths[side]),
      mix(a[1], b[1], distance / lengths[side]),
    ];
  });
}

// Correspondence preserves both original components and their winding throughout.
function align(source: EntryPoint[], target: EntryPoint[]) {
  let best = 0,
    minimum = Infinity;
  for (let shift = 0; shift < target.length; shift++) {
    let cost = 0;
    for (let i = 0; i < source.length; i++) {
      const a = source[i],
        b = target[(i + shift) % target.length];
      cost += (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
    }
    if (cost < minimum) {
      minimum = cost;
      best = shift;
    }
  }
  return target.map((_, i) => target[(i + best) % target.length]);
}

export function entryGeometry(width: number) {
  const barWidth = Math.min(228, width * 0.51),
    barHeight = barWidth / 5;
  const scale = barWidth / entryOutline.bounds.width;
  const { center, pivot } = entryOutline;
  const source = [
    rectangle(-barWidth / 2, 0, barHeight),
    rectangle(0, barWidth / 2, barHeight),
  ];
  const target = entryOutline.contours.map((points, part) =>
    align(
      source[part],
      points.map(
        ([x, y]): EntryPoint => [
          (x - center.x) * scale,
          (y - center.y) * scale,
        ],
      ),
    ),
  );
  return {
    source,
    target,
    barWidth,
    barHeight,
    pivot: [
      (pivot.x - center.x) * scale,
      (pivot.y - center.y) * scale,
    ] as EntryPoint,
    radius: pivot.radius * scale,
  };
}

export type EntryGeometry = ReturnType<typeof entryGeometry>;
export function entryMorph(geometry: EntryGeometry, progress: number) {
  return geometry.source.map((points, part) =>
    points.map(
      ([x, y], i): EntryPoint => [
        mix(x, geometry.target[part][i][0], progress),
        mix(y, geometry.target[part][i][1], progress),
      ],
    ),
  );
}

export function entryReveal(
  geometry: EntryGeometry,
  width: number,
  height: number,
  progress: number,
) {
  return {
    x: width / 2,
    y: height * 0.455,
    angle: (progress * Math.PI * 57) / 180,
    scale: Math.exp(
      Math.log((Math.hypot(width, height) * 1.24) / geometry.radius) *
        entryEase(progress),
    ),
    camera: smooth(progress),
    // Keep the solid logo at the boundary, then open it while the camera moves.
    // Only the logo becomes transparent; the surrounding curtain stays opaque.
    aperture: smooth((progress - 0.06) / 0.38),
  };
}

function closedPath(points: EntryPoint[]) {
  const path = new Path2D(),
    count = points.length;
  path.moveTo(points[0][0], points[0][1]);
  for (let i = 0; i < count; i++) {
    const p0 = points[(i + count - 1) % count],
      p1 = points[i];
    const p2 = points[(i + 1) % count],
      p3 = points[(i + 2) % count];
    path.bezierCurveTo(
      p1[0] + (p2[0] - p0[0]) / 6,
      p1[1] + (p2[1] - p0[1]) / 6,
      p2[0] - (p3[0] - p1[0]) / 6,
      p2[1] - (p3[1] - p1[1]) / 6,
      p2[0],
      p2[1],
    );
  }
  path.closePath();
  return path;
}

function digits(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  progress: number,
  exit: number,
) {
  const size = Math.max(72, Math.min(158, width * 0.106));
  const left = Math.max(16, width * 0.026),
    baseline = height - Math.max(18, height * 0.026);
  ctx.save();
  ctx.font = `400 ${size}px ${font}`;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = paper;
  const percent = Math.floor(clampEntry(progress) * 100),
    leave = entryEase(exit * 1.23);
  // Paint one coherent reading, so carries never combine independently rolling digits.
  ctx.beginPath();
  ctx.rect(left, baseline - size * 0.85, size * 2, size * 1.07);
  ctx.clip();
  ctx.fillText(String(percent), left, baseline - leave * size);
  ctx.restore();
}

export function paintEntry(
  ctx: CanvasRenderingContext2D,
  geometry: EntryGeometry,
  width: number,
  height: number,
  dpr: number,
  phase: EntryPhase,
  progress: number,
  elapsed: number,
) {
  progress = clampEntry(progress);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = ink;
  ctx.fillRect(0, 0, width, height);
  if (phase === 'loading') {
    ctx.fillStyle = '#665e52';
    ctx.fillRect(
      width / 2 - geometry.barWidth / 2,
      height * 0.455 - geometry.barHeight / 2,
      geometry.barWidth,
      geometry.barHeight,
    );
    ctx.fillStyle = paper;
    ctx.fillRect(
      width / 2 - geometry.barWidth / 2,
      height * 0.455 - geometry.barHeight / 2,
      geometry.barWidth * progress,
      geometry.barHeight,
    );
  } else if (phase === 'morph') {
    ctx.save();
    ctx.translate(width / 2, height * 0.455);
    ctx.fillStyle = paper;
    for (const points of entryMorph(
      geometry,
      entryEase(elapsed / entryTiming.morph),
    ))
      ctx.fill(closedPath(points));
    ctx.restore();
  } else {
    const reveal = clampEntry(elapsed / entryTiming.reveal);
    const camera = entryReveal(geometry, width, height, reveal);
    ctx.save();
    ctx.translate(camera.x, camera.y);
    ctx.rotate(camera.angle);
    ctx.scale(camera.scale, camera.scale);
    ctx.translate(
      -geometry.pivot[0] * camera.camera,
      -geometry.pivot[1] * camera.camera,
    );
    const paths = geometry.target.map(closedPath);
    ctx.fillStyle = paper;
    for (const path of paths) ctx.fill(path);
    // Preserve the last morph frame before gradually revealing the page inside it.
    ctx.globalCompositeOperation = 'destination-out';
    ctx.globalAlpha = camera.aperture;
    for (const path of paths) ctx.fill(path);
    ctx.restore();
  }
  digits(
    ctx,
    width,
    height,
    progress,
    phase === 'reveal' ? clampEntry(elapsed / entryTiming.reveal) : 0,
  );
}
