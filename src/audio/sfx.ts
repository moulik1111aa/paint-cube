// Sound effects synthesized with Web Audio: no audio files. Every sound is short and
// punchy; the cascade wave raises the pitch. The context starts on the first tap
// (browsers only allow audio after a user gesture).

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  enabled = true;

  /** Call from a tap handler. */
  unlock(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.55;
      const comp = this.ctx.createDynamicsCompressor();
      this.master.connect(comp).connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } catch {
      this.ctx = null;
    }
  }

  private ready(): AudioContext | null {
    return this.enabled && this.ctx && this.master ? this.ctx : null;
  }

  private noise(at: number, dur: number, type: BiquadFilterType, f0: number, f1: number, q: number, vol: number): void {
    const c = this.ctx!;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, at);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), at + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(vol, at + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(f).connect(g).connect(this.master!);
    src.start(at, Math.random() * 0.5);
    src.stop(at + dur + 0.05);
  }

  private tone(at: number, dur: number, type: OscillatorType, f0: number, f1: number, vol: number): void {
    const c = this.ctx!;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, at);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), at + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(vol, at + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g).connect(this.master!);
    o.start(at);
    o.stop(at + dur + 0.05);
  }

  /** Paintball thwack and wet splat. */
  splat(pitch = 1): void {
    const c = this.ready();
    if (!c) return;
    const t = c.currentTime;
    this.tone(t, 0.16, 'sine', 180 * pitch, 45, 0.9);
    this.noise(t, 0.09, 'bandpass', 2400 * pitch, 600, 1.2, 0.7);
    this.noise(t + 0.02, 0.22, 'lowpass', 1800 * pitch, 300, 0.7, 0.45);
  }

  /** A layer turning. */
  whoosh(): void {
    const c = this.ready();
    if (!c) return;
    const t = c.currentTime;
    this.noise(t, 0.38, 'bandpass', 300, 2600, 2.5, 0.35);
    this.tone(t + 0.36, 0.06, 'square', 900, 500, 0.08);
  }

  /** A line bursting; higher on later cascade waves. */
  burst(wave = 1): void {
    const c = this.ready();
    if (!c) return;
    const t = c.currentTime;
    const p = 1 + (wave - 1) * 0.25;
    this.tone(t, 0.45, 'sine', 120 * p, 32, 1.0);
    this.tone(t, 0.25, 'triangle', 660 * p, 220 * p, 0.25);
    this.noise(t, 0.5, 'lowpass', 5000, 200, 0.5, 0.8);
    this.noise(t + 0.05, 0.35, 'highpass', 3000, 6000, 0.6, 0.25);
  }

  /** Dry paint cracking and flaking. */
  crackle(): void {
    const c = this.ready();
    if (!c) return;
    const t = c.currentTime;
    for (let i = 0; i < 6; i++) this.noise(t + i * 0.045 + Math.random() * 0.02, 0.03, 'highpass', 3500, 5000, 1, 0.3);
  }

  /** Round win sting. */
  win(): void {
    const c = this.ready();
    if (!c) return;
    const t = c.currentTime;
    this.burst(2);
    [523, 659, 784, 1047].forEach((f, i) => this.tone(t + 0.12 + i * 0.09, 0.5, 'triangle', f, f * 1.01, 0.22));
  }

  /** Agent select: a sprayed LOCK IN stinger. */
  stinger(): void {
    const c = this.ready();
    if (!c) return;
    const t = c.currentTime;
    this.noise(t, 0.25, 'bandpass', 1800, 5200, 1.4, 0.5);
    [392, 523, 784].forEach((f, i) => this.tone(t + 0.05 + i * 0.07, 0.35, 'square', f, f * 1.02, 0.12));
    this.tone(t, 0.4, 'sine', 90, 40, 0.8);
  }

  /** A power or ultimate going off: each has its own little signature. */
  power(id: string): void {
    const c = this.ready();
    if (!c) return;
    const t = c.currentTime;
    switch (id) {
      case 'doubleTap':
        this.splat(1.2);
        setTimeout(() => this.splat(1.35), 110);
        break;
      case 'shove':
        this.tone(t, 0.18, 'sawtooth', 220, 80, 0.25);
        this.noise(t, 0.2, 'lowpass', 900, 200, 0.8, 0.5);
        break;
      case 'overspray':
        this.noise(t, 0.6, 'highpass', 2500, 7000, 0.7, 0.45);
        break;
      case 'tape':
        this.noise(t, 0.32, 'bandpass', 3000, 1200, 6, 0.4);
        this.tone(t + 0.3, 0.05, 'square', 300, 300, 0.1);
        break;
      case 'fixative':
        this.noise(t, 0.45, 'highpass', 6000, 9000, 0.5, 0.25);
        this.tone(t + 0.1, 0.4, 'sine', 1320, 1760, 0.12);
        break;
      case 'wetFloor':
        [880, 660, 880, 660].forEach((f, i) => this.tone(t + i * 0.09, 0.08, 'square', f, f, 0.08));
        break;
      case 'spin':
        this.whoosh();
        this.tone(t, 0.4, 'triangle', 300, 900, 0.12);
        break;
      case 'swap':
        this.tone(t, 0.12, 'square', 600, 900, 0.1);
        this.tone(t + 0.12, 0.12, 'square', 900, 600, 0.1);
        break;
      case 'trap':
        this.tone(t, 0.08, 'square', 1200, 1200, 0.08);
        this.tone(t + 0.12, 0.08, 'square', 1200, 1200, 0.08);
        break;
      case 'afterimage':
        for (let i = 0; i < 3; i++) this.tone(t + i * 0.12, 0.3, 'sine', 660 - i * 60, 330 - i * 30, 0.15 / (i + 1));
        break;
      case 'delay':
        this.tone(t, 0.6, 'sine', 500, 180, 0.2);
        break;
      case 'reverb':
        for (let i = 0; i < 4; i++) this.tone(t + i * 0.1, 0.25, 'triangle', 880, 880, 0.2 * 0.6 ** i);
        break;
      default:
        // Ultimates: a big boom and a rising chord.
        this.tone(t, 0.8, 'sine', 70, 30, 1.0);
        this.noise(t, 0.7, 'lowpass', 6000, 300, 0.6, 0.7);
        [262, 330, 392, 523].forEach((f, i) => this.tone(t + 0.1 + i * 0.06, 0.6, 'sawtooth', f, f * 1.01, 0.08));
    }
  }
}
