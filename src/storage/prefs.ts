// Small preferences kept on the device: the nickname, the last Player 2 name, the
// last mode, and sound. Storage can be unavailable (private windows), so every access
// is guarded and the app works without it.

import type { MatchState, Mode } from '../core/match.ts';
import { AGENT_IDS, type AgentId } from '../core/agents.ts';

export type HelpTopic = Mode | 'agents';

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
}

const KEY = 'paintcube.prefs';
const DEFAULTS: Prefs = { nickname: '', player2: '', mode: 'rotating', sound: true, seenHelp: [], agents: false, picks: ['blitz', 'stencil'], voice: true };
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
