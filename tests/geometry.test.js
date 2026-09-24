import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createShape, idealOffset, lineThrough, pointInShape, splitByLine } from '../src/geometry.js';

const square = (x, y, s) => [
  { x, y },
  { x: x + s, y },
  { x: x + s, y: y + s },
  { x, y: y + s },
];

test('area of a shape with a hole', () => {
  const shape = createShape([{ pts: square(0, 0, 10) }, { pts: square(2, 2, 2), hole: true }]);
  assert.equal(shape.area, 96);
});

test('orientation is normalised regardless of input winding', () => {
  const shape = createShape([{ pts: square(0, 0, 10).reverse() }, { pts: square(2, 2, 2).reverse(), hole: true }]);
  assert.equal(shape.area, 96);
});

test('vertical cut through the middle of a square is 50:50', () => {
  const shape = createShape([{ pts: square(0, 0, 10) }]);
  const { pos, neg, ratio } = splitByLine(shape, lineThrough({ x: 5, y: -5 }, { x: 5, y: 20 }));
  assert.ok(Math.abs(ratio - 0.5) < 1e-12);
  assert.ok(Math.abs(pos.area + neg.area - 100) < 1e-9);
  // centroids sit on opposite sides of x = 5
  assert.ok((pos.cx - 5) * (neg.cx - 5) < 0);
});

test('concave shapes split exactly (U shape cut across both arms)', () => {
  const u = [
    { x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 8 }, { x: 8, y: 8 },
    { x: 8, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 },
  ];
  const shape = createShape([{ pts: u }]);
  // Horizontal line y = 4 cuts off the upper halves of both arms: 2 * (2*4) = 16
  const { pos, neg } = splitByLine(shape, lineThrough({ x: -1, y: 4 }, { x: 11, y: 4 }));
  const areas = [pos.area, neg.area].sort((a, b) => a - b);
  assert.ok(Math.abs(areas[0] - 16) < 1e-9);
  assert.ok(Math.abs(areas[1] - (shape.area - 16)) < 1e-9);
});

test('islands and holes are all accounted for', () => {
  const shape = createShape([
    { pts: square(0, 0, 4) },
    { pts: square(10, 0, 4) },
    { pts: square(11, 1, 2), hole: true },
  ]);
  assert.equal(shape.area, 28);
  const { ratio } = splitByLine(shape, lineThrough({ x: 7, y: -1 }, { x: 7, y: 5 }));
  // left island (16) vs right island minus hole (12), which side is positive depends on direction
  assert.ok(Math.abs(Math.min(ratio, 1 - ratio) - 12 / 28) < 1e-12);
});

test('idealOffset halves the area for any direction', () => {
  const shape = createShape([
    { pts: [{ x: 0, y: 0 }, { x: 30, y: 2 }, { x: 18, y: 25 }, { x: 4, y: 14 }] },
    { pts: square(10, 6, 4), hole: true },
  ]);
  for (let a = 0; a < Math.PI * 2; a += 0.37) {
    const nx = Math.cos(a);
    const ny = Math.sin(a);
    const d = idealOffset(shape, nx, ny);
    const { ratio } = splitByLine(shape, { nx, ny, d });
    assert.ok(Math.abs(ratio - 0.5) < 1e-9, `angle ${a}: ${ratio}`);
  }
});

test('pointInShape respects holes', () => {
  const shape = createShape([{ pts: square(0, 0, 10) }, { pts: square(4, 4, 2), hole: true }]);
  assert.equal(pointInShape({ x: 1, y: 1 }, shape), true);
  assert.equal(pointInShape({ x: 5, y: 5 }, shape), false);
  assert.equal(pointInShape({ x: 11, y: 5 }, shape), false);
});
