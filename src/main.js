import { idealOffset, lineThrough, splitByLine } from './geometry.js';
import { BoardRenderer, drawThumb } from './renderer.js';
import { createRng, hashString, randomSeed } from './rng.js';
import {
  COMBO_GRADE_MAX,
  DAILY_TIERS,
  ENDLESS_LIFE,
  GRADES,
  comboMultiplier,
  dailyNumber,
  dateKey,
  endlessTier,
  gradeById,
  gradeFor,
  lifeDelta,
  msUntilTomorrow,
  pointsFor,
  previousDateKey,
} from './scoring.js';
import { generateShape, TIER_NAMES } from './shapes.js';
import { store } from './storage.js';
import { buzz, sfx } from './audio.js';

const SITE_URL = 'https://sora3141.github.io/Half-Cut/';
const MIN_DRAG = 28; // world units
const TAP_SLOP = 10; // css px
const RESULT_TAP_DELAY = 650; // ms before a tap on the board advances

const $ = (id) => document.getElementById(id);
const el = {
  screens: {
    title: $('screen-title'),
    game: $('screen-game'),
    summary: $('screen-summary'),
  },
  board: $('board'),
  stage: $('stage'),
  panel: $('panel'),
  canvas: $('board-canvas'),
  hero: $('hero-canvas'),
  modeLabel: $('mode-label'),
  roundLabel: $('round-label'),
  score: $('score-value'),
  hud: $('hud'),
  readout: $('readout'),
  next: $('btn-next'),
  stamp: $('stamp'),
  shapeTag: $('shape-tag'),
  toast: $('toast'),
  howto: $('howto'),
  soundBtn: $('btn-sound-title'),
};

const fmt = (v, digits = 2) => v.toFixed(digits);
const roundTo = (v, digits) => Math.round(v * 10 ** digits) / 10 ** digits;
const stars = (tier) => '★'.repeat(tier);

// ====================================================================== modes

function dailyShape(key, index) {
  return generateShape(createRng(hashString(`half-cut/${key}/${index}`)), DAILY_TIERS[index]);
}

function createDaily() {
  const key = dateKey();
  const saved = store.get(`daily/${key}`, { rounds: [] });
  return {
    id: 'daily',
    scored: true,
    key,
    no: dailyNumber(key),
    rounds: saved.rounds,
    total: DAILY_TIERS.length,
    get label() {
      return `DAILY #${this.no}`;
    },
    get roundText() {
      const shown = this.rounds.length + (game.phase === 'result' ? 0 : 1);
      return `${Math.min(shown, this.total)} / ${this.total}`;
    },
    get score() {
      return this.rounds.reduce((s, r) => s + r.points, 0);
    },
    next() {
      return dailyShape(key, this.rounds.length);
    },
    record(res) {
      this.rounds.push({
        error: roundTo(res.error, 3),
        points: res.points,
        grade: res.grade.id,
        a: { x: roundTo(res.a.x, 1), y: roundTo(res.a.y, 1) },
        b: { x: roundTo(res.b.x, 1), y: roundTo(res.b.y, 1) },
      });
      store.set(`daily/${key}`, { rounds: this.rounds });
      if (this.isOver()) recordStreak(key);
      return { gained: res.points };
    },
    isOver() {
      return this.rounds.length >= this.total;
    },
  };
}

function createEndless() {
  const rng = createRng(randomSeed());
  return {
    id: 'endless',
    scored: true,
    label: 'ENDLESS',
    life: ENDLESS_LIFE,
    round: 0,
    score: 0,
    combo: 0,
    bestCombo: 0,
    history: [],
    get roundText() {
      return `${this.round + (game.phase === 'result' ? 0 : 1)} 枚目`;
    },
    next() {
      return generateShape(rng, endlessTier(this.round));
    },
    record(res) {
      this.round++;
      this.combo = res.error <= COMBO_GRADE_MAX ? this.combo + 1 : 0;
      this.bestCombo = Math.max(this.bestCombo, this.combo);
      const mult = comboMultiplier(this.combo);
      const gained = Math.round(res.points * mult);
      this.score += gained;
      const lifeBefore = this.life;
      this.life = Math.min(ENDLESS_LIFE, this.life + lifeDelta(res.error, res.grade.id));
      this.history.push({ shape: res.shape, line: res.line, grade: res.grade.id, error: res.error, points: gained });
      let newBest = false;
      if (this.isOver()) {
        const best = store.get('endless/best', null);
        newBest = !best || this.score > best.score;
        if (newBest) store.set('endless/best', { score: this.score, rounds: this.round });
      }
      return { gained, mult, lifeBefore, newBest };
    },
    isOver() {
      return this.life <= 0;
    },
  };
}

function createPractice() {
  const rng = createRng(randomSeed());
  return {
    id: 'practice',
    scored: false,
    label: 'PRACTICE',
    tier: store.get('practice/tier', 2),
    live: store.get('practice/live', true),
    get roundText() {
      return TIER_NAMES[this.tier];
    },
    next() {
      return generateShape(rng, this.tier);
    },
    record() {
      return {};
    },
    isOver() {
      return false;
    },
  };
}

function recordStreak(key) {
  const s = store.get('streak', { last: null, count: 0, best: 0 });
  if (s.last === key) return;
  const count = s.last === previousDateKey(key) ? s.count + 1 : 1;
  store.set('streak', { last: key, count, best: Math.max(s.best || 0, count) });
}

function currentStreak() {
  const s = store.get('streak', null);
  if (!s) return 0;
  const today = dateKey();
  return s.last === today || s.last === previousDateKey(today) ? s.count : 0;
}

// ====================================================================== state

const game = {
  mode: null,
  current: null, // { shape, name, tier }
  phase: 'idle', // 'aim' | 'result'
  resultAt: 0,
  lastResult: null,
  pointer: null,
};

const renderer = new BoardRenderer(el.canvas);

// ====================================================================== screens

let summaryTimer = 0;

function showScreen(name) {
  for (const [key, node] of Object.entries(el.screens)) node.classList.toggle('is-active', key === name);
  clearInterval(summaryTimer);
  if (name === 'title') {
    refreshTitle();
    hero.start();
  } else {
    hero.stop();
  }
  if (name === 'game') requestAnimationFrame(sizeBoard);
  window.scrollTo(0, 0);
}

function refreshTitle() {
  const key = dateKey();
  const no = dailyNumber(key);
  const saved = store.get(`daily/${key}`, { rounds: [] });
  const done = saved.rounds.length >= DAILY_TIERS.length;
  const streak = currentStreak();
  $('daily-kicker').textContent = `DAILY #${no}`;
  $('daily-meta').textContent = done
    ? `完了 · ${saved.rounds.reduce((s, r) => s + r.points, 0)}点 — 結果を見る`
    : saved.rounds.length
      ? `続きから · ${saved.rounds.length} / ${DAILY_TIERS.length}`
      : 'みんな同じ図形 · 毎日0時に更新';
  const badge = $('daily-badge');
  badge.hidden = streak < 1;
  badge.textContent = `${streak}日連続`;

  const best = store.get('endless/best', null);
  $('endless-meta').textContent = best ? `ベスト ${best.score}点 · ${best.rounds}枚` : '誤差の持ち点が尽きるまで';
}

function startMode(id) {
  sfx.unlock();
  sfx.tap();
  if (id === 'daily') {
    const daily = createDaily();
    if (daily.isOver()) {
      showDailySummary(daily);
      return;
    }
    game.mode = daily;
  } else {
    game.mode = id === 'endless' ? createEndless() : createPractice();
  }
  showScreen('game');
  nextRound();
}

function leaveGame() {
  const m = game.mode;
  if (m?.id === 'endless' && m.round > 0 && !m.isOver()) {
    if (!confirm('エンドレスを中断しますか？ このプレイの記録は残りません。')) return;
  }
  game.mode = null;
  game.current = null;
  game.phase = 'idle';
  game.pointer = null;
  showScreen('title');
}

// ====================================================================== rounds

function nextRound() {
  const gen = game.mode.next();
  game.current = gen;
  game.phase = 'aim';
  game.lastResult = null;
  renderer.setShape(gen.shape);
  el.shapeTag.innerHTML = `${gen.name}<span class="stars">${stars(gen.tier)}</span>`;
  el.stamp.classList.remove('is-shown');
  el.board.classList.remove('is-waiting');
  renderHint();
  renderTopbar();
  renderHud();
  if (game.mode.scored) {
    el.next.disabled = true;
  } else {
    el.next.disabled = false;
    setNextLabel('別の図形');
  }
  sfx.paper();
}

function advance() {
  if (!game.mode) return;
  if (game.mode.scored && game.phase !== 'result') return;
  sfx.tap();
  if (game.mode.isOver()) {
    if (game.mode.id === 'daily') showDailySummary(game.mode);
    else showEndlessSummary(game.mode);
    return;
  }
  nextRound();
}

function performCut(a, b) {
  const { shape } = game.current;
  const line = lineThrough(a, b);
  const split = splitByLine(shape, line);
  if (split.ratio < 0.0005 || split.ratio > 0.9995) {
    renderer.setDrag(null);
    toast('図形を横切るように線を引いてください');
    buzz(12);
    return;
  }

  const pctA = split.ratio * 100;
  const error = Math.abs(pctA - 50);
  const grade = gradeFor(error);
  const points = pointsFor(error);
  const idealD = idealOffset(shape, line.nx, line.ny);
  const res = { a, b, line, split, pctA, error, grade, points, shape };

  game.phase = 'result';
  game.resultAt = performance.now();
  const outcome = game.mode.record(res);
  game.lastResult = { res, outcome };

  renderer.showCut({ line, split, idealD, a, b, pctA, celebrate: grade.id === 'perfect', shake: grade.id === 'miss' });
  sfx.slice();
  buzz(grade.id === 'perfect' ? [20, 50, 20, 50, 80] : grade.id === 'miss' ? [70] : [16]);
  setTimeout(() => {
    if (game.lastResult?.res !== res) return;
    showStamp(grade);
    sfx.grade(grade.id);
  }, 420);
  if (game.mode.id === 'endless' && game.mode.isOver()) setTimeout(() => sfx.over(), 1300);

  renderResult(res, outcome);
  renderTopbar(outcome.gained);
  renderHud(outcome);

  el.board.classList.toggle('is-waiting', game.mode.scored);
  el.next.disabled = false;
  if (game.mode.isOver()) setNextLabel('結果を見る');
  else setNextLabel(game.mode.scored ? '次の図形' : '別の図形');
  if (game.mode.scored) el.next.focus({ preventScroll: true });
}

function showStamp(grade) {
  el.stamp.dataset.grade = grade.id;
  el.stamp.querySelector('.stamp__text').textContent = grade.kanji;
  el.stamp.classList.remove('is-shown');
  void el.stamp.offsetWidth;
  el.stamp.classList.add('is-shown');
}

function setNextLabel(text) {
  el.next.innerHTML = `${text}<kbd>Enter</kbd>`;
}

// ====================================================================== readout / HUD

function renderHint() {
  const live = game.mode.id === 'practice' && game.mode.live;
  el.readout.innerHTML = `
    <div class="hint">
      <svg aria-hidden="true"><use href="#i-swipe" /></svg>
      <span>${live ? 'ドラッグ中は比率が見えます' : '図形を横切るようにスワイプして切る'}</span>
    </div>`;
}

function renderResult(res, outcome) {
  const { grade, pctA, error } = res;
  const parts = [
    `<span class="grade-pill" data-grade="${grade.id}">${grade.label}</span>`,
    `<span>誤差 <b>${fmt(error)}</b>%</span>`,
  ];
  if (game.mode.id === 'daily') parts.push(`<span class="gain">+${outcome.gained}</span>`);
  if (game.mode.id === 'endless') {
    const m = game.mode;
    parts.push(`<span class="gain">+${outcome.gained}${outcome.mult > 1 ? ` <small>×${fmt(outcome.mult, 1)}</small>` : ''}</span>`);
    const delta = m.life - outcome.lifeBefore;
    parts.push(`<span>持ち点 <b>${delta >= 0 ? '+' : '−'}${fmt(Math.abs(delta))}</b></span>`);
  }
  if (game.mode.id === 'practice') parts.push('<span>スワイプで切り直し</span>');
  el.readout.innerHTML = `
    <div class="result">
      <div class="result__split">
        <span class="pct pct--a">${fmt(pctA)}<small>%</small></span>
        <span class="result__colon">:</span>
        <span class="pct pct--b">${fmt(100 - pctA)}<small>%</small></span>
      </div>
      <div class="result__meta">${parts.join('')}</div>
    </div>`;
  if (game.mode.id === 'endless' && game.mode.isOver()) {
    el.readout.querySelector('.result__meta').insertAdjacentHTML(
      'beforeend',
      '<span style="color:var(--accent);font-weight:900">持ち点がなくなりました</span>',
    );
  }
}

function renderTopbar(gained = 0) {
  const m = game.mode;
  el.modeLabel.textContent = m.label;
  el.roundLabel.textContent = m.roundText;
  const scoreBox = el.score.parentElement;
  scoreBox.style.visibility = m.scored ? 'visible' : 'hidden';
  if (!m.scored) return;
  el.score.textContent = m.score;
  if (gained > 0) {
    el.score.classList.remove('bump');
    void el.score.offsetWidth;
    el.score.classList.add('bump');
  }
}

function renderHud(outcome) {
  const m = game.mode;
  if (m.id === 'daily') {
    const dots = DAILY_TIERS.map((_, i) => {
      const r = m.rounds[i];
      if (r) return `<li class="dot" data-grade="${r.grade}" title="${gradeById(r.grade).label}">${gradeById(r.grade).kanji[0]}</li>`;
      const current = i === m.rounds.length && game.phase !== 'result';
      return `<li class="dot${current ? ' is-current' : ''}"></li>`;
    });
    el.hud.innerHTML = `<ol class="dots" aria-label="進行状況">${dots.join('')}</ol>`;
    return;
  }

  if (m.id === 'endless') {
    if (!el.hud.querySelector('.life')) {
      el.hud.innerHTML = `
        <div class="life" role="meter" aria-label="持ち点" aria-valuemin="0" aria-valuemax="${ENDLESS_LIFE}">
          <span>持ち点</span>
          <div class="life__bar"><div class="life__loss"></div><div class="life__fill"></div></div>
          <span class="life__value"></span>
        </div>
        <span class="combo" hidden></span>`;
    }
    const life = el.hud.querySelector('.life');
    const fill = life.querySelector('.life__fill');
    const loss = life.querySelector('.life__loss');
    const now = Math.max(0, m.life) / ENDLESS_LIFE;
    const before = outcome ? Math.max(0, outcome.lifeBefore) / ENDLESS_LIFE : now;
    loss.style.transition = 'none';
    loss.style.transform = `scaleX(${Math.max(before, now)})`;
    void loss.offsetWidth;
    loss.style.transition = '';
    loss.style.transform = `scaleX(${now})`;
    fill.style.transform = `scaleX(${now})`;
    life.classList.toggle('is-low', m.life < 3);
    life.setAttribute('aria-valuenow', fmt(Math.max(0, m.life), 1));
    life.querySelector('.life__value').textContent = fmt(Math.max(0, m.life));
    const combo = el.hud.querySelector('.combo');
    combo.hidden = m.combo < 2;
    combo.textContent = `${m.combo} COMBO ×${fmt(comboMultiplier(m.combo), 1)}`;
    if (outcome && m.combo >= 2) {
      combo.classList.remove('bump');
      void combo.offsetWidth;
      combo.classList.add('bump');
    }
    return;
  }

  if (!el.hud.querySelector('.segmented')) {
    el.hud.innerHTML = `
      <div class="segmented" role="group" aria-label="難易度">
        ${[1, 2, 3, 4, 5].map((t) => `<button type="button" data-tier="${t}" aria-label="${TIER_NAMES[t]}">${t}</button>`).join('')}
      </div>
      <label class="switch"><input type="checkbox" id="live-toggle" /> ライブ表示</label>`;
    el.hud.querySelectorAll('[data-tier]').forEach((btn) =>
      btn.addEventListener('click', () => {
        m.tier = Number(btn.dataset.tier);
        store.set('practice/tier', m.tier);
        sfx.tap();
        renderHud();
        nextRound();
      }),
    );
    $('live-toggle').addEventListener('change', (e) => {
      m.live = e.target.checked;
      store.set('practice/live', m.live);
      if (game.phase === 'aim') renderHint();
    });
  }
  el.hud.querySelectorAll('[data-tier]').forEach((btn) => btn.setAttribute('aria-pressed', String(Number(btn.dataset.tier) === m.tier)));
  $('live-toggle').checked = m.live;
}

let toastTimer = 0;
function toast(message, target = el.toast) {
  target.textContent = message;
  target.classList.add('is-shown');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => target.classList.remove('is-shown'), 1800);
}

// ====================================================================== input

function onPointerDown(e) {
  if (!game.current || game.pointer || e.button > 0) return;
  sfx.unlock();
  e.preventDefault();

  if (game.phase === 'result' && game.mode.scored) {
    if (performance.now() - game.resultAt > RESULT_TAP_DELAY) {
      game.pointer = { id: e.pointerId, tap: true, x: e.clientX, y: e.clientY };
    }
    return;
  }
  if (game.phase === 'result') {
    // practice: cut the same sheet again
    game.phase = 'aim';
    renderer.clearCut();
    el.stamp.classList.remove('is-shown');
    renderHint();
  }
  el.canvas.setPointerCapture(e.pointerId);
  const a = renderer.toWorld(e.clientX, e.clientY);
  game.pointer = { id: e.pointerId, a, b: a };
  updateDrag();
}

function onPointerMove(e) {
  const p = game.pointer;
  if (!p || p.id !== e.pointerId || p.tap) return;
  e.preventDefault();
  p.b = renderer.toWorld(e.clientX, e.clientY);
  updateDrag();
}

function onPointerUp(e) {
  const p = game.pointer;
  if (!p || p.id !== e.pointerId) return;
  game.pointer = null;
  if (p.tap) {
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < TAP_SLOP) advance();
    return;
  }
  if (Math.hypot(p.b.x - p.a.x, p.b.y - p.a.y) < MIN_DRAG) {
    renderer.setDrag(null);
    return;
  }
  performCut(p.a, p.b);
}

function onPointerCancel(e) {
  if (game.pointer?.id !== e.pointerId) return;
  game.pointer = null;
  renderer.setDrag(null);
}

function updateDrag() {
  const { a, b } = game.pointer;
  const line = Math.hypot(b.x - a.x, b.y - a.y) >= MIN_DRAG ? lineThrough(a, b) : null;
  const live = line && game.mode.id === 'practice' && game.mode.live ? splitByLine(game.current.shape, line) : null;
  renderer.setDrag({ a, b, line }, live);
}

el.canvas.addEventListener('pointerdown', onPointerDown);
el.canvas.addEventListener('pointermove', onPointerMove);
el.canvas.addEventListener('pointerup', onPointerUp);
el.canvas.addEventListener('pointercancel', onPointerCancel);
el.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

document.addEventListener('keydown', (e) => {
  if (!el.screens.game.classList.contains('is-active') || el.howto.open) return;
  if (e.key === 'Escape') {
    leaveGame();
    return;
  }
  const onButton = e.target instanceof HTMLButtonElement || e.target instanceof HTMLInputElement;
  if ((e.key === 'Enter' || e.key === ' ') && !onButton) {
    e.preventDefault();
    if (!el.next.disabled) el.next.click();
  }
});

// ====================================================================== summary

function statBlock(items) {
  return items.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
}

function summaryButtons(buttons) {
  const box = $('summary-actions');
  box.innerHTML = '';
  for (const { label, icon, primary, wide, onClick } of buttons) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `btn${primary ? ' btn--primary' : ''}${wide ? ' btn--wide' : ''}`;
    b.innerHTML = `${icon ? `<svg aria-hidden="true"><use href="#${icon}" /></svg>` : ''}${label}`;
    b.addEventListener('click', onClick);
    box.append(b);
  }
}

function dailyVerdict(score) {
  if (score >= 470) return '神の手。';
  if (score >= 420) return '達人の切れ味。';
  if (score >= 350) return 'お見事！';
  if (score >= 260) return 'いい線いってます。';
  return 'また明日、リベンジを。';
}

function showDailySummary(daily) {
  game.mode = null;
  showScreen('summary');
  const score = daily.score;
  const avg = daily.rounds.reduce((s, r) => s + r.error, 0) / daily.rounds.length;
  const perfects = daily.rounds.filter((r) => r.grade === 'perfect').length;
  $('summary-kicker').textContent = `DAILY #${daily.no} · ${daily.key}`;
  $('summary-heading').textContent = '今日の結果';
  $('summary-score').textContent = score;
  $('summary-max').textContent = `/ ${daily.total * 100}`;
  $('summary-note').textContent = dailyVerdict(score);
  $('summary-stats').innerHTML = statBlock([
    ['平均誤差', `${fmt(avg)}%`],
    ['神業', perfects],
    ['連続', `${currentStreak()}日`],
  ]);

  const list = $('summary-rounds');
  list.className = 'summary__rounds';
  list.innerHTML = '';
  daily.rounds.forEach((r, i) => {
    const gen = dailyShape(daily.key, i);
    const grade = gradeById(r.grade);
    const li = document.createElement('li');
    li.className = 'round-row';
    li.style.animationDelay = `${i * 70}ms`;
    li.innerHTML = `
      <canvas aria-hidden="true"></canvas>
      <div>
        <div class="round-row__name">Q${i + 1} · ${gen.name}</div>
        <div class="round-row__sub">${stars(gen.tier)} 誤差 ${fmt(r.error)}%</div>
      </div>
      <div class="round-row__grade">
        <span class="grade-pill" data-grade="${grade.id}">${grade.label}</span>
        <span class="round-row__pts">${r.points}</span>
      </div>`;
    drawThumb(li.querySelector('canvas'), gen.shape, lineThrough(r.a, r.b), 60);
    list.append(li);
  });

  summaryButtons([
    { label: 'シェア', icon: 'i-share', primary: true, onClick: () => shareDaily(daily) },
    { label: 'メニューへ', onClick: () => showScreen('title') },
  ]);

  const footer = $('summary-footer');
  const tick = () => {
    const ms = msUntilTomorrow();
    const h = String(Math.floor(ms / 3.6e6)).padStart(2, '0');
    const m = String(Math.floor((ms % 3.6e6) / 6e4)).padStart(2, '0');
    const s = String(Math.floor((ms % 6e4) / 1000)).padStart(2, '0');
    footer.textContent = `次の問題まで ${h}:${m}:${s}`;
  };
  tick();
  summaryTimer = setInterval(tick, 1000);
}

/** Native share sheet where it exists (phones), otherwise copy to the clipboard. */
async function share({ text, url = SITE_URL, title = 'Half/Cut' }) {
  sfx.tap();
  const data = { title, text, url };
  try {
    if (navigator.share && matchMedia('(pointer: coarse)').matches && (!navigator.canShare || navigator.canShare(data))) {
      await navigator.share(data);
      return;
    }
    await navigator.clipboard.writeText(`${text}\n${url}`);
    globalToast('クリップボードにコピーしました');
  } catch (err) {
    if (err?.name !== 'AbortError') globalToast('シェアできませんでした');
  }
}

function shareApp() {
  share({ text: '図形をスワイプ一本でぴったり半分に切るパズル「Half/Cut」✂️ 今日の5問、挑戦してみて！' });
}

function shareDaily(daily) {
  share({
    text: [
      `Half/Cut #${daily.no}  ${daily.score}/${daily.total * 100}`,
      daily.rounds.map((r) => gradeById(r.grade).emoji).join(''),
      `誤差 ${daily.rounds.map((r) => fmt(r.error, 1)).join(' / ')}`,
    ].join('\n'),
  });
}

function shareEndless(m) {
  const perfects = m.history.filter((h) => h.grade === 'perfect').length;
  share({
    text: [
      `Half/Cut エンドレス ✂️ ${m.score}点（${m.round}枚）`,
      m.history.slice(-15).map((h) => gradeById(h.grade).emoji).join(''),
      `最大コンボ ${m.bestCombo} · 神業 ${perfects}回`,
    ].join('\n'),
  });
}

function showEndlessSummary(m) {
  const outcome = game.lastResult?.outcome;
  game.mode = null;
  showScreen('summary');
  const best = store.get('endless/best', { score: m.score, rounds: m.round });
  const avg = m.history.reduce((s, h) => s + h.error, 0) / Math.max(1, m.history.length);
  $('summary-kicker').textContent = 'ENDLESS';
  $('summary-heading').textContent = 'ゲームオーバー';
  $('summary-score').textContent = m.score;
  $('summary-max').textContent = '点';
  $('summary-note').textContent = outcome?.newBest ? '自己ベスト更新！' : '';
  $('summary-stats').innerHTML = statBlock([
    ['切った枚数', m.round],
    ['平均誤差', `${fmt(avg)}%`],
    ['最大コンボ', m.bestCombo],
  ]);

  const list = $('summary-rounds');
  list.className = 'summary__rounds summary__rounds--grid';
  list.innerHTML = '';
  m.history.slice(-30).forEach((h, i) => {
    const li = document.createElement('li');
    li.className = 'round-tile';
    li.dataset.grade = h.grade;
    li.title = `${gradeById(h.grade).label} · 誤差 ${fmt(h.error)}%`;
    li.style.animationDelay = `${Math.min(i, 20) * 30}ms`;
    li.innerHTML = '<canvas aria-hidden="true"></canvas><span></span>';
    drawThumb(li.querySelector('canvas'), h.shape, h.line, 72);
    list.append(li);
  });

  summaryButtons([
    { label: 'もう一度', primary: true, onClick: () => startMode('endless') },
    { label: 'シェア', icon: 'i-share', onClick: () => shareEndless(m) },
    { label: 'メニューへ', wide: true, onClick: () => showScreen('title') },
  ]);
  $('summary-footer').textContent = `ベスト ${best.score}点 · ${best.rounds}枚`;
}

let globalToastEl = null;
function globalToast(message) {
  if (!globalToastEl) {
    globalToastEl = document.createElement('div');
    globalToastEl.className = 'toast toast--global';
    globalToastEl.setAttribute('role', 'status');
    document.body.append(globalToastEl);
  }
  toast(message, globalToastEl);
}

// ====================================================================== title hero

const hero = (() => {
  const r = new BoardRenderer(el.hero, { detail: false });
  const rng = createRng(randomSeed());
  let timers = [];
  let running = false;
  let raf = 0;

  const later = (fn, ms) => timers.push(setTimeout(fn, ms));

  function cycle() {
    if (!running) return;
    const { shape } = generateShape(rng, rng.int(1, 4));
    r.setShape(shape);
    later(() => swipe(shape), 1100);
  }

  function swipe(shape) {
    const angle = rng.range(0, Math.PI);
    const nx = Math.cos(angle);
    const ny = Math.sin(angle);
    const d = idealOffset(shape, nx, ny) + rng.range(-8, 8);
    const off = nx * 500 + ny * 500 - d;
    const cx = 500 - nx * off;
    const cy = 500 - ny * off;
    const a = { x: cx + ny * 420, y: cy - nx * 420 };
    const b = { x: cx - ny * 420, y: cy + nx * 420 };
    const start = performance.now();
    const step = (now) => {
      if (!running) return;
      const t = Math.min(1, (now - start) / 520);
      const e = 1 - (1 - t) ** 2;
      const cur = { x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e };
      r.setDrag({ a, b: cur, line: t > 0.1 ? lineThrough(a, cur) : null });
      if (t < 1) {
        raf = requestAnimationFrame(step);
        return;
      }
      const line = lineThrough(a, b);
      const split = splitByLine(shape, line);
      r.showCut({ line, split, idealD: d, a, b, pctA: split.ratio * 100, showIdeal: false });
      later(cycle, 2600);
    };
    raf = requestAnimationFrame(step);
  }

  return {
    renderer: r,
    start() {
      if (running) return;
      running = true;
      requestAnimationFrame(() => {
        r.resize(el.hero.parentElement.clientWidth);
        cycle();
      });
    },
    stop() {
      running = false;
      timers.forEach(clearTimeout);
      timers = [];
      cancelAnimationFrame(raf);
    },
  };
})();

// ====================================================================== layout

function sizeBoard() {
  const gap = parseFloat(getComputedStyle(el.stage).rowGap) || 0;
  const available = el.stage.clientHeight - el.hud.offsetHeight - el.panel.offsetHeight - gap * 2;
  const size = Math.floor(Math.max(200, Math.min(el.stage.clientWidth, available)));
  el.board.style.setProperty('--board-size', `${size}px`);
  renderer.resize(size - 4); // minus the 2px border
}

new ResizeObserver(sizeBoard).observe(el.stage);
new ResizeObserver(() => hero.renderer.resize(el.hero.parentElement.clientWidth)).observe(el.hero.parentElement);

// ====================================================================== wiring

function renderSoundButton() {
  el.soundBtn.innerHTML = `<svg><use href="#${sfx.enabled ? 'i-sound' : 'i-mute'}" /></svg>`;
  el.soundBtn.setAttribute('aria-pressed', String(sfx.enabled));
}

sfx.enabled = store.get('sound', true);
renderSoundButton();
el.soundBtn.addEventListener('click', () => {
  sfx.enabled = !sfx.enabled;
  store.set('sound', sfx.enabled);
  renderSoundButton();
  sfx.unlock();
  sfx.tap();
});

document.querySelectorAll('[data-mode]').forEach((btn) => btn.addEventListener('click', () => startMode(btn.dataset.mode)));
document.querySelectorAll('[data-action="howto"]').forEach((btn) => btn.addEventListener('click', () => el.howto.showModal()));
el.howto.addEventListener('click', (e) => {
  if (e.target === el.howto) el.howto.close();
});
el.howto.addEventListener('close', () => store.set('seen-howto', true));
$('btn-back').addEventListener('click', leaveGame);
el.next.addEventListener('click', () => {
  if (game.mode && !game.mode.scored && game.phase !== 'result') {
    sfx.tap();
    nextRound();
    return;
  }
  advance();
});

$('grade-table').innerHTML = GRADES.map(
  (g, i) => `
    <li data-grade="${g.id}">
      <span class="seal">${g.kanji}</span>
      <span>${g.label}</span>
      <span class="num">${Number.isFinite(g.max) ? `≤${g.max}%` : `>${GRADES[i - 1].max}%`}</span>
    </li>`,
).join('');

// ====================================================================== install (PWA)

const installBtn = $('btn-install');
const installSheet = $('install-sheet');
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
let installPrompt = null;

function renderInstall() {
  installBtn.hidden = isStandalone() || !(installPrompt || isIOS);
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  renderInstall();
});

window.addEventListener('appinstalled', () => {
  installPrompt = null;
  renderInstall();
  globalToast('ホーム画面に追加しました');
});

$('btn-share-app').addEventListener('click', shareApp);

installBtn.addEventListener('click', async () => {
  sfx.unlock();
  sfx.tap();
  if (installPrompt) {
    const prompt = installPrompt;
    installPrompt = null;
    prompt.prompt();
    await prompt.userChoice.catch(() => {});
    renderInstall();
    return;
  }
  installSheet.showModal();
});

installSheet.addEventListener('click', (e) => {
  if (e.target === installSheet) installSheet.close();
});

renderInstall();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

async function boot() {
  const fonts = Promise.all([
    document.fonts.load('500 38px "DM Mono"'),
    document.fonts.load('700 24px "Zen Kaku Gothic New"', '理想'),
  ]).catch(() => {});
  await Promise.race([fonts, new Promise((r) => setTimeout(r, 1500))]);
  showScreen('title');
  if (!store.get('seen-howto', false)) el.howto.showModal();
}

boot();
