// Small preferences kept on the device: the nickname, the last Player 2 name, the
// last mode, sound, music and the look. Storage can be unavailable (private windows), so every access
// is guarded and the app works without it.

import type { MatchState, Mode } from '../core/match.ts';
import type { TrackId } from '../audio/music.ts';
import type { ThemeId } from '../theme.ts';
import { AGENT_IDS, type AgentId } from '../core/agents.ts';

export type HelpTopic = Mode | 'agents';
export type PcLevel = 'easy' | 'normal' | 'hard';
const isLevel = (x: unknown): x is PcLevel => x === 'easy' || x === 'normal' || x === 'hard';

export interface Prefs {
  nickname: string;
  player2: string;
  mode: Mode;
  sound: boolean;
  /** How-to-play cards already shown. */
  seenHelp: HelpTopic[];
  /** Agents mode on for local matches (Classic when off). */
  agents: boolean;
  /** The last agents each player picked (the select screen starts there). */
  picks: [AgentId, AgentId];
  /** Read the tutorials aloud. */
  voice: boolean;
  /** Last vs-PC difficulty. */
  pcLevel: PcLevel;
  /** Agents: the original Pro abilities (wet paint, timers) instead of Simple. */
  pro: boolean;
  /** Background music track. */
  music: TrackId;
  /** Look: Notebook (pen on paper, the default) or Street. */
  theme: ThemeId;
  /** Vibration on taps and wins (separate from sound effects). */
  buzz: boolean;
  /** Music loudness: 1 soft, 2 normal, 3 loud. */
  musicVol: 1 | 2 | 3;
  /** The look was chosen in Settings (before build 22 Street was the default, so an
   *  old saved 'street' without this switches to Notebook once). */
  themePicked: boolean;
  /** The "Playing for the first time?" question has been answered. */
  welcomed: boolean;
}

const KEY = 'paintcube.prefs';
const DEFAULTS: Prefs = { nickname: '', player2: '', mode: 'rotating', sound: true, seenHelp: [], agents: false, picks: ['blitz', 'stencil'], voice: true, pcLevel: 'normal', pro: false, music: 'lofi', theme: 'notebook', buzz: true, musicVol: 2, themePicked: false, welcomed: false };
const isAgent = (x: unknown): x is AgentId => AGENT_IDS.includes(x as AgentId);

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
      seenHelp: Array.isArray(p.seenHelp) ? p.seenHelp.filter((m): m is HelpTopic => m === 'rotating' || m === 'cascade' || m === 'agents') : [],
      agents: p.agents === true,
      voice: p.voice !== false,
      pcLevel: isLevel(p.pcLevel) ? p.pcLevel : 'normal',
      pro: p.pro === true,
      music: (['off', 'lofi', 'zen', 'street', 'night'] as const).includes(p.music as never) ? (p.music as TrackId) : 'lofi',
      theme: p.theme === 'street' && p.themePicked === true ? 'street' : 'notebook',
      themePicked: p.themePicked === true,
      welcomed: p.welcomed === true,
      buzz: typeof p.buzz === 'boolean' ? p.buzz : p.sound !== false,
      musicVol: p.musicVol === 1 || p.musicVol === 3 ? p.musicVol : 2,
      picks: Array.isArray(p.picks) && isAgent(p.picks[0]) && isAgent(p.picks[1]) ? [p.picks[0], p.picks[1]] : [...DEFAULTS.picks],
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
  /** Against the PC (player 2), at this difficulty. */
  pc?: PcLevel;
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
