import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng, hashString } from '../src/rng.js';
import { generateShape, GENERATORS, WORLD } from '../src/shapes.js';
import { pointInRing, signedArea } from '../src/geometry.js';

function segmentsCross(a, b, c, d) {
  const o = (p, q, r) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}

function edges(pts) {
  return pts.map((p, i) => [p, pts[(i + 1) % pts.length]]);
}

function assertValid(shape, label) {
  assert.ok(shape.area > 1000, `${label}: area too small (${shape.area})`);
  const outers = shape.rings.filter((r) => !r.hole);
  const holes = shape.rings.filter((r) => r.hole);
  assert.ok(outers.length >= 1, `${label}: no outer ring`);
  for (const r of shape.rings) {
    assert.ok(r.hole ? signedArea(r.pts) < 0 : signedArea(r.pts) > 0, `${label}: bad orientation`);
    for (const p of r.pts) {
      assert.ok(p.x >= 149 && p.x <= WORLD - 149 && p.y >= 149 && p.y <= WORLD - 149, `${label}: out of box`);
    }
  }
  for (const h of holes) {
    assert.ok(outers.some((o) => h.pts.every((p) => pointInRing(p, o.pts))), `${label}: hole escapes`);
  }
  for (let i = 0; i < shape.rings.length; i++) {
    for (let j = i + 1; j < shape.rings.length; j++) {
      for (const [a, b] of edges(shape.rings[i].pts)) {
        for (const [c, d] of edges(shape.rings[j].pts)) {
          assert.ok(!segmentsCross(a, b, c, d), `${label}: rings ${i} and ${j} intersect`);
        }
      }
    }
  }
}

test('every tier produces valid shapes', () => {
  const seen = new Set();
  for (let tier = 1; tier <= 5; tier++) {
    const rng = createRng(hashString(`tier-${tier}`));
    for (let i = 0; i < 300; i++) {
      const { shape, kind } = generateShape(rng, tier);
      seen.add(kind);
      assertValid(shape, `tier ${tier} #${i} (${kind})`);
    }
  }
  for (const g of GENERATORS) assert.ok(seen.has(g.id), `generator ${g.id} never produced`);
});

test('generation is deterministic for a seed', () => {
  const a = generateShape(createRng(42), 4).shape;
  const b = generateShape(createRng(42), 4).shape;
  assert.deepEqual(a, b);
});
