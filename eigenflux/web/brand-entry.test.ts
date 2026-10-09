import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  entryGeometry,
  entryMorph,
  entryReveal,
  paintEntry,
} from './brand-entry-geometry.ts';
import { entryOutline, type EntryPoint } from './brand-entry-outline.ts';

await test('loading paints one whole percentage without mixed carries or out-of-range readings', () => {
  const labels: string[] = [];
  const context = {
    setTransform() {},
    clearRect() {},
    fillRect() {},
    save() {},
    restore() {},
    beginPath() {},
    rect() {},
    clip() {},
    fillText(text: string) {
      labels.push(text);
    },
  } as unknown as CanvasRenderingContext2D;
  const geometry = entryGeometry(1280);
  let previous = 0;
  for (let step = 0; step <= 1000; step++) {
    labels.length = 0;
    paintEntry(context, geometry, 1280, 900, 1, 'loading', step / 1000, 0);
    assert.equal(
      labels.length,
      1,
      'each frame must have a single complete reading',
    );
    assert.match(labels[0], /^(?:\d|[1-9]\d|100)$/);
    const percent = Number(labels[0]);
    assert.ok(percent >= previous && percent <= 100);
    previous = percent;
  }
  for (const [progress, expected] of [
    [-1, '0'],
    [0.09, '9'],
    [0.1, '10'],
    [0.19, '19'],
    [0.2, '20'],
    [0.99, '99'],
    [1, '100'],
    [3, '100'],
  ] as const) {
    labels.length = 0;
    paintEntry(context, geometry, 1280, 900, 1, 'loading', progress, 0);
    assert.deepEqual(labels, [expected]);
  }
});

await test('the reveal opens gradually from the solid logo before clearing the viewport', () => {
  const geometry = entryGeometry(1280);
  assert.equal(entryReveal(geometry, 1280, 900, 0).aperture, 0);
  let previous = 0;
  for (let frame = 1; frame <= 120; frame++) {
    const opacity = entryReveal(geometry, 1280, 900, frame / 120).aperture;
    assert.ok(opacity >= previous && opacity <= 1);
    assert.ok(
      opacity - previous < 0.04,
      'page visibility must not jump between frames',
    );
    previous = opacity;
  }
  assert.equal(previous, 1);
});

function orientation(a: EntryPoint, b: EntryPoint, c: EntryPoint) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function intersects(points: EntryPoint[]) {
  for (let a = 0; a < points.length; a++) {
    const b = (a + 1) % points.length;
    for (let c = a + 2; c < points.length; c++) {
      const d = (c + 1) % points.length;
      if (d === a) continue;
      if (
        orientation(points[a], points[b], points[c]) *
          orientation(points[a], points[b], points[d]) <
          -1e-8 &&
        orientation(points[c], points[d], points[a]) *
          orientation(points[c], points[d], points[b]) <
          -1e-8
      )
        return true;
    }
  }
  return false;
}

function inside(point: EntryPoint, polygon: EntryPoint[]) {
  let result = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i],
      b = polygon[j];
    if (
      a[1] > point[1] !== b[1] > point[1] &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      result = !result;
  }
  return result;
}

await test('the supplied two arc contours morph without winding crossings', () => {
  assert.deepEqual(
    entryOutline.contours.map((points) => points.length),
    [256, 256],
  );
  for (const width of [320, 1084, 1920]) {
    const geometry = entryGeometry(width);
    for (let step = 0; step <= 40; step++) {
      for (const polygon of entryMorph(geometry, step / 40)) {
        assert.equal(
          intersects(polygon),
          false,
          `crossed outline at width ${width}, progress ${step / 40}`,
        );
      }
    }
  }
});

await test('the final reveal covers every viewport before the curtain is removed', () => {
  for (const [width, height] of [
    [320, 568],
    [360, 740],
    [390, 844],
    [812, 880],
    [1084, 844],
    [1440, 920],
    [1920, 1080],
  ]) {
    const geometry = entryGeometry(width);
    // Earlier than the last frame: the old prototype's total q=.99 was reveal=.9677.
    const camera = entryReveal(geometry, width, height, 0.9677);
    for (let row = 0; row <= 10; row++) {
      for (let column = 0; column <= 10; column++) {
        const x = ((width * column) / 10 - camera.x) / camera.scale;
        const y = ((height * row) / 10 - camera.y) / camera.scale;
        const point: EntryPoint = [
          x * Math.cos(camera.angle) +
            y * Math.sin(camera.angle) +
            geometry.pivot[0] * camera.camera,
          -x * Math.sin(camera.angle) +
            y * Math.cos(camera.angle) +
            geometry.pivot[1] * camera.camera,
        ];
        assert.equal(
          geometry.target.some((polygon) => inside(point, polygon)),
          true,
          `uncovered ${column},${row} at ${width}x${height}`,
        );
      }
    }
  }
});
