// Procedural shape generation, organised by difficulty tier (1–5).
//
// Every generator produces simple rings by construction: radial polygons with
// monotonic angles, hand-built templates, and islands / holes placed with a
// clearance guarantee so no two rings can ever touch.

import {
  boundsOf,
  createShape,
  distToRing,
  fitRings,
  pointInRing,
  rotateRings,
} from './geometry.js';

const TAU = Math.PI * 2;
const P = (x, y) => ({ x, y });

export const WORLD = 1000;
const FIT_BOX = { x: 150, y: 150, w: 700, h: 700 };

// ---------------------------------------------------------------- primitives

function radial(rng, n, { min = 0.8, max = 1.2, jitter = 0.3 } = {}) {
  const pts = [];
  const step = TAU / n;
  const start = rng.range(0, TAU);
  for (let i = 0; i < n; i++) {
    const a = start + step * (i + rng.range(-jitter, jitter));
    const r = rng.range(min, max);
    pts.push(P(Math.cos(a) * r, Math.sin(a) * r));
  }
  return pts;
}

function harmonicBlob(rng, { n = 120, amp = 0.5, ks = [2, 3, 4, 5], terms = 3 } = {}) {
  const chosen = [];
  const pool = ks.slice();
  for (let i = 0; i < terms && pool.length; i++) {
    chosen.push(pool.splice(Math.floor(rng.next() * pool.length), 1)[0]);
  }
  const raw = chosen.map((k) => ({ k, a: rng.range(0.4, 1), ph: rng.range(0, TAU) }));
  const sum = raw.reduce((s, t) => s + t.a, 0);
  raw.forEach((t) => (t.a = (t.a / sum) * amp));
  const pts = [];
  for (let i = 0; i < n; i++) {
    const th = (i / n) * TAU;
    let r = 1;
    for (const t of raw) r += t.a * Math.sin(t.k * th + t.ph);
    pts.push(P(Math.cos(th) * r, Math.sin(th) * r));
  }
  return pts;
}

function circle(n = 72) {
  return Array.from({ length: n }, (_, i) => P(Math.cos((i / n) * TAU), Math.sin((i / n) * TAU)));
}

/** Rotate an origin-centred outline and scale it so it fits in circle (c, r). */
function placeInCircle(pts, c, r, angle) {
  const b = boundsOf([{ pts }]);
  const ox = (b.minX + b.maxX) / 2;
  const oy = (b.minY + b.maxY) / 2;
  const cs = Math.cos(angle);
  const sn = Math.sin(angle);
  const centred = pts.map((p) => {
    const x = p.x - ox;
    const y = p.y - oy;
    return P(x * cs - y * sn, x * sn + y * cs);
  });
  const far = Math.max(...centred.map((p) => Math.hypot(p.x, p.y)));
  const k = r / far;
  return centred.map((p) => P(c.x + p.x * k, c.y + p.y * k));
}

// ---------------------------------------------------------------- outlines

const LETTERS = {
  L(rng) {
    const w = 1;
    const h = rng.range(1.1, 1.7);
    const a = rng.range(0.28, 0.45);
    const b = rng.range(0.28, 0.45);
    return [P(0, 0), P(a, 0), P(a, h - b), P(w, h - b), P(w, h), P(0, h)];
  },
  T(rng) {
    const w = 1.3;
    const h = rng.range(1.0, 1.5);
    const b = rng.range(0.25, 0.4);
    const a = rng.range(0.25, 0.42);
    const off = rng.range(-0.3, 0.3);
    const l = w / 2 + off - a / 2;
    const r = w / 2 + off + a / 2;
    return [P(0, 0), P(w, 0), P(w, b), P(r, b), P(r, h), P(l, h), P(l, b), P(0, b)];
  },
  plus(rng) {
    const w = 1.3;
    const h = rng.range(1.1, 1.5);
    const a = rng.range(0.28, 0.42);
    const b = rng.range(0.28, 0.42);
    const vx = rng.range(0.2, w - a - 0.2);
    const hy = rng.range(0.2, h - b - 0.2);
    return [
      P(vx, 0), P(vx + a, 0), P(vx + a, hy), P(w, hy), P(w, hy + b), P(vx + a, hy + b),
      P(vx + a, h), P(vx, h), P(vx, hy + b), P(0, hy + b), P(0, hy), P(vx, hy),
    ];
  },
  arrow(rng) {
    const len = rng.range(0.9, 1.3);
    const s = rng.range(0.14, 0.24);
    const head = rng.range(0.38, 0.55);
    const tip = rng.range(0.45, 0.7);
    return [P(0, -s), P(len, -s), P(len, -head), P(len + tip, 0), P(len, head), P(len, s), P(0, s)];
  },
  U(rng) {
    const w = 1.2;
    const h = rng.range(0.9, 1.4);
    const a = rng.range(0.25, 0.4);
    const a2 = rng.range(0.25, 0.4);
    const b = rng.range(0.25, 0.4);
    return [P(0, 0), P(a, 0), P(a, h - b), P(w - a2, h - b), P(w - a2, 0), P(w, 0), P(w, h), P(0, h)];
  },
  stairs(rng) {
    const steps = rng.int(3, 4);
    const pts = [P(0, 0)];
    let x = 0;
    let y = 0;
    for (let i = 0; i < steps; i++) {
      x += rng.range(0.25, 0.45);
      pts.push(P(x, y));
      y += rng.range(0.25, 0.45);
      pts.push(P(x, y));
    }
    pts.push(P(0, y));
    return pts;
  },
};

const OUTLINES = {
  polygon: (rng) => radial(rng, rng.int(5, 8), { min: 0.82, max: 1.12, jitter: 0.22 }),
  triangle: (rng) => radial(rng, 3, { min: 0.85, max: 1.1, jitter: 0.18 }),
  quad(rng) {
    const w = 1;
    const h = rng.range(0.45, 0.85);
    const kind = rng.int(0, 2);
    if (kind === 0) return [P(0, 0), P(w, 0), P(w, h), P(0, h)];
    if (kind === 1) {
      const s = rng.range(0.15, 0.4);
      return [P(s, 0), P(w + s, 0), P(w, h), P(0, h)];
    }
    return [P(rng.range(0.1, 0.35), 0), P(w - rng.range(0, 0.3), 0), P(w, h), P(0, h)];
  },
  egg: (rng) => harmonicBlob(rng, { amp: rng.range(0.12, 0.22), ks: [1, 2], terms: 2 }),
  spiky: (rng) => radial(rng, rng.int(7, 13), { min: 0.42, max: 1.25, jitter: 0.3 }),
  star(rng) {
    const k = rng.int(5, 8);
    const start = rng.range(0, TAU);
    const inner = rng.range(0.38, 0.58);
    const pts = [];
    for (let i = 0; i < k * 2; i++) {
      const a = start + (i / (k * 2)) * TAU;
      const r = i % 2 === 0 ? rng.range(0.85, 1.15) : inner * rng.range(0.85, 1.15);
      pts.push(P(Math.cos(a) * r, Math.sin(a) * r));
    }
    return pts;
  },
  blob: (rng) => harmonicBlob(rng, { amp: rng.range(0.4, 0.62), terms: rng.int(2, 3) }),
  heart(rng) {
    const n = 90;
    const sx = rng.range(0.85, 1.15);
    const pts = [];
    for (let i = 0; i < n; i++) {
      const t = (i / n) * TAU;
      const x = 16 * Math.sin(t) ** 3 * sx;
      const y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
      pts.push(P(x / 16, y / 16));
    }
    return pts;
  },
  letter: (rng) => LETTERS[rng.pick(Object.keys(LETTERS))](rng),
  arc(rng) {
    const gap = rng.range(0.7, 1.7);
    const inner = rng.range(0.42, 0.66);
    const n = 56;
    const outer = [];
    const innerPts = [];
    for (let i = 0; i <= n; i++) {
      const a = gap / 2 + (i / n) * (TAU - gap);
      outer.push(P(Math.cos(a), Math.sin(a)));
      innerPts.push(P(Math.cos(a) * inner, Math.sin(a) * inner));
    }
    return outer.concat(innerPts.reverse());
  },
  comb(rng) {
    const teeth = rng.int(3, 5);
    const segs = teeth * 2 - 1;
    const widths = Array.from({ length: segs }, (_, i) => (i % 2 === 0 ? rng.range(0.8, 1.4) : rng.range(0.6, 1.2)));
    const total = widths.reduce((a, b) => a + b, 0);
    const W = 1.6;
    const base = rng.range(0.22, 0.34);
    const pts = [P(0, base)];
    let x = 0;
    widths.forEach((w, i) => {
      const xe = x + (w / total) * W;
      if (i % 2 === 0) {
        const h = rng.range(0.45, 1.1);
        pts.push(P(x, -h), P(xe, -h), P(xe, 0));
      }
      x = xe;
    });
    pts.push(P(W, base));
    return pts;
  },
};

// ---------------------------------------------------------------- composites

/** Punch holes into an outer ring, each with guaranteed clearance. */
function punchHoles(rng, outer, count, { minFrac = 0.1, size = [0.5, 0.78], round = false } = {}) {
  const b = boundsOf([{ pts: outer }]);
  const span = Math.max(b.w, b.h);
  const placed = [];
  for (let k = 0; k < count; k++) {
    for (let t = 0; t < 400; t++) {
      const c = P(rng.range(b.minX, b.maxX), rng.range(b.minY, b.maxY));
      if (!pointInRing(c, outer)) continue;
      let clear = distToRing(c, outer);
      for (const h of placed) clear = Math.min(clear, Math.hypot(c.x - h.c.x, c.y - h.c.y) - h.r);
      if (clear < span * minFrac) continue;
      const r = clear * rng.range(size[0], size[1]);
      const kind = round ? 'circle' : rng.pick(['circle', 'polygon', 'blob']);
      const base =
        kind === 'circle' ? circle(48)
        : kind === 'polygon' ? radial(rng, rng.int(5, 8), { min: 0.75, max: 1, jitter: 0.2 })
        : harmonicBlob(rng, { n: 60, amp: 0.25, terms: 2 });
      const far = Math.max(...base.map((p) => Math.hypot(p.x, p.y)));
      placed.push({ c, r, pts: base.map((p) => P(c.x + (p.x / far) * r, c.y + (p.y / far) * r)) });
      break;
    }
  }
  return placed.map((h) => ({ pts: h.pts, hole: true }));
}

function placeCircles(rng, count) {
  for (let scale = 1; scale > 0.3; scale *= 0.9) {
    const circles = [];
    for (let tries = 0; circles.length < count && tries < 500; tries++) {
      const r = rng.range(0.3, 0.58) * scale * (circles.length === 0 ? 1.3 : 1);
      const c = { x: rng.range(-1.25 + r, 1.25 - r), y: rng.range(-1 + r, 1 - r), r };
      if (circles.every((o) => Math.hypot(c.x - o.x, c.y - o.y) > c.r + o.r + 0.14)) circles.push(c);
    }
    if (circles.length === count) return circles;
  }
  return Array.from({ length: count }, (_, i) => ({ x: i * 1.2, y: 0, r: 0.5 }));
}

const ISLAND_OUTLINES = ['polygon', 'blob', 'star', 'heart', 'letter', 'egg', 'spiky', 'triangle'];

function islands(rng, count, holeChance = 0) {
  return placeCircles(rng, count).flatMap((c) => {
    const pts = placeInCircle(OUTLINES[rng.pick(ISLAND_OUTLINES)](rng), c, c.r, rng.range(0, TAU));
    const holes = rng.chance(holeChance) ? punchHoles(rng, pts, 1, { minFrac: 0.16 }) : [];
    return [{ pts }, ...holes];
  });
}

function holed(rng, outlineIds, count, opts) {
  const outer = OUTLINES[rng.pick(outlineIds)](rng);
  const holes = punchHoles(rng, outer, count, opts);
  return holes.length === count ? [{ pts: outer }, ...holes] : null;
}

const single = (id) => (rng) => [{ pts: OUTLINES[id](rng) }];

// ---------------------------------------------------------------- catalogue

export const GENERATORS = [
  { id: 'polygon', name: '多角形', tiers: [1, 2], make: single('polygon') },
  { id: 'triangle', name: '三角形', tiers: [1, 1], make: single('triangle') },
  { id: 'quad', name: '四角形', tiers: [1, 1], make: single('quad') },
  { id: 'egg', name: 'たまご', tiers: [1, 2], make: single('egg') },
  { id: 'spiky', name: 'トゲトゲ', tiers: [2, 3], make: single('spiky') },
  { id: 'star', name: '星', tiers: [2, 3], make: single('star') },
  { id: 'letter', name: 'ブロック', tiers: [2, 4], make: single('letter') },
  { id: 'heart', name: 'ハート', tiers: [2, 3], make: single('heart') },
  { id: 'blob', name: 'ぷにぷに', tiers: [2, 4], make: single('blob') },
  { id: 'arc', name: 'C字', tiers: [3, 4], make: single('arc') },
  { id: 'holed', name: '穴あき', tiers: [3, 5], make: (rng) => holed(rng, ['blob', 'polygon', 'heart', 'egg'], 1) },
  {
    id: 'donut',
    name: 'ドーナツ',
    tiers: [3, 4],
    make: (rng) => holed(rng, ['egg'], 1, { minFrac: 0.25, size: [0.72, 0.9], round: true }),
  },
  { id: 'comb', name: 'くし', tiers: [4, 5], make: single('comb') },
  { id: 'twins', name: 'ふたご島', tiers: [4, 5], make: (rng) => islands(rng, 2, 0.25) },
  {
    id: 'swiss',
    name: 'チーズ',
    tiers: [4, 5],
    make: (rng) => holed(rng, ['blob', 'polygon', 'egg'], rng.int(2, 3), { minFrac: 0.07, size: [0.5, 0.85] }),
  },
  { id: 'archipelago', name: '群島', tiers: [5, 5], make: (rng) => islands(rng, rng.int(3, 4), 0.35) },
];

export const TIER_NAMES = ['', 'やさしい', 'ふつう', 'むずかしい', 'かなり難しい', '鬼'];

export function generateShape(rng, tier) {
  const t = Math.max(1, Math.min(5, tier));
  const pool = GENERATORS.filter((g) => t >= g.tiers[0] && t <= g.tiers[1]);
  const weights = pool.map((g) => (g.tiers[0] === t ? 2 : 1));
  const total = weights.reduce((a, b) => a + b, 0);
  for (let attempt = 0; attempt < 20; attempt++) {
    let roll = rng.next() * total;
    let gen = pool[pool.length - 1];
    for (let i = 0; i < pool.length; i++) {
      roll -= weights[i];
      if (roll < 0) {
        gen = pool[i];
        break;
      }
    }
    const rings = gen.make(rng);
    if (!rings) continue;
    const fitted = fitRings(rotateRings(rings, rng.range(0, TAU)), FIT_BOX);
    return { shape: createShape(fitted), kind: gen.id, name: gen.name, tier: t };
  }
  const fallback = fitRings([{ pts: OUTLINES.polygon(rng) }], FIT_BOX);
  return { shape: createShape(fallback), kind: 'polygon', name: '多角形', tier: t };
}
