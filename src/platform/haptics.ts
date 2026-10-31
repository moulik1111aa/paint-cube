// Vibration feedback. In the Android app this uses Capacitor's Haptics plugin (the
// phone's haptic engine; reached through the native bridge, so nothing is bundled);
// in a browser it falls back to the Vibration API where allowed. Never throws.

interface HapticsPlugin {
  impact(o: { style: 'LIGHT' | 'MEDIUM' | 'HEAVY' }): Promise<void>;
  notification(o: { type: 'SUCCESS' | 'WARNING' | 'ERROR' }): Promise<void>;
}

function plugin(): HapticsPlugin | null {
  const cap = (window as unknown as { Capacitor?: { Plugins?: { Haptics?: HapticsPlugin } } }).Capacitor;
  return cap?.Plugins?.Haptics ?? null;
}

function web(pattern: number | number[]): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* not allowed here */
  }
}

export const haptics = {
  enabled: true,
  /** Paint lands, a piece settles. */
  tap(): void {
    if (!this.enabled) return;
    const p = plugin();
    if (p) void p.impact({ style: 'LIGHT' }).catch(() => {});
    else web(8);
  },
  /** A twist commits. */
  turn(): void {
    if (!this.enabled) return;
    const p = plugin();
    if (p) void p.impact({ style: 'MEDIUM' }).catch(() => {});
    else web(16);
  },
  /** A line bursts (stronger for combos). */
  burst(wave = 1): void {
    if (!this.enabled) return;
    const p = plugin();
    if (p) void p.impact({ style: 'HEAVY' }).catch(() => {});
    else web(wave > 1 ? [24, 40, 30] : 28);
  },
  /** A refused move. */
  refuse(): void {
    if (!this.enabled) return;
    const p = plugin();
    if (p) void p.notification({ type: 'WARNING' }).catch(() => {});
    else web([10, 40, 10]);
  },
  /** A round won. */
  win(): void {
    if (!this.enabled) return;
    const p = plugin();
    if (p) void p.notification({ type: 'SUCCESS' }).catch(() => {});
    else web([30, 60, 30, 60, 70]);
  },
};
