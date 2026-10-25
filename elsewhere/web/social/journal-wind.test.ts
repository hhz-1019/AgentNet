import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  JOURNAL_WIND_CYCLE_MS,
  JOURNAL_WIND_LIFT_PX,
  paperTiltDegrees,
  sampleJournalWind,
} from './journal-wind.ts';

const strengths = ['ambient', 'gust', 'secondary'] as const;

await test('a top-hinged print lifts at most three pixels at every cover size', () => {
  for (const height of [120, 220, 320, 520]) {
    for (const lift of [-1, 0, 0.5, 1.5, 3, 8]) {
      const angle = (paperTiltDegrees(lift, height) * Math.PI) / 180;
      const bottomDepth = height * Math.sin(angle);
      assert.ok(bottomDepth >= 0 && bottomDepth <= 3 + 1e-12);
      assert.ok(Math.abs(bottomDepth - Math.max(0, Math.min(3, lift))) < 1e-10);
    }
  }
  for (const invalid of [NaN, Infinity, -Infinity]) {
    assert.equal(paperTiltDegrees(invalid, 240), 0);
    assert.equal(paperTiltDegrees(3, invalid), 0);
  }
  assert.equal(paperTiltDegrees(3, 0), 0);
});

await test('the shared clock is deterministic and safe before it starts', () => {
  const times = [0, 120, 1_550, 2_700, 7_600, 19_999, 42_050];
  const forward = times.map(sampleJournalWind);
  const backward = [...times].reverse().map(sampleJournalWind).reverse();
  assert.deepEqual(forward, backward);
  for (const invalid of [-1, -8_000, NaN, Infinity, -Infinity]) {
    assert.deepEqual(sampleJournalWind(invalid), sampleJournalWind(0));
  }
});

await test('all regions stay bounded and paper lift cannot exceed three pixels', () => {
  assert.equal(JOURNAL_WIND_LIFT_PX, 3);
  let strongest = 0;
  for (let time = 0; time <= 5 * JOURNAL_WIND_CYCLE_MS; time += 17) {
    const wind = sampleJournalWind(time);
    for (const key of strengths) {
      assert.ok(Number.isFinite(wind[key]) && wind[key] >= 0 && wind[key] <= 1);
    }
    assert.ok(wind.gust * JOURNAL_WIND_LIFT_PX <= 3);
    assert.ok(wind.secondary * JOURNAL_WIND_LIFT_PX <= 3);
    strongest = Math.max(strongest, wind.gust);
  }
  assert.ok(strongest > 0.99, 'a visible gust must actually arrive');
});

await test('the second region receives a weaker version of the same gust 700 ms later', () => {
  for (let time = 0; time <= 700; time += 50) {
    assert.equal(sampleJournalWind(time).secondary, 0);
  }
  assert.ok(sampleJournalWind(350).gust > 0);
  assert.ok(sampleJournalWind(1_050).secondary > 0);
  const attenuation = sampleJournalWind(2_700).secondary;
  assert.ok(attenuation > 0.5 && attenuation < 1);
  for (let time = 0; time <= 8_000; time += 137) {
    const first = sampleJournalWind(time).gust;
    const second = sampleJournalWind(time + 700).secondary;
    assert.ok(Math.abs(second - first * attenuation) < 1e-12);
  }
  assert.ok(sampleJournalWind(8_200).ambient > 0);
  assert.equal(sampleJournalWind(8_200).gust, 0);
});

await test('a slow rise and longer settling leave more than eight seconds completely still', () => {
  let previous = 0;
  for (let time = 0; time <= 2_000; time += 20) {
    const current = sampleJournalWind(time).gust;
    assert.ok(current >= previous);
    previous = current;
  }
  assert.equal(previous, 1);
  for (let time = 2_020; time <= 8_000; time += 20) {
    const current = sampleJournalWind(time).gust;
    assert.ok(current <= previous);
    previous = current;
  }
  assert.equal(previous, 0);
  assert.equal(JOURNAL_WIND_CYCLE_MS, 20_000);
  for (let cycle = 0; cycle < 3; cycle++) {
    for (let phase = 8_700; phase < JOURNAL_WIND_CYCLE_MS; phase += 100) {
      const wind = sampleJournalWind(cycle * JOURNAL_WIND_CYCLE_MS + phase);
      assert.equal(wind.cycle, cycle);
      for (const key of strengths) assert.equal(wind[key], 0);
    }
  }
});

await test('motion stays continuous at frame cadence, peaks, and cycle boundaries', () => {
  const frameMs = 1_000 / 60;
  let previous = sampleJournalWind(0);
  for (let time = frameMs; time <= 2 * JOURNAL_WIND_CYCLE_MS; time += frameMs) {
    const current = sampleJournalWind(time);
    for (const key of strengths) {
      assert.ok(
        Math.abs(current[key] - previous[key]) < 0.017,
        `${key} must not jump at ${time} ms`,
      );
    }
    previous = current;
  }
  for (const [time, key] of [
    [0, 'gust'],
    [700, 'secondary'],
    [2_000, 'gust'],
    [2_700, 'secondary'],
    [8_000, 'gust'],
    [8_700, 'secondary'],
    [20_000, 'ambient'],
  ] as const) {
    const before = sampleJournalWind(time - 1)[key];
    const at = sampleJournalWind(time)[key];
    const after = sampleJournalWind(time + 1)[key];
    assert.ok(Math.abs(at - before) < 1e-7, `arrive gently at ${time} ms`);
    assert.ok(Math.abs(after - at) < 1e-7, `leave gently at ${time} ms`);
  }
  assert.equal(sampleJournalWind(19_999).cycle, 0);
  assert.equal(sampleJournalWind(20_000).cycle, 1);
});
