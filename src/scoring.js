// Grades, points and the daily calendar.

export const GRADES = [
  { id: 'perfect', max: 0.3, kanji: '神業', label: 'PERFECT', emoji: '🌟' },
  { id: 'excellent', max: 1, kanji: '見事', label: 'EXCELLENT', emoji: '🟩' },
  { id: 'great', max: 2.5, kanji: '上手', label: 'GREAT', emoji: '🟨' },
  { id: 'good', max: 5, kanji: '及第', label: 'GOOD', emoji: '🟧' },
  { id: 'miss', max: Infinity, kanji: '未熟', label: 'MISS', emoji: '🟥' },
];

export const gradeFor = (error) => GRADES.find((g) => error <= g.max);
export const gradeById = (id) => GRADES.find((g) => g.id === id);

/** 100 for a perfect halve, falling to 0 at 10 points of error. */
export function pointsFor(error) {
  return Math.round(100 * Math.max(0, 1 - error / 10) ** 1.6);
}

// ---- endless

export const ENDLESS_LIFE = 12;
const LIFE_REFUND = { perfect: 1.5, excellent: 0.6, great: 0.2 };
export const COMBO_GRADE_MAX = 2.5;

const MAX_LOSS = 6; // one disastrous cut never ends a run on its own

/** Change in endless life for one cut. */
export const lifeDelta = (error, gradeId) => -Math.min(error, MAX_LOSS) + (LIFE_REFUND[gradeId] ?? 0);
export const comboMultiplier = (combo) => 1 + 0.1 * Math.min(Math.max(combo - 1, 0), 10);
export const endlessTier = (round) => Math.min(5, 1 + Math.floor(round / 3));

// ---- daily

export const DAILY_TIERS = [1, 2, 3, 4, 5];
const DAILY_EPOCH = Date.UTC(2026, 8, 24); // #1

export function dateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function dailyNumber(key) {
  const [y, m, d] = key.split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - DAILY_EPOCH) / 864e5) + 1;
}

export function previousDateKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return dateKey(new Date(y, m - 1, d - 1));
}

export function msUntilTomorrow(now = new Date()) {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return next - now;
}
