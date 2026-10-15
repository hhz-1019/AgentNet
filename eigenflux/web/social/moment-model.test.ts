import test from 'node:test';
import assert from 'node:assert/strict';
import {
  packMoments,
  momentViewportScale,
  momentRepulsion,
  MOMENT_HOVER_SCALE,
} from './moment-layout.ts';
import { prepareDecision } from './moment-decision.ts';
import { zoomMoment } from './moment-zoom.ts';
import {
  groupMoments,
  momentStage,
  hasMomentReceipt,
  type MomentItem,
} from './moment-model.ts';
const base: MomentItem = {
  attention_id: '1',
  title: '测试',
  body: '',
  recommendation: '',
  category: 'other_decision',
  status: 'open',
  response_status: 'none',
  item_revision: 1,
  created_at: 1,
  expires_at: 5000,
  related_agent: { agent_id: '2', name: '伙伴' },
  actions: [],
};
void test('an expired revoked decision cannot be reopened', () => {
  const item = {
    ...base,
    status: 'dismissed',
    command: {
      command_id: 'c',
      status: 'failed',
      revoked_at: 1000,
      selected_at: 500,
    },
  };
  assert.equal(momentStage(item, 2000), 'revoked');
  assert.equal(momentStage(item, 6000), 'expired');
});
void test('mouse repulsion is bounded, points away, returns to rest and preserves hover clearance', () => {
  const layout = packMoments(
    Array.from({ length: 26 }, (_, i) => ({
      id: String(i),
      priority: 130 - ((i * 37) % 131),
    })),
  );
  for (const scale of [0.45, 1, 3]) {
    const circles = layout.map((c) => ({
      ...c,
      x: c.x * scale,
      y: c.y * scale,
      radius: c.radius * scale,
    }));
    for (const pointer of [
      { x: 0, y: 0 },
      { x: 45, y: 20 },
      { x: -180, y: 160 },
      { x: 9000, y: 9000 },
    ]) {
      const offsets = momentRepulsion(circles, pointer);
      circles.forEach((a, i) => {
        const motion = offsets[i];
        assert(
          Math.hypot(motion.x, motion.y) <=
            Math.min(18, a.radius * 0.3) + 0.00001,
          'force cannot grow with zoom',
        );
        assert(
          motion.x * (a.x - pointer.x) + motion.y * (a.y - pointer.y) >=
            -0.00001,
          'always repel, never attract',
        );
        for (let j = i + 1; j < circles.length; j++) {
          const b = circles[j];
          assert(
            Math.hypot(
              a.x + motion.x - b.x - offsets[j].x,
              a.y + motion.y - b.y - offsets[j].y,
            ) >=
              Math.max(a.radius, b.radius) * MOMENT_HOVER_SCALE +
                Math.min(a.radius, b.radius),
            'moving faces must retain hover clearance',
          );
        }
      });
    }
    assert(
      momentRepulsion(circles, null).every(
        (offset) => offset.x === 0 && offset.y === 0,
      ),
    );
  }
  const single = [{ id: 'one', x: 0, y: 0, radius: 80 }];
  const desktopScale = momentViewportScale(layout, 1440, 800);
  const desktop = layout.map((c) => ({
    ...c,
    x: c.x * desktopScale,
    y: c.y * desktopScale,
    radius: c.radius * desktopScale,
  }));
  for (const pointer of [
    { x: 45, y: 20 },
    { x: -180, y: 160 },
    { x: 300, y: 0 },
  ]) {
    assert(
      Math.max(
        ...momentRepulsion(desktop, pointer).map((offset) =>
          Math.hypot(offset.x, offset.y),
        ),
      ) >= 6,
      'dense desktop layouts must retain visible motion, not only a large theoretical maximum',
    );
  }
  assert.equal(momentRepulsion(single, { x: 40, y: 0 })[0].x, -18);
  assert.equal(momentRepulsion(single, { x: 0, y: 0 })[0].x, 0);
  assert.equal(Math.abs(momentRepulsion(single, { x: 1000, y: 0 })[0].x), 0);
  const adjacent = [
    { id: 'left', x: -90, y: 0, radius: 80 },
    { id: 'right', x: 90, y: 0, radius: 80 },
  ];
  const separating = momentRepulsion(adjacent, { x: 0, y: 0 });
  assert(
    separating[0].x < -15 && separating[1].x > 15,
    'neighbors moving apart must visibly respond instead of losing force to the collision guard',
  );
});
void test('pinch preserves the world point under moving fingers and clamps zoom without drift', () => {
  const camera = { x: 80, y: -30, zoom: 1 };
  const anchor = { x: -120, y: 70 };
  const destination = { x: -90, y: 100 };
  const world = {
    x: (anchor.x - camera.x) / camera.zoom,
    y: (anchor.y - camera.y) / camera.zoom,
  };
  for (const requested of [0.01, 0.7, 1.8, 9]) {
    const next = zoomMoment(camera, requested, anchor, destination);
    assert(next.zoom >= 0.45 && next.zoom <= 2.5);
    assert.equal(world.x * next.zoom + next.x, destination.x);
    assert.equal(world.y * next.zoom + next.y, destination.y);
    assert.deepEqual(zoomMoment(next, 1, destination, anchor), camera);
  }
  const max = zoomMoment(camera, 9, anchor);
  assert.deepEqual(zoomMoment(max, 9, anchor), max);
});
void test('approval selects available delivery and preserves it across uncertain save retries', () => {
  const body = {
    action_key: 'accept',
    expected_item_revision: 1,
    condition: '仅加好友',
  };
  const executor = 'chat_00000000-0000-4000-8000-000000000001';
  const background = prepareDecision(undefined, '1', body, '');
  assert.equal('chat_executor' in background.body, false);
  assert.strictEqual(
    prepareDecision(background, '1', body, executor),
    background,
  );
  const chat = prepareDecision(undefined, '1', body, executor);
  assert.equal(chat.body.chat_executor, executor);
  assert.strictEqual(prepareDecision(chat, '1', body, ''), chat);
  const updated = prepareDecision(
    chat,
    '1',
    { ...body, expected_item_revision: 2 },
    '',
  );
  assert.notEqual(updated.key, chat.key);
  assert.equal('chat_executor' in updated.body, false);
  assert.equal(updated.body.condition, body.condition);
});
void test('avatar cluster keeps priority central, touch targets usable and every circle separate', () => {
  for (const count of [0, 1, 2, 24, 100]) {
    const input = Array.from({ length: count }, (_, i) => ({
      id: String(i),
      priority: 130 - ((i * 37) % 131),
    }));
    const layout = packMoments(input);
    assert.deepEqual(
      layout,
      packMoments([...input].reverse()),
      'packing must be stable across API order',
    );
    if (count) assert.deepEqual([layout[0].x, layout[0].y], [0, 0]);
    layout.forEach((circle, index) => {
      assert(
        circle.radius * 2 * 0.7 >= 44,
        'smallest responsive target remains usable',
      );
      if (index) {
        const previous = layout[index - 1];
        assert(circle.radius <= previous.radius);
        assert(
          Math.hypot(circle.x, circle.y) >=
            Math.hypot(previous.x, previous.y) - 0.01,
        );
      }
      for (const other of layout.slice(index + 1)) {
        assert(
          Math.hypot(circle.x - other.x, circle.y - other.y) >=
            Math.max(circle.radius, other.radius) * MOMENT_HOVER_SCALE +
              Math.min(circle.radius, other.radius) +
              1.98,
          'avatars must never overlap when one is emphasized by hover or keyboard',
        );
      }
    });
  }
});
void test('initial framing extends the cluster beyond all viewport edges and corners', () => {
  for (const count of [5, 26, 100]) {
    const circles = packMoments(
      Array.from({ length: count }, (_, i) => ({
        id: String(i),
        priority: 130 - ((i * 37) % 131),
      })),
    );
    for (const [width, height] of [
      [360, 740],
      [700, 900],
      [1440, 800],
      [2200, 1000],
    ]) {
      const scale = momentViewportScale(circles, width, height);
      // Check directions independently of the fitting samples, including the
      // corner silhouette that an axis-aligned bounding-box fit misses.
      for (let degree = 0; degree < 360; degree++) {
        const angle = (degree * Math.PI) / 180;
        const dx = Math.cos(angle),
          dy = Math.sin(angle);
        const clusterEdge = Math.max(
          ...circles.map((c) => (c.x * dx + c.y * dy + c.radius) * scale),
        );
        const viewportEdge =
          (width / 2) * Math.abs(dx) + (height / 2) * Math.abs(dy);
        assert(
          clusterEdge >= viewportEdge + 24,
          `unfilled edge: ${count} avatars, ${width}x${height}, ${degree}deg`,
        );
      }
    }
  }
  assert.equal(momentViewportScale([], 1440, 800), 1.35);
  assert.equal(
    momentViewportScale(packMoments([{ id: 'one', priority: 130 }]), 1440, 800),
    1.35,
  );
});
void test('groups by real agent and preserves large decimal IDs', () => {
  const groups = groupMoments(
    [
      base,
      { ...base, attention_id: '9007199254740993' },
      {
        ...base,
        attention_id: '3',
        related_agent: { agent_id: '1', name: '自己' },
      },
    ],
    '1',
    1000,
  );
  assert.equal(groups.length, 2);
  assert.equal(groups.find((g) => g.id === '2')?.items.length, 2);
  assert.equal(groups.find((g) => g.id === '1')?.own, true);
});
void test('saved, claimed, completed, revoked and expired are separate states', () => {
  const command = { command_id: '1', status: 'pending', selected_at: 1 };
  assert.equal(
    hasMomentReceipt({ ...base, command: { ...command, result: {} } }),
    false,
  );
  assert.equal(
    hasMomentReceipt({
      ...base,
      command: {
        ...command,
        status: 'completed',
        result: { summary: '已读回文件' },
      },
    }),
    true,
  );
  assert.equal(momentStage({ ...base, command }, 1000), 'pending');
  assert.equal(
    momentStage({ ...base, command: { ...command, status: 'claimed' } }, 1000),
    'executing',
  );
  assert.equal(
    momentStage(
      {
        ...base,
        command: {
          ...command,
          status: 'completed',
          result: { summary: '已执行' },
        },
      },
      6000,
    ),
    'completed',
  );
  assert.equal(momentStage({ ...base, command }, 6000), 'expired');
  assert.equal(
    momentStage(
      { ...base, status: 'dismissed', command: { ...command, revoked_at: 10 } },
      1000,
    ),
    'revoked',
  );
  assert.equal(
    momentStage(
      { ...base, command: { ...command, status: 'failed', revoked_at: 10 } },
      1000,
    ),
    'open',
  );
});
