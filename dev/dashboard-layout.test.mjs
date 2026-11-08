import test from 'node:test'
import assert from 'node:assert/strict'
import { readLayout, overlaps, placeItem, appendItem, ordered } from '../frontend/src/dashboard-layout.ts'

const a = { chartId: 'a', x: 0, y: 0, w: 6, h: 9 }
const b = { chartId: 'b', x: 6, y: 0, w: 6, h: 9 }
test('legacy charts get deterministic two-column positions', () => {
  assert.deepEqual(readLayout([{ id: 'a', position: 0 }, { id: 'b', position: 1 }, { id: 'c', position: 2 }]), [a, b, { chartId: 'c', x: 0, y: 9, w: 6, h: 9 }])
})
test('resize pushes collisions down and preserves distinct chart identity', () => {
  const result = placeItem([a, b], { ...a, w: 9, h: 12 })
  assert.equal(result[0].w, 9)
  assert.equal(result[1].y, 12)
  assert.equal(overlaps(result[0], result[1]), false)
  assert.deepEqual(a, { chartId: 'a', x: 0, y: 0, w: 6, h: 9 })
})
test('movement clamps to the grid and avoids overlapping at boundaries', () => {
  const result = placeItem([a, b], { ...a, x: 100, y: -2 })
  assert.equal(result[0].x, 6)
  assert.equal(result[0].y, 0)
  assert.equal(overlaps(result[0], result[1]), false)
})
test('appending fills free space without changing existing items', () => {
  const result = appendItem([a, b], 'c')
  assert.equal(result[2].y, 9)
  assert.deepEqual(result.slice(0, 2), [a, b])
  assert.throws(() => appendItem([a], 'a'))
  assert.throws(() => appendItem(Array.from({ length: 24 }, (_, i) => ({ ...a, chartId: String(i) })), 'extra'))
})
test('saved coordinates and visual ordering are retained', () => {
  const layout = readLayout([{ id: 'a', x: 3, y: 20, w: 9, h: 10 }, { id: 'b', x: 0, y: 0, w: 3, h: 6 }])
  assert.deepEqual(layout[0], { chartId: 'a', x: 3, y: 20, w: 9, h: 10 })
  assert.equal(ordered(layout)[0].chartId, 'b')
})
test('fractional coordinates are rejected rather than saved', () => {
  assert.throws(() => placeItem([a, b], { ...a, x: 0.5 }))
})
