// Reading the tutorials aloud. In the Android app: the phone's own text-to-speech
// (PaintCubePlugin.java), with its clearest English voice. In a browser: the Web Speech
// API. Never throws; silent where neither exists.

interface VoicePlugin {
  speak(o: { text: string; rate?: number }): Promise<void>;
  stopSpeaking(): Promise<void>;
  speaking(): Promise<{ speaking: boolean }>;
}

function plugin(): VoicePlugin | null {
  const cap = (window as unknown as { Capacitor?: { Plugins?: { PaintCube?: VoicePlugin }; isNativePlatform?: () => boolean } }).Capacitor;
  return cap?.isNativePlatform?.() ? (cap.Plugins?.PaintCube ?? null) : null;
}

/** Rank browser voices: natural/neural first, then Indian, British, American English. */
function score(v: SpeechSynthesisVoice): number {
  let s = 0;
  if (/natural|neural|enhanced|premium|wavenet/i.test(v.name)) s += 40;
  if (/google/i.test(v.name)) s += 20;
  if (v.lang === 'en-IN') s += 30;
  else if (v.lang === 'en-GB') s += 20;
  else if (v.lang === 'en-US') s += 15;
  if (v.localService) s += 5;
  return s;
}

let webVoices: SpeechSynthesisVoice[] = [];
function pickWebVoices(): void {
  try {
    webVoices = speechSynthesis
      .getVoices()
      .filter((v) => v.lang.toLowerCase().startsWith('en'))
      .sort((a, b) => score(b) - score(a));
  } catch {
    webVoices = [];
  }
}
if (typeof speechSynthesis !== 'undefined') {
  pickWebVoices();
  speechSynthesis.addEventListener?.('voiceschanged', pickWebVoices);
}

const quietly = (p: Promise<unknown> | undefined) => void p?.catch(() => {});

export const voice = {
  enabled: true,
  rate: 1.0,
  get available(): boolean {
    return !!plugin() || typeof speechSynthesis !== 'undefined';
  },
  say(text: string): void {
    if (!this.enabled || !text) return;
    const clean = text.replace(/[“”]/g, '"').replace(/…/g, '...');
    const p = plugin();
    if (p) return quietly(p.speak({ text: clean, rate: this.rate }));
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(clean);
      u.rate = this.rate;
      const v = webVoices[0];
      if (v) {
        u.voice = v;
        u.lang = v.lang;
      } else u.lang = 'en-IN';
      speechSynthesis.speak(u);
    } catch {
      /* no speech here */
    }
  },
  stop(): void {
    const p = plugin();
    if (p) return quietly(p.stopSpeaking());
    try {
      speechSynthesis.cancel();
    } catch {
      /* none */
    }
  },
  /** Resolves when the voice has finished (or after `maxMs`, or at once when silent). */
  async whenDone(maxMs = 20000): Promise<void> {
    if (!this.enabled) return;
    const t0 = Date.now();
    const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
    let started = false;
    while (Date.now() - t0 < maxMs) {
      let on = false;
      const p = plugin();
      try {
        if (p) on = !!(await p.speaking()).speaking;
        else if (typeof speechSynthesis !== 'undefined') on = speechSynthesis.speaking || speechSynthesis.pending;
        else return;
      } catch {
        return;
      }
      if (on) started = true;
      else if (started || Date.now() - t0 > 2500) return;
      await pause(started ? 200 : 120);
    }
  },
};
