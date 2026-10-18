import test from 'node:test';
import assert from 'node:assert/strict';
import layout from '../apps/desktop/dist/renderer/canvas-layout.js';
const { findSameTypeSnap, buildSnapPreview, groupBounds, cleanGroups, parseCanvasLayout } = layout;
const node = (id, x, y, type = 'text-input', width = 300, height = 190) => ({ id, position: { x, y }, width, height, data: { type } });
test('same type snaps on each side using measured size, without overlapping other nodes', () => {
  const target = node('a', 100, 100, 'text-input', 480, 350);
  for (const [x, y] of [[604, 100], [-224, 100], [100, 474], [100, -114]]) {
    const moving = node('b', x + 10, y + 8);
    assert.deepEqual(findSameTypeSnap(moving, [target, moving], [], 1)?.position, { x, y });
  }
  const moving = node('b', 610, 105);
  assert.equal(findSameTypeSnap(moving, [target, moving, node('block', 604, 100, 'output')], [], 1), null);
});
test('snap excludes other types and other groups, scales tolerance by zoom', () => {
  const target = node('a', 0, 0), moving = node('b', 345, 0);
  assert.equal(findSameTypeSnap(moving, [target, moving], [], 2), null);
  assert.ok(findSameTypeSnap(moving, [target, moving], [], 0.5));
  assert.equal(findSameTypeSnap(moving, [node('a', 0, 0, 'output'), moving], [], 1), null);
  assert.equal(findSameTypeSnap(moving, [target, moving], [{ id: 'g', label: 'Group', members: ['a'] }], 1), null);
  assert.ok(findSameTypeSnap(moving, [target, moving], [{ id: 'g', label: 'Group', members: ['a', 'b'] }], 1));
});
test('snap guides trace the proposed shared edges, including negative positions and unequal sizes', () => {
  const target = node('a', -100, -50);
  const horizontal = buildSnapPreview(node('b', 234, -44), target, { x: 224, y: -50 });
  assert.deepEqual(horizontal.bounds, { x: 224, y: -50, width: 300, height: 190 });
  assert.deepEqual(horizontal.lines, [
    { from: { x: -112, y: -50 }, to: { x: 536, y: -50 } },
    { from: { x: -112, y: 140 }, to: { x: 536, y: 140 } }
  ]);
  const vertical = buildSnapPreview(node('b', -95, 170, 'text-input', 480, 350), target, { x: -100, y: 164 });
  assert.deepEqual(vertical.lines, [{ from: { x: -100, y: -62 }, to: { x: -100, y: 526 } }]);
});
test('group bounds include expanded node size; deletion removes stale memberships', () => {
  const group = { id: 'g', label: 'Group', members: ['a', 'b'] };
  assert.deepEqual(groupBounds(group, [node('a', -100, -200), node('b', 300, 50, 'image-input', 600, 700)]),
    { x: -124, y: -244, width: 1048, height: 1018 });
  assert.deepEqual(cleanGroups([group, { id: 'h', label: 'Other', members: ['b', 'missing'] }], new Set(['b'])), [{ ...group, members: ['b'] }]);
  assert.equal(groupBounds(group, []), null);
});
test('saved layout accepts finite positions and valid groups, safely rejects corrupted JSON', () => {
  assert.deepEqual(parseCanvasLayout('{broken'), { positions: {}, groups: [] });
  const restored = parseCanvasLayout(JSON.stringify({ version: 1, positions: { a: { x: -40, y: 9 }, bad: { x: '10', y: 3 } },
    groups: [{ id: 'ui-group:1', label: 'References', members: ['a'] }, { id: 'business-node', label: 'wrong', members: [] }] }));
  assert.deepEqual(restored.positions, { a: { x: -40, y: 9 } });
  assert.equal(restored.groups.length, 1);
});
