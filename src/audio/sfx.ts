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
}
