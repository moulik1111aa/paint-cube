// Background music, made live with Web Audio (no audio files): four quiet loops to pick
// from, or none. A small look-ahead scheduler queues notes a fraction of a second ahead;
// the music pauses while the app is hidden and fades in and out on changes.

export type TrackId = 'off' | 'lofi' | 'zen' | 'street' | 'night';
export const TRACKS: { id: TrackId; name: string }[] = [
  { id: 'lofi', name: 'Lo-fi' },
  { id: 'zen', name: 'Paper zen' },
  { id: 'street', name: 'Street beat' },
  { id: 'night', name: 'Night drive' },
  { id: 'off', name: 'Off' },
];

const midi = (n: number) => 440 * 2 ** ((n - 69) / 12);

interface Track {
  bpm: number;
  /** Steps per bar (16ths). */
  steps: number;
  bars: number;
  play(m: Music, t: number, bar: number, step: number): void;
}

// Chord roots and shapes (MIDI notes).
const LOFI_CHORDS = [[57, 60, 64, 67], [53, 57, 60, 64], [55, 59, 62, 65], [52, 55, 59, 62]]; // Am7 Fmaj7 G7 Em7
const NIGHT_CHORDS = [[45, 52, 57, 60], [41, 48, 53, 57], [43, 50, 55, 59], [40, 47, 52, 55]];
const PENTA = [62, 64, 67, 69, 71, 74, 76, 79]; // D major pentatonic, for plucked paper-koto notes

const TRACK: Record<Exclude<TrackId, 'off'>, Track> = {
  lofi: {
    bpm: 74,
    steps: 16,
    bars: 4,
    play(m, t, bar, s) {
      const ch = LOFI_CHORDS[bar % 4];
      if (s === 0) ch.forEach((n, i) => m.keys(t + i * 0.012, midi(n), 3.0, 0.05));
      if (s === 10) ch.slice(1).forEach((n, i) => m.keys(t + i * 0.01, midi(n + 12), 1.2, 0.025));
      if (s === 0 || s === 7 || s === 10) m.kick(t, 0.32);
      if (s === 4 || s === 12) m.snare(t, 0.1);
      if (s % 2 === 0) m.hat(t + (s % 4 === 2 ? 0.02 : 0), 0.025);
      if (s === 0 || s === 8) m.bass(t, midi(ch[0] - 12), 0.6, 0.12);
      if (s === 0) m.crackle(t, 2.4 * (60 / 74));
    },
  },
  zen: {
    bpm: 60,
    steps: 16,
    bars: 4,
    play(m, t, bar, s) {
      if (s === 0) m.pad(t, [50, 57, 62, 66].map((n) => midi(n + (bar % 2 ? -2 : 0))), 4 * (60 / 60) * 1.05, 0.03);
      // A sparse plucked melody: a few notes per bar, from a fixed pattern.
      const pat = [0, 3, 6, 10, 13];
      const k = pat.indexOf(s);
      if (k >= 0 && (bar + k) % 3 !== 2) m.pluck(t, midi(PENTA[(bar * 3 + k * 2) % PENTA.length]), 0.05);
      if (s === 8 && bar % 2 === 1) m.pluck(t, midi(PENTA[(bar + 5) % PENTA.length] - 12), 0.035);
    },
  },
  street: {
    bpm: 88,
    steps: 16,
    bars: 2,
    play(m, t, bar, s) {
      const kicks = bar === 0 ? [0, 3, 8, 10] : [0, 6, 8, 11];
      if (kicks.includes(s)) m.kick(t, 0.38);
      if (s === 4 || s === 12) m.snare(t, 0.16);
      if (s % 2 === 0) m.hat(t, s % 4 === 0 ? 0.035 : 0.02);
      const line = bar === 0 ? [[0, 45], [3, 45], [8, 48], [10, 43]] : [[0, 41], [6, 41], [8, 43], [11, 40]];
      for (const [at, n] of line) if (s === at) m.bass(t, midi(n), 0.3, 0.13);
      if (s === 0 && bar === 0) m.keys(t, midi(69), 0.5, 0.02);
      if (s === 14) m.keys(t, midi(bar === 0 ? 72 : 67), 0.25, 0.018);
    },
  },
  night: {
    bpm: 96,
    steps: 16,
    bars: 4,
    play(m, t, bar, s) {
      const ch = NIGHT_CHORDS[bar % 4];
      if (s === 0) m.pad(t, ch.map((n) => midi(n + 12)), 4 * (60 / 96) * 4 * 0.26, 0.025);
      if (s % 2 === 0) m.arp(t, midi(ch[(s / 2) % 4] + 24), 0.016);
      if (s % 4 === 0) m.bass(t, midi(ch[0]), 0.2, 0.1);
      if (s === 0 || s === 8) m.kick(t, 0.25);
      if (s === 4 || s === 12) m.snare(t, 0.07);
    },
  },
};

export class Music {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private track: TrackId = 'off';
  private timer = 0;
  private next = 0;
  private bar = 0;
  private step = 0;
  /** Overall loudness: 1 soft, 2 normal, 3 loud (it still sits under the sound effects). */
  private level: 1 | 2 | 3 = 2;
  private gainFor = () => [0, 0.24, 0.42, 0.62][this.level];

  constructor() {
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.visibilityState === 'hidden') void this.ctx.suspend().catch(() => {});
      else if (this.track !== 'off') void this.ctx.resume().catch(() => {});
    });
  }

  get current(): TrackId {
    return this.track;
  }

  /** Switch tracks ('off' stops). Call from a tap the first time (browsers need a gesture). */
  set(id: TrackId): void {
    this.track = id;
    if (id === 'off') return this.stop();
    if (!this.ensure()) return;
    void this.ctx!.resume().catch(() => {});
    const now = this.ctx!.currentTime;
    this.out!.gain.cancelScheduledValues(now);
    this.out!.gain.setValueAtTime(0.0001, now);
    this.out!.gain.exponentialRampToValueAtTime(this.gainFor(), now + 1.5);
    this.bar = 0;
    this.step = 0;
    this.next = now + 0.1;
    clearInterval(this.timer);
    this.timer = window.setInterval(() => this.schedule(), 90);
  }

  /** Change the loudness (1–3) without restarting the track. */
  setLevel(level: 1 | 2 | 3): void {
    this.level = level;
    if (!this.ctx || !this.out || this.track === 'off') return;
    const now = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(now);
    this.out.gain.setValueAtTime(Math.max(0.0001, this.out.gain.value), now);
    this.out.gain.linearRampToValueAtTime(this.gainFor(), now + 0.3);
  }

  private stop(): void {
    clearInterval(this.timer);
    this.timer = 0;
    if (!this.ctx || !this.out) return;
    const now = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(now);
    this.out.gain.setValueAtTime(this.out.gain.value, now);
    this.out.gain.linearRampToValueAtTime(0, now + 0.4);
  }

  private ensure(): boolean {
    if (this.ctx) return true;
    try {
      const C = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new C();
      this.out = this.ctx.createGain();
      this.out.gain.value = 0;
      // A gentle low-pass keeps everything soft and out of the way of the sound effects.
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 5200;
      // A soft limiter keeps the louder settings from clipping when notes pile up.
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.knee.value = 12;
      comp.ratio.value = 4;
      comp.attack.value = 0.01;
      comp.release.value = 0.25;
      this.out.connect(lp).connect(comp).connect(this.ctx.destination);
      const n = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, n, n);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      return true;
    } catch {
      return false;
    }
  }

  private schedule(): void {
    if (!this.ctx || this.track === 'off') return;
    const tr = TRACK[this.track];
    const stepDur = 60 / tr.bpm / 4;
    while (this.next < this.ctx.currentTime + 0.35) {
      tr.play(this, this.next, this.bar, this.step);
      this.next += stepDur;
      if (++this.step >= tr.steps) {
        this.step = 0;
        this.bar = (this.bar + 1) % tr.bars;
      }
    }
  }

  // ---- instruments ----
  private env(t: number, peak: number, attack: number, dur: number): GainNode {
    const g = this.ctx!.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(this.out!);
    return g;
  }
  private osc(type: OscillatorType, f: number, t: number, dur: number, g: AudioNode, detune = 0): void {
    const o = this.ctx!.createOscillator();
    o.type = type;
    o.frequency.value = f;
    o.detune.value = detune;
    o.connect(g);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
  keys(t: number, f: number, dur: number, v: number): void {
    const g = this.env(t, v, 0.01, dur);
    this.osc('sine', f, t, dur, g);
    this.osc('triangle', f * 2, t, dur * 0.4, this.env(t, v * 0.25, 0.005, dur * 0.4));
  }
  pad(t: number, fs: number[], dur: number, v: number): void {
    for (const f of fs) {
      const g = this.env(t, v, dur * 0.3, dur);
      this.osc('triangle', f, t, dur, g, -6);
      this.osc('sine', f, t, dur, g, 7);
    }
  }
  pluck(t: number, f: number, v: number): void {
    const g = this.env(t, v, 0.004, 1.6);
    this.osc('triangle', f, t, 1.6, g);
    this.osc('sine', f * 3, t, 0.25, this.env(t, v * 0.3, 0.002, 0.25));
  }
  arp(t: number, f: number, v: number): void {
    this.osc('square', f, t, 0.18, this.env(t, v, 0.005, 0.18));
  }
  bass(t: number, f: number, dur: number, v: number): void {
    this.osc('sine', f, t, dur, this.env(t, v, 0.01, dur));
  }
  kick(t: number, v: number): void {
    const o = this.ctx!.createOscillator();
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    o.connect(this.env(t, v * 0.5, 0.004, 0.22));
    o.start(t);
    o.stop(t + 0.3);
  }
  private noise(t: number, dur: number, v: number, type: BiquadFilterType, freq: number): void {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx!.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    src.connect(f).connect(this.env(t, v, 0.002, dur));
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }
  snare(t: number, v: number): void {
    this.noise(t, 0.16, v, 'bandpass', 1800);
  }
  hat(t: number, v: number): void {
    this.noise(t, 0.04, v, 'highpass', 7000);
  }
  crackle(t: number, dur: number): void {
    // Vinyl dust: a few faint ticks over the bar.
    for (let i = 0; i < 6; i++) this.noise(t + Math.random() * dur, 0.01, 0.012, 'highpass', 3000);
  }
}
