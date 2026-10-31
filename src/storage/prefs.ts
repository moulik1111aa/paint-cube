// Small preferences kept on the device: the nickname, the last Player 2 name, the
// last mode, and sound. Storage can be unavailable (private windows), so every access
// is guarded and the app works without it.

import type { MatchState, Mode } from '../core/match.ts';

export interface Prefs {
  nickname: string;
  player2: string;
  mode: Mode;
  sound: boolean;
  /** Modes whose how-to-play cards have been shown. */
  seenHelp: Mode[];
}

const KEY = 'paintcube.prefs';
const DEFAULTS: Prefs = { nickname: '', player2: '', mode: 'rotating', sound: true, seenHelp: [] };

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const p = JSON.parse(raw) as Partial<Prefs>;
    return {
      nickname: typeof p.nickname === 'string' ? p.nickname : '',
      player2: typeof p.player2 === 'string' ? p.player2 : '',
      mode: p.mode === 'cascade' ? 'cascade' : 'rotating',
      sound: p.sound !== false,
      seenHelp: Array.isArray(p.seenHelp) ? p.seenHelp.filter((m): m is Mode => m === 'rotating' || m === 'cascade') : [],
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function savePrefs(p: Prefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable: keep going */
  }
}

/** Trim, collapse spaces, and cap a name at 14 characters. */
export function cleanName(s: string): string {
  return s.replace(/\s+/g, ' ').trim().slice(0, 14);
}

/** A local match in progress, kept so it survives the app being closed. */
export interface SavedMatch {
  match: MatchState;
  names: [string, string];
}

const MATCH_KEY = 'paintcube.local';

export function loadMatch(): SavedMatch | null {
  try {
    const s = JSON.parse(localStorage.getItem(MATCH_KEY) ?? 'null');
    return s && s.match && Array.isArray(s.names) && s.match.winner === null ? s : null;
  } catch {
    return null;
  }
}

export function saveMatch(s: SavedMatch | null): void {
  try {
    if (s && s.match.winner === null) localStorage.setItem(MATCH_KEY, JSON.stringify(s));
    else localStorage.removeItem(MATCH_KEY);
  } catch {
    /* storage unavailable */
  }
}
