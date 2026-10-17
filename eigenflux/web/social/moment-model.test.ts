import test from 'node:test';
import assert from 'node:assert/strict';
import {
  packMoments,
  projectMoment,
  unprojectMoment,
  momentViewportScale,
  momentBounds,
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
void test('received messages stand alone and merge by author without becoming approvals', () => {
  const message = {
    id: '9007199254740993',
    kind: 'private_message' as const,
    agent_id: '2',
    agent_name: '收件伙伴',
    title: '收到私信',
    body: '内容',
    received_at: 1000,
    truncated: false,
  };
  const alone = groupMoments([], '1', 1000, [message]);
  assert.equal(alone.length, 2);
  assert.equal(alone.find((g) => g.id === '2')!.items.length, 0);
  assert.equal(alone.find((g) => g.id === '2')!.messages[0].id, message.id);
  const grouped = groupMoments([base], '1', 1000, [
    message,
    { ...message, kind: 'group_message' },
  ]);
  assert.equal(grouped.length, 2);
  assert.equal(grouped.find((g) => g.id === '2')!.items.length, 1);
  assert.equal(grouped.find((g) => g.id === '2')!.messages.length, 2);
  const viewed = groupMoments([], '1', 1000, [{ ...message, viewed_at: 1000 }]);
  assert.ok(
    alone.find((g) => g.id === '2')!.priority >
      viewed.find((g) => g.id === '2')!.priority,
  );
});
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
void test('initial framing bounds avatar size even with sparse peers or a very wide viewport', () => {
  for (const count of [0, 1, 4, 5, 6, 26, 100]) {
    const circles = packMoments(
      Array.from({ length: count }, (_, i) => ({
        id: String(i),
        priority: 130 - ((i * 37) % 131),
      })),
    );
    for (const [width, height] of [
      [320, 740],
      [700, 900],
      [1440, 800],
      [2200, 1000],
      [3440, 600],
    ]) {
      const scale = momentViewportScale(circles, width, height);
      for (const circle of circles) {
        const diameter = circle.radius * 2 * scale;
        assert(
          diameter >= 48 && diameter <= 224,
          'avatar must stay readable without dominating the viewport',
        );
        if (width <= 390) assert(diameter <= 168);
      }
    }
  }
  assert(Number.isFinite(momentViewportScale([], 0, 0)));
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

void test('owner is a permanent identity node without invented activity', () => {
  const groups = groupMoments([], '9007199254740993', 1000);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].own, true);
  assert.equal(groups[0].id, '9007199254740993');
  assert.deepEqual(groups[0].items, []);
  assert.deepEqual(groups[0].messages, []);
  const layout = packMoments([
    ...groups,
    { id: '2', own: false, priority: 130 },
  ]);
  assert.equal(layout[0].id, groups[0].id);
  assert.equal(layout[0].x, 0);
  assert.equal(layout[0].y, 0);
  assert.equal(
    groupMoments(
      [{ ...base, related_agent: { agent_id: groups[0].id, name: '我' } }],
      groups[0].id,
      1000,
    ).filter((g) => g.own).length,
    1,
  );
});

void test('initial framing uses the available aspect ratio without ballooning faces', () => {
  for (const [width, height] of [
    [1100, 800],
    [900, 1100],
    [1600, 900],
    [390, 740],
  ]) {
    const groups = Array.from({ length: 14 }, (_, i) => ({
      id: String(i),
      own: i === 0,
      priority: i === 0 ? 80 : 65,
    }));
    const circles = packMoments(groups, width / height);
    const scale = momentViewportScale(circles, width, height),
      bounds = momentBounds(
        circles.map((c) =>
          projectMoment(
            { ...c, x: c.x * scale, y: c.y * scale, radius: c.radius * scale },
            width,
            height,
          ),
        ),
      );
    const occupiedWidth = bounds.right - bounds.left;
    const occupiedHeight = bounds.bottom - bounds.top;
    assert(
      (occupiedWidth <= width - 35 && occupiedHeight <= height - 35) ||
        Math.abs(152 * scale - (width < 600 ? 140 : 176)) < 0.01,
      'fit with clearance when possible; otherwise keep the comfortable viewing size',
    );
    assert(
      Math.max(occupiedWidth / width, occupiedHeight / height) >= 0.68 ||
        circles[0].radius * 2 * scale >= (width < 600 ? 140 : 208) - 1,
      'cluster should use meaningful space',
    );
    for (let i = 0; i < circles.length; i++)
      for (const b of circles.slice(i + 1)) {
        const a = circles[i];
        assert(
          Math.hypot(a.x - b.x, a.y - b.y) >=
            Math.max(a.radius, b.radius) * MOMENT_HOVER_SCALE +
              Math.min(a.radius, b.radius) +
              7.9,
        );
      }
  }
});
void test('direct incoming interactions outrank broadcasts and outgoing records do not pretend to be unread', () => {
  const make = (
    id: string,
    kind: 'private_message' | 'broadcast',
    extra = {},
  ) => ({
    id,
    agent_id: id,
    agent_name: id,
    kind,
    title: '',
    body: '',
    received_at: 1000,
    truncated: false,
    ...extra,
  });
  const groups = groupMoments([], 'owner', 1000, [
    make('direct', 'private_message'),
    make('broadcast', 'broadcast'),
    make('outgoing', 'private_message', { direction: 'outgoing' as const }),
    make('viewed', 'private_message', { viewed_at: 2000 }),
  ]);
  const score = (id: string) => groups.find((g) => g.id === id)!.priority;
  assert(score('direct') > score('broadcast'));
  assert(score('broadcast') > score('viewed'));
  assert.equal(score('outgoing'), score('viewed'));
});
void test('expired high-priority items no longer dominate actionable items', () => {
  const stale = {
    ...base,
    expires_at: 900,
    context_ref: { moment: { priority: 100, executor_id: 'host', scopes: {} } },
  };
  const active = {
    ...base,
    attention_id: 'active',
    related_agent: { agent_id: '3', name: '正在等待' },
    context_ref: { moment: { priority: 40, executor_id: 'host', scopes: {} } },
  };
  const groups = groupMoments([stale, active], '1', 1000);
  assert(
    groups.find((g) => g.id === '3')!.priority >
      groups.find((g) => g.id === '2')!.priority,
  );
});

void test('rank and owner identity determine home positions, never absolute score magnitudes', () => {
  const groups = [
    { id: 'owner', own: true, priority: 1 },
    ...Array.from({ length: 18 }, (_, i) => ({
      id: String(i),
      priority: 100 - i,
    })),
  ];
  const layout = packMoments(groups);
  assert.deepEqual(
    layout,
    packMoments(groups.map((g) => ({ ...g, priority: g.priority * 20 + 700 }))),
  );
  assert.equal(layout[0].id, 'owner');
  assert.deepEqual([layout[0].x, layout[0].y], [0, 0]);
});
void test('sphere focus moves with the camera, preserves separation and supports reversible gestures', () => {
  for (const [width, height] of [
    [390, 740],
    [1100, 720],
    [1600, 900],
  ]) {
    const circles = packMoments(
      Array.from({ length: 40 }, (_, i) => ({
        id: String(i),
        own: i === 0,
        priority: 100 - i,
      })),
      width / height,
    );
    const scale = momentViewportScale(circles, width, height);
    for (const focus of [circles[0], circles[6], circles[20]]) {
      const projected = circles.map((c) =>
        projectMoment(
          {
            ...c,
            x: (c.x - focus.x) * scale,
            y: (c.y - focus.y) * scale,
            radius: c.radius * scale,
          },
          width,
          height,
        ),
      );
      const center = projected.find((c) => c.id === focus.id)!;
      assert.equal(Math.hypot(center.x, center.y), 0);
      assert.equal(center.radius, Math.max(...projected.map((c) => c.radius)));
      for (let i = 0; i < projected.length; i++)
        for (const b of projected.slice(i + 1)) {
          const a = projected[i];
          assert(
            Math.hypot(a.x - b.x, a.y - b.y) >
              Math.max(a.radius, b.radius) * MOMENT_HOVER_SCALE +
                Math.min(a.radius, b.radius),
            'faces remain separate during panning',
          );
        }
      for (const c of circles) {
        const input = { x: c.x * scale + 123, y: c.y * scale - 78 };
        const output = projectMoment(
          { ...input, id: c.id, radius: 76 },
          width,
          height,
        );
        const restored = unprojectMoment(output, width, height);
        assert(Math.hypot(restored.x - input.x, restored.y - input.y) < 0.001);
      }
    }
  }
});

void test('dense networks keep comfortable faces instead of fitting every peer into the first view', () => {
  const groups = Array.from({ length: 40 }, (_, i) => ({
    id: 'person-' + i,
    own: i === 0,
    priority: 100 - i,
  }));
  for (const [width, height] of [
    [1100, 720],
    [1260, 900],
    [900, 1100],
  ]) {
    const circles = packMoments(groups, width / height);
    assert.deepEqual(
      circles,
      packMoments([...groups].reverse(), width / height),
    );
    const scale = momentViewportScale(circles, width, height);
    const projected = circles.map((c) =>
      projectMoment(
        { ...c, x: c.x * scale, y: c.y * scale, radius: c.radius * scale },
        width,
        height,
      ),
    );
    const bounds = momentBounds(projected);
    assert.equal(152 * scale, 176);
    assert(
      Math.max(-bounds.left, bounds.right) > width / 2 ||
        Math.max(-bounds.top, bounds.bottom) > height / 2,
      'a dense network should extend beyond the first viewport',
    );
    const distinctRows = new Set(circles.map((c) => Math.round(c.y / 5)));
    assert(distinctRows.size > 25, 'avoid repeated grid rows');
    assert.equal(circles[0].id, 'person-0');
  }
});

void test('adding distant peers leaves the first view at the same size and position', () => {
  const make = (count: number) =>
    Array.from({ length: count }, (_, i) => ({
      id: 'person-' + i,
      own: i === 0,
      priority: 1000 - i,
    }));
  for (const [width, height] of [
    [390, 774],
    [1100, 720],
    [1260, 900],
  ]) {
    const forty = packMoments(make(40), width / height);
    const hundred = packMoments(make(100), width / height);
    assert.deepEqual(forty, hundred.slice(0, 40));
    const scale = momentViewportScale(forty, width, height);
    assert.equal(scale, momentViewportScale(hundred, width, height));
    for (const c of hundred) {
      const shown = projectMoment(
        { ...c, x: c.x * scale, y: c.y * scale, radius: c.radius * scale },
        width,
        height,
      );
      assert(
        shown.radius * 2 >= 44,
        'resting avatars never become unreadable points',
      );
    }
    const sparse = packMoments(make(4), width / height);
    const sparseDiameter = 152 * momentViewportScale(sparse, width, height);
    assert(sparseDiameter >= 152 * scale && sparseDiameter <= 208);
  }
});
