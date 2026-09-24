// Tiny synthesised sound effects (no assets).

const NOTE = (n) => 440 * 2 ** ((n - 69) / 12);
const ARPEGGIOS = {
  perfect: [84, 88, 91, 96],
  excellent: [84, 88, 91],
  great: [81, 84, 88],
  good: [79, 83],
  miss: [62, 57],
};

// Let Web Audio play even with the iPhone ring/silent switch on (Safari 16.4+).
// 'playback' pauses music from other apps, so only use it while our sound is on.
export function setAudioSession(soundOn) {
  try {
    if (navigator.audioSession) navigator.audioSession.type = soundOn ? 'playback' : 'auto';
  } catch {
    /* unsupported */
  }
}

class Sfx {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.noise = null;
  }

  unlock() {
    if (!this.enabled) return;
    setAudioSession(true);
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.55;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 0.5;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  ready() {
    return this.enabled && this.ctx && this.ctx.state === 'running';
  }

  tone(freq, { at = 0, dur = 0.25, type = 'sine', gain = 0.2, slideTo } = {}) {
    const t = this.ctx.currentTime + at;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  hiss({ dur = 0.18, from = 5000, to = 900, q = 1.2, gain = 0.35, at = 0 } = {}) {
    const t = this.ctx.currentTime + at;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = q;
    filter.frequency.setValueAtTime(from, t);
    filter.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  slice() {
    if (!this.ready()) return;
    this.hiss({ dur: 0.16, from: 7000, to: 1400, q: 0.8, gain: 0.5 });
    this.tone(2400, { dur: 0.05, type: 'triangle', gain: 0.05 });
  }

  paper() {
    if (!this.ready()) return;
    this.hiss({ dur: 0.22, from: 1800, to: 700, q: 0.6, gain: 0.12 });
  }

  grade(id) {
    if (!this.ready()) return;
    const notes = ARPEGGIOS[id] ?? ARPEGGIOS.good;
    const isMiss = id === 'miss';
    notes.forEach((n, i) =>
      this.tone(NOTE(n), {
        at: i * (isMiss ? 0.13 : 0.075),
        dur: isMiss ? 0.32 : 0.45,
        type: isMiss ? 'triangle' : 'sine',
        gain: isMiss ? 0.14 : 0.13,
      }),
    );
    if (id === 'perfect') this.tone(NOTE(103), { at: 0.32, dur: 0.9, gain: 0.05 });
  }

  tap() {
    if (!this.ready()) return;
    this.tone(1200, { dur: 0.04, type: 'triangle', gain: 0.05 });
  }

  over() {
    if (!this.ready()) return;
    [67, 63, 60, 55].forEach((n, i) => this.tone(NOTE(n), { at: i * 0.16, dur: 0.5, type: 'triangle', gain: 0.12 }));
  }
}

export const sfx = new Sfx();

export function buzz(pattern) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* unsupported */
  }
}
