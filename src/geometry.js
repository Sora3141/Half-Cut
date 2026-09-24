// Exact polygon geometry for the cut.
//
// A shape is a set of simple rings: outer rings (islands) and holes. Rings are
// normalised so outers have positive signed area and holes negative, which lets
// every area / centroid be computed as a plain signed sum. Clipping a ring by a
// half-plane (Sutherland–Hodgman) can leave zero-width bridges along the cut
// line on concave rings, but those contribute nothing to area or moments.

export function ringMoments(pts) {
  let a = 0;
  let mx = 0;
  let my = 0;
  for (let i = 0, n = pts.length, j = n - 1; i < n; j = i++) {
    const p = pts[j];
    const q = pts[i];
    const c = p.x * q.y - q.x * p.y;
    a += c;
    mx += (p.x + q.x) * c;
    my += (p.y + q.y) * c;
  }
  return { area: a / 2, mx: mx / 6, my: my / 6 };
}

export const signedArea = (pts) => ringMoments(pts).area;

export function createShape(rings) {
  const normalized = rings.map(({ pts, hole = false }) => {
    const positive = signedArea(pts) > 0;
    return { pts: positive === !hole ? pts.slice() : pts.slice().reverse(), hole };
  });
  const area = normalized.reduce((sum, r) => sum + signedArea(r.pts), 0);
  return { rings: normalized, area };
}

/** Infinite line through p and q as n·x = d with unit normal n. */
export function lineThrough(p, q) {
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return null;
  const nx = -dy / len;
  const ny = dx / len;
  return { nx, ny, d: nx * p.x + ny * p.y };
}

/** Part of the ring where nx·x + ny·y − d ≥ 0. */
export function clipRing(pts, nx, ny, d) {
  const out = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const cur = pts[i];
    const prev = pts[(i + n - 1) % n];
    const sc = nx * cur.x + ny * cur.y - d;
    const sp = nx * prev.x + ny * prev.y - d;
    if (sc >= 0) {
      if (sp < 0) out.push(lerpAt(prev, cur, sp, sc));
      out.push(cur);
    } else if (sp >= 0) {
      out.push(lerpAt(prev, cur, sp, sc));
    }
  }
  return out;
}

function lerpAt(a, b, sa, sb) {
  const t = sa / (sa - sb);
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** Area and centroid of the part of the shape on the positive side of n·x = d. */
export function sideStats(shape, nx, ny, d) {
  let area = 0;
  let mx = 0;
  let my = 0;
  for (const ring of shape.rings) {
    const clipped = clipRing(ring.pts, nx, ny, d);
    if (clipped.length < 3) continue;
    const m = ringMoments(clipped);
    area += m.area;
    mx += m.mx;
    my += m.my;
  }
  const safe = Math.abs(area) > 1e-9;
  return { area, cx: safe ? mx / area : 0, cy: safe ? my / area : 0 };
}

export function splitByLine(shape, line) {
  const { nx, ny, d } = line;
  const pos = sideStats(shape, nx, ny, d);
  const neg = sideStats(shape, -nx, -ny, -d);
  return { pos, neg, ratio: pos.area / shape.area };
}

/** Offset d so that the line n·x = d splits the shape exactly in half. */
export function idealOffset(shape, nx, ny) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const ring of shape.rings) {
    for (const p of ring.pts) {
      const s = nx * p.x + ny * p.y;
      if (s < lo) lo = s;
      if (s > hi) hi = s;
    }
  }
  const half = shape.area / 2;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    // The positive side shrinks as d grows.
    if (sideStats(shape, nx, ny, mid).area > half) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export function pointInRing(pt, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if (a.y > pt.y !== b.y > pt.y && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/** Even–odd test; valid because holes sit inside outers and islands never overlap. */
export function pointInShape(pt, shape) {
  let inside = false;
  for (const ring of shape.rings) if (pointInRing(pt, ring.pts)) inside = !inside;
  return inside;
}

export function distToSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

export function distToRing(p, pts) {
  let best = Infinity;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    best = Math.min(best, distToSegment(p, pts[j], pts[i]));
  }
  return best;
}

export function boundsOf(rings) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const ring of rings) {
    for (const p of ring.pts) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

export function mapRings(rings, fn) {
  return rings.map((r) => ({ ...r, pts: r.pts.map(fn) }));
}

export function rotateRings(rings, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return mapRings(rings, (p) => ({ x: p.x * c - p.y * s, y: p.x * s + p.y * c }));
}

/** Uniformly scale and centre rings into a box. */
export function fitRings(rings, box) {
  const b = boundsOf(rings);
  const k = Math.min(box.w / b.w, box.h / b.h);
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  const tx = box.x + box.w / 2;
  const ty = box.y + box.h / 2;
  return mapRings(rings, (p) => ({ x: tx + (p.x - cx) * k, y: ty + (p.y - cy) * k }));
}
