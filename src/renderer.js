// Canvas renderer: a cutting mat, a sheet of paper, and the cut.
// All drawing happens in a fixed 1000×1000 world space scaled to the canvas.

import { pointInShape } from './geometry.js';
import { WORLD } from './shapes.js';

export const PALETTE = {
  mat: '#1c3a31',
  grid: 'rgba(232, 224, 204, 0.055)',
  gridMajor: 'rgba(232, 224, 204, 0.12)',
  tick: 'rgba(232, 224, 204, 0.32)',
  paperA: '#f4ecdd',
  paperB: '#e2552f',
  edgeA: 'rgba(60, 44, 26, 0.38)',
  edgeB: 'rgba(110, 28, 8, 0.45)',
  shadow: 'rgba(5, 16, 12, 0.5)',
  ink: '#1e1b17',
  ideal: '#f5c451',
  blade: '#ffffff',
};

const SHADOW = { x: 7, y: 11 };
const SEPARATION = 16;
const LABEL_FONT = '500 38px "DM Mono", ui-monospace, monospace';

const clamp01 = (t) => Math.max(0, Math.min(1, t));
const easeOutCubic = (t) => 1 - (1 - t) ** 3;
const easeOutBack = (t) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2;

// ---------------------------------------------------------------- paths

export function shapePath(shape) {
  const path = new Path2D();
  for (const { pts } of shape.rings) {
    path.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) path.lineTo(pts[i].x, pts[i].y);
    path.closePath();
  }
  return path;
}

function halfPlanePath({ nx, ny, d }, sign) {
  const L = 4000;
  const bx = nx * d;
  const by = ny * d;
  const tx = -ny * L;
  const ty = nx * L;
  const sx = nx * sign * L;
  const sy = ny * sign * L;
  const path = new Path2D();
  path.moveTo(bx + tx, by + ty);
  path.lineTo(bx - tx, by - ty);
  path.lineTo(bx - tx + sx, by - ty + sy);
  path.lineTo(bx + tx + sx, by + ty + sy);
  path.closePath();
  return path;
}

/** The part of line n·x = d inside the world square, as two points. */
function lineInWorld({ nx, ny, d }, inset = 0) {
  const c = WORLD / 2;
  const off = nx * c + ny * c - d;
  const px = c - nx * off;
  const py = c - ny * off;
  const dx = -ny;
  const dy = nx;
  let t0 = -Infinity;
  let t1 = Infinity;
  for (const [p, dp] of [[px, dx], [py, dy]]) {
    if (Math.abs(dp) < 1e-9) continue;
    const a = (inset - p) / dp;
    const b = (WORLD - inset - p) / dp;
    t0 = Math.max(t0, Math.min(a, b));
    t1 = Math.min(t1, Math.max(a, b));
  }
  if (!(t1 > t0)) return null;
  return [
    { x: px + dx * t0, y: py + dy * t0 },
    { x: px + dx * t1, y: py + dy * t1 },
  ];
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ---------------------------------------------------------------- materials

let grainCanvas = null;
function grainTexture() {
  if (grainCanvas) return grainCanvas;
  grainCanvas = document.createElement('canvas');
  grainCanvas.width = grainCanvas.height = 180;
  const g = grainCanvas.getContext('2d');
  const img = g.createImageData(180, 180);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random();
    const dark = v < 0.5;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = dark ? 60 : 255;
    img.data[i + 3] = Math.random() < 0.35 ? Math.floor(Math.random() * 38) : 0;
  }
  g.putImageData(img, 0, 0);
  // a few longer fibres
  g.strokeStyle = 'rgba(80, 60, 40, 0.08)';
  g.lineWidth = 0.7;
  for (let i = 0; i < 40; i++) {
    const x = Math.random() * 180;
    const y = Math.random() * 180;
    const a = Math.random() * Math.PI;
    const l = 6 + Math.random() * 14;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + 2, y + Math.sin(a) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
  }
  return grainCanvas;
}

function drawMat(ctx, { detail = true } = {}) {
  ctx.fillStyle = PALETTE.mat;
  ctx.fillRect(0, 0, WORLD, WORLD);
  const vignette = ctx.createRadialGradient(500, 460, 200, 500, 500, 760);
  vignette.addColorStop(0, 'rgba(255, 255, 255, 0.035)');
  vignette.addColorStop(1, 'rgba(0, 0, 0, 0.22)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, WORLD, WORLD);

  const step = 40;
  ctx.lineWidth = 1.2;
  for (let i = step; i < WORLD; i += step) {
    ctx.strokeStyle = i % 200 === 0 ? PALETTE.gridMajor : PALETTE.grid;
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, WORLD);
    ctx.moveTo(0, i);
    ctx.lineTo(WORLD, i);
    ctx.stroke();
  }
  if (!detail) return;

  // 45° guides, as printed on real mats
  ctx.strokeStyle = 'rgba(232, 224, 204, 0.045)';
  ctx.setLineDash([4, 10]);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(WORLD, WORLD);
  ctx.moveTo(WORLD, 0);
  ctx.lineTo(0, WORLD);
  ctx.stroke();
  ctx.setLineDash([]);

  // ruler ticks on all four edges
  ctx.strokeStyle = PALETTE.tick;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 20; i < WORLD; i += 20) {
    const len = i % 200 === 0 ? 20 : i % 40 === 0 ? 11 : 6;
    ctx.moveTo(i, 0);
    ctx.lineTo(i, len);
    ctx.moveTo(i, WORLD);
    ctx.lineTo(i, WORLD - len);
    ctx.moveTo(0, i);
    ctx.lineTo(len, i);
    ctx.moveTo(WORLD, i);
    ctx.lineTo(WORLD - len, i);
  }
  ctx.stroke();
  ctx.fillStyle = PALETTE.tick;
  ctx.font = '500 15px "DM Mono", ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let i = 200; i < WORLD; i += 200) ctx.fillText(String(i / 40), i, 26);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  for (let i = 200; i < WORLD; i += 200) ctx.fillText(String(i / 40), 26, i);
}

/** One sheet of paper, optionally only the half on one side of a cut. */
function drawPaper(ctx, path, { fill, edge, ox = 0, oy = 0, clip = null, grain = null, cutLine = null, lift = 0 }) {
  ctx.save();
  ctx.translate(ox + SHADOW.x * (1 + lift), oy + SHADOW.y * (1 + lift));
  if (clip) ctx.clip(clip);
  ctx.fillStyle = PALETTE.shadow;
  ctx.fill(path, 'evenodd');
  ctx.restore();

  ctx.save();
  ctx.translate(ox, oy);
  if (clip) ctx.clip(clip);
  ctx.fillStyle = fill;
  ctx.fill(path, 'evenodd');
  if (grain) {
    ctx.fillStyle = grain;
    ctx.fill(path, 'evenodd');
  }
  ctx.lineJoin = 'round';
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = edge;
  ctx.stroke(path);
  if (cutLine) {
    const seg = lineInWorld(cutLine, -200);
    if (seg) {
      ctx.clip(path, 'evenodd');
      ctx.beginPath();
      ctx.moveTo(seg[0].x, seg[0].y);
      ctx.lineTo(seg[1].x, seg[1].y);
      ctx.lineWidth = 5;
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawPill(ctx, x, y, text, { bg, fg, border }, alpha = 1, scale = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.font = LABEL_FONT;
  const w = ctx.measureText(text).width + 40;
  const h = 60;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
  roundRect(ctx, -w / 2 + 3, -h / 2 + 5, w, h, h / 2);
  ctx.fill();
  roundRect(ctx, -w / 2, -h / 2, w, h, h / 2);
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = border;
  ctx.stroke();
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 0, 2);
  ctx.restore();
}

const LABEL_A = { bg: PALETTE.paperA, fg: PALETTE.ink, border: PALETTE.ink };
const LABEL_B = { bg: PALETTE.paperB, fg: '#fff8f0', border: PALETTE.ink };

/** Label anchors: each side's centroid, pushed away from the line and kept on the board. */
function labelAnchors(line, split, sep) {
  const place = (stats, sign) => {
    let x = stats.cx + line.nx * sign * sep;
    let y = stats.cy + line.ny * sign * sep;
    const dist = sign * (line.nx * x + line.ny * y - line.d);
    if (dist < 80) {
      x += line.nx * sign * (80 - dist);
      y += line.ny * sign * (80 - dist);
    }
    return { x: Math.max(110, Math.min(WORLD - 110, x)), y: Math.max(60, Math.min(WORLD - 60, y)) };
  };
  return { a: place(split.pos, 1), b: place(split.neg, -1) };
}

const fmtPct = (v) => `${v.toFixed(2)}%`;

// ---------------------------------------------------------------- renderer

export class BoardRenderer {
  constructor(canvas, { detail = true } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.detail = detail;
    this.scale = 1;
    this.raf = 0;
    this.last = 0;
    this.shape = null;
    this.path = null;
    this.bornAt = 0;
    this.drag = null;
    this.live = null;
    this.cut = null;
    this.particles = [];
    this.shakeAt = -1e9;
    this.matCache = null;
    this.grain = this.ctx.createPattern(grainTexture(), 'repeat');
    this.frame = this.frame.bind(this);
  }

  resize(cssSize) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const px = Math.max(1, Math.round(cssSize * dpr));
    if (this.canvas.width === px) return;
    this.canvas.width = this.canvas.height = px;
    this.canvas.style.width = this.canvas.style.height = `${cssSize}px`;
    this.scale = px / WORLD;
    this.matCache = null;
    this.invalidate();
  }

  toWorld(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    return { x: ((clientX - r.left) / r.width) * WORLD, y: ((clientY - r.top) / r.height) * WORLD };
  }

  setShape(shape) {
    this.shape = shape;
    this.path = shape ? shapePath(shape) : null;
    this.bornAt = performance.now();
    this.drag = null;
    this.live = null;
    this.cut = null;
    this.invalidate();
  }

  setDrag(drag, live = null) {
    this.drag = drag;
    this.live = live;
    this.invalidate();
  }

  showCut(cut) {
    this.drag = null;
    this.live = null;
    this.cut = { ...cut, at: performance.now() };
    this.spawnCutDust(cut.line);
    if (cut.celebrate) this.spawnConfetti();
    if (cut.shake) this.shakeAt = performance.now();
    this.invalidate();
  }

  clearCut() {
    this.cut = null;
    this.invalidate();
  }

  invalidate() {
    if (!this.raf) this.raf = requestAnimationFrame(this.frame);
  }

  frame(now) {
    this.raf = 0;
    if (this.draw(now)) this.invalidate();
  }

  // ------------------------------------------------------------ particles

  spawnCutDust(line) {
    const seg = lineInWorld(line);
    if (!seg || !this.shape) return;
    const colors = [PALETTE.paperA, PALETTE.paperB];
    for (let i = 0; i < 90; i++) {
      const t = Math.random();
      const x = seg[0].x + (seg[1].x - seg[0].x) * t;
      const y = seg[0].y + (seg[1].y - seg[0].y) * t;
      if (!pointInShape({ x, y }, this.shape)) continue;
      const side = Math.random() < 0.5 ? 1 : -1;
      const sp = 60 + Math.random() * 220;
      this.particles.push({
        x, y,
        vx: line.nx * side * sp + (Math.random() - 0.5) * 80,
        vy: line.ny * side * sp + (Math.random() - 0.5) * 80 - 40,
        g: 260,
        rot: Math.random() * 6,
        vr: (Math.random() - 0.5) * 14,
        size: 3 + Math.random() * 5,
        color: colors[side > 0 ? 0 : 1],
        life: 0.5 + Math.random() * 0.4,
        age: 0,
      });
    }
  }

  spawnConfetti() {
    const colors = [PALETTE.paperA, PALETTE.paperB, PALETTE.ideal, '#8fd3b6'];
    for (let i = 0; i < 110; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
      const sp = 500 + Math.random() * 700;
      this.particles.push({
        x: 500 + (Math.random() - 0.5) * 160,
        y: 560,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        g: 900,
        rot: Math.random() * 6,
        vr: (Math.random() - 0.5) * 18,
        size: 8 + Math.random() * 10,
        color: colors[i % colors.length],
        life: 1.4 + Math.random() * 0.8,
        age: 0,
        flutter: true,
      });
    }
  }

  stepParticles(dt) {
    for (const p of this.particles) {
      p.age += dt;
      p.vy += p.g * dt;
      if (p.flutter) {
        p.vx *= 1 - 1.6 * dt;
        p.vy *= 1 - 1.2 * dt;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
    }
    this.particles = this.particles.filter((p) => p.age < p.life);
  }

  drawParticles(ctx) {
    for (const p of this.particles) {
      ctx.save();
      ctx.globalAlpha = 1 - (p.age / p.life) ** 2;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.scale(1, p.flutter ? Math.cos(p.rot * 1.7) : 1);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 3, p.size, (p.size * 2) / 3);
      ctx.restore();
    }
  }

  // ------------------------------------------------------------ frame

  draw(now) {
    const ctx = this.ctx;
    const dt = Math.min(0.05, (now - (this.last || now)) / 1000);
    this.last = now;
    let animating = false;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (!this.matCache) {
      this.matCache = document.createElement('canvas');
      this.matCache.width = this.matCache.height = this.canvas.width;
      const m = this.matCache.getContext('2d');
      m.scale(this.scale, this.scale);
      drawMat(m, { detail: this.detail });
    }
    ctx.drawImage(this.matCache, 0, 0);
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);

    const shakeT = (now - this.shakeAt) / 380;
    if (shakeT < 1) {
      const amp = 14 * (1 - shakeT) ** 2;
      ctx.translate(Math.sin(shakeT * 38) * amp, Math.cos(shakeT * 29) * amp * 0.4);
      animating = true;
    }

    if (this.shape) {
      animating = this.drawShape(ctx, now) || animating;
      if (this.drag) this.drawDrag(ctx);
      if (this.cut) animating = this.drawCutOverlay(ctx, now) || animating;
    }

    if (this.particles.length) {
      this.stepParticles(dt);
      this.drawParticles(ctx);
      animating = true;
    }
    if (!animating) this.last = 0;
    return animating;
  }

  drawShape(ctx, now) {
    const intro = clamp01((now - this.bornAt) / 520);
    const k = easeOutBack(intro);
    ctx.save();
    ctx.globalAlpha = clamp01(intro * 3);
    ctx.translate(500, 500);
    ctx.scale(0.9 + 0.1 * k, 0.9 + 0.1 * k);
    ctx.translate(-500, -500 - 18 * (1 - k));
    const lift = 1.6 * (1 - easeOutCubic(intro));

    if (!this.cut) {
      drawPaper(ctx, this.path, { fill: PALETTE.paperA, edge: PALETTE.edgeA, grain: this.grain, lift });
    } else {
      const { line } = this.cut;
      const t = now - this.cut.at;
      const sep = SEPARATION * easeOutBack(clamp01((t - 90) / 520));
      drawPaper(ctx, this.path, {
        fill: PALETTE.paperA, edge: PALETTE.edgeA, grain: this.grain, cutLine: line,
        ox: line.nx * sep, oy: line.ny * sep, clip: halfPlanePath(line, 1),
      });
      drawPaper(ctx, this.path, {
        fill: PALETTE.paperB, edge: PALETTE.edgeB, grain: this.grain, cutLine: line,
        ox: -line.nx * sep, oy: -line.ny * sep, clip: halfPlanePath(line, -1),
      });
    }
    ctx.restore();
    return intro < 1;
  }

  drawDrag(ctx) {
    const { a, b, line } = this.drag;
    if (line) {
      const seg = lineInWorld(line);
      if (seg) {
        ctx.save();
        ctx.setLineDash([14, 12]);
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.38)';
        ctx.beginPath();
        ctx.moveTo(seg[0].x, seg[0].y);
        ctx.lineTo(seg[1].x, seg[1].y);
        ctx.stroke();
        ctx.restore();
      }
    }
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineWidth = 4;
    ctx.strokeStyle = PALETTE.blade;
    ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(a.x, a.y, 10, 0, Math.PI * 2);
    ctx.lineWidth = 3.5;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(b.x, b.y, 7, 0, Math.PI * 2);
    ctx.fillStyle = PALETTE.blade;
    ctx.fill();
    ctx.restore();

    if (this.live && line) {
      const { a: la, b: lb } = labelAnchors(line, this.live, 0);
      const pct = this.live.ratio * 100;
      drawPill(ctx, la.x, la.y, fmtPct(pct), LABEL_A, 0.92, 0.85);
      drawPill(ctx, lb.x, lb.y, fmtPct(100 - pct), LABEL_B, 0.92, 0.85);
    }
  }

  drawCutOverlay(ctx, now) {
    const { line, split, idealD, a, b, pctA, showIdeal = true } = this.cut;
    const t = now - this.cut.at;

    // the ideal parallel cut
    if (showIdeal && t > 750) {
      const alpha = clamp01((t - 750) / 350);
      const ideal = { nx: line.nx, ny: line.ny, d: idealD };
      const seg = lineInWorld(ideal, 12);
      if (seg) {
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.setLineDash([18, 12]);
        ctx.lineWidth = 3.5;
        ctx.strokeStyle = PALETTE.ideal;
        ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.moveTo(seg[0].x, seg[0].y);
        ctx.lineTo(seg[1].x, seg[1].y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.shadowBlur = 0;
        // tag near the end the player dragged towards
        const dx = seg[1].x - seg[0].x;
        const dy = seg[1].y - seg[0].y;
        const toward = (b.x - a.x) * dx + (b.y - a.y) * dy > 0 ? 1 : 0;
        const end = seg[toward];
        const other = seg[1 - toward];
        const len = Math.hypot(dx, dy) || 1;
        const tx = end.x + ((other.x - end.x) / len) * 70;
        const ty = end.y + ((other.y - end.y) / len) * 70;
        ctx.font = '700 24px "Zen Kaku Gothic New", sans-serif';
        const w = ctx.measureText('理想').width + 26;
        roundRect(ctx, tx - w / 2, ty - 19, w, 38, 10);
        ctx.fillStyle = PALETTE.ideal;
        ctx.fill();
        ctx.fillStyle = PALETTE.ink;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('理想', tx, ty + 1);
        ctx.restore();
      }
    }

    // the blade sweeping through
    if (t < 420) {
      const seg = lineInWorld(line, -40);
      if (seg) {
        const forward = (b.x - a.x) * (seg[1].x - seg[0].x) + (b.y - a.y) * (seg[1].y - seg[0].y) > 0;
        const [s, e] = forward ? seg : [seg[1], seg[0]];
        const sweep = easeOutCubic(clamp01(t / 140));
        const fade = 1 - clamp01((t - 120) / 300);
        ctx.save();
        ctx.lineCap = 'round';
        ctx.strokeStyle = PALETTE.blade;
        ctx.shadowColor = '#fff';
        ctx.shadowBlur = 24;
        ctx.globalAlpha = fade;
        ctx.lineWidth = 2 + 7 * fade;
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(s.x + (e.x - s.x) * sweep, s.y + (e.y - s.y) * sweep);
        ctx.stroke();
        ctx.restore();
      }
    }

    // percentages
    if (t > 240) {
      const k = easeOutCubic(clamp01((t - 240) / 620));
      const pop = easeOutBack(clamp01((t - 240) / 360));
      const sep = SEPARATION * easeOutBack(clamp01((t - 90) / 520));
      const { a: la, b: lb } = labelAnchors(line, split, sep);
      drawPill(ctx, la.x, la.y, fmtPct(pctA * k), LABEL_A, 1, 0.6 + 0.4 * pop);
      drawPill(ctx, lb.x, lb.y, fmtPct((100 - pctA) * k), LABEL_B, 1, 0.6 + 0.4 * pop);
    }
    return t < 1200;
  }
}

/** Static miniature of a finished cut, for the summary screen. */
export function drawThumb(canvas, shape, line, cssSize) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = canvas.height = Math.round(cssSize * dpr);
  canvas.style.width = canvas.style.height = `${cssSize}px`;
  const ctx = canvas.getContext('2d');
  ctx.scale((cssSize * dpr) / WORLD, (cssSize * dpr) / WORLD);
  drawMat(ctx, { detail: false });
  const path = shapePath(shape);
  if (!line) {
    drawPaper(ctx, path, { fill: PALETTE.paperA, edge: PALETTE.edgeA });
    return;
  }
  const sep = SEPARATION * 1.6;
  drawPaper(ctx, path, {
    fill: PALETTE.paperA, edge: PALETTE.edgeA, cutLine: line,
    ox: line.nx * sep, oy: line.ny * sep, clip: halfPlanePath(line, 1),
  });
  drawPaper(ctx, path, {
    fill: PALETTE.paperB, edge: PALETTE.edgeB, cutLine: line,
    ox: -line.nx * sep, oy: -line.ny * sep, clip: halfPlanePath(line, -1),
  });
}
