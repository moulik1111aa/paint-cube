// Agents mode: each player picks a graffiti writer with three powers and an ultimate.
// On your turn you may use ONE power or your ultimate, then make your normal move.
// Powers run on timers (cooldowns, durations), and paint they place or move is "wet":
// a line that includes wet paint only counts once it has dried (at the start of its
// owner's turn, `dryTurns` turns later) and only if it is still intact then. Powers
// that move, wipe or seal paint also make that turn's move wet. So a basic power never
// wins a round on its own: the other side always gets a reply. Ultimates aren't wet.
//
// Pure rules on JSON-safe state, like the rest of src/core. The classic engines
// (rotating.ts, cascade.ts) are untouched; this file runs both modes with the agent
// rules layered in, and match.ts routes to it when a match has agents.
//
// Every tunable number lives in AGENT_TUNING, so tuning is a data change and the
// tests and simulations read the same table.

import { CELLS, CENTER, COLUMNS, LINES, coord, index, other, type Cell, type Line, type Player } from './geometry.ts';
import { IllegalMove, type GameEvent, type IllegalReason } from './events.ts';
import { MAX_MARKS, DRAW_TURNS, type RotatingMove, type RotatingState, newRotating } from './rotating.ts';
import { TARGET, landing, type CascadeMove, type CascadeState, newCascade } from './cascade.ts';
import { TWISTS, inverse, permutation, sameTwist, type Twist } from './twist.ts';

export type AgentId = 'blitz' | 'stencil' | 'drift' | 'echo';
export const AGENT_IDS: readonly AgentId[] = ['blitz', 'stencil', 'drift', 'echo'];
export type PowerId = 'doubleTap' | 'shove' | 'overspray' | 'tape' | 'fixative' | 'wetFloor' | 'spin' | 'swap' | 'trap' | 'afterimage' | 'delay' | 'reverb';
export type UltId = 'chrome' | 'lockdown' | 'flip' | 'rewind';
export type AbilityId = PowerId | UltId;
type AgentMode = 'rotating' | 'cascade';

export interface AgentInfo {
  name: string;
  role: string;
  tagline: string;
  powers: readonly [PowerId, PowerId, PowerId];
  ult: UltId;
}

export const AGENTS: Record<AgentId, AgentInfo> = {
  blitz: { name: 'BLITZ', role: 'Duelist', tagline: 'Hits first, hits twice', powers: ['doubleTap', 'shove', 'overspray'], ult: 'chrome' },
  stencil: { name: 'STENCIL', role: 'Sentinel', tagline: 'Nothing gets past the tape', powers: ['tape', 'fixative', 'wetFloor'], ult: 'lockdown' },
  drift: { name: 'DRIFT', role: 'Controller', tagline: 'Moves the whole wall', powers: ['spin', 'swap', 'trap'], ult: 'flip' },
  echo: { name: 'ECHO', role: 'Initiator', tagline: 'Plays with time', powers: ['afterimage', 'delay', 'reverb'], ult: 'rewind' },
};

export interface ModeTuning {
  /** Your turns a power stays unavailable after use. */
  cooldown: Record<PowerId, number>;
  /** The cooldown each power starts a round with (0 = ready from the first turn). */
  firstReady: Record<PowerId, number>;
  /** Pips needed for each ultimate (the meter fills up to this). */
  ultCost: Record<UltId, number>;
  /** Pips gained at the end of each of your turns. */
  ultPerTurn: number;
  /** Pips gained when the opponent wins a round (Twist) or scores (Cascade). */
  ultBonus: number;
  /** Wet paint dries after this many starts of its owner's turn (1 = their next turn). */
  dryTurns: number;
  /** Durations, in the affected (opposing) player's turns. */
  tapeTurns: number;
  fixativeTurns: number;
  wetFloorTurns: number;
  trapTurns: number;
  lockdownTurns: number;
  /** How many of your next marks Chrome makes chrome. */
  chromeMarks: number;
  /** Cascade: points multiplier for a line with a chrome cube in it. */
  chromeScore: number;
}

const base = (cd: number): Record<PowerId, number> => ({
  doubleTap: cd, shove: cd, overspray: cd, tape: cd, fixative: cd, wetFloor: cd,
  spin: cd, swap: cd, trap: cd, afterimage: cd, delay: cd, reverb: cd,
});

/**
 * Every tunable number of Agents mode, per game mode. Tuned with the bot sweep
 * (`npm run simulate -- agents`); the log is in docs/agents-balance.md.
 *
 * A cooldown of 8+ in Twist or 12 in Cascade means "about once per round" (cooldowns
 * reset each round). `firstReady` holds a power back at the start of each round:
 * in Cascade most powers only unlock in the second half of a round, because one
 * extra cube decides a race to 5 points.
 */
export const AGENT_TUNING: Record<AgentMode, ModeTuning> = {
  rotating: {
    cooldown: {
      doubleTap: 8, shove: 8, overspray: 8,
      tape: 2, fixative: 1, wetFloor: 2,
      spin: 10, swap: 10, trap: 9,
      afterimage: 6, delay: 4, reverb: 7,
    },
    firstReady: { ...base(0), doubleTap: 1, shove: 1, overspray: 1, spin: 3, swap: 5 },
    ultCost: { chrome: 10, lockdown: 3, flip: 36, rewind: 24 },
    ultPerTurn: 1,
    ultBonus: 2,
    dryTurns: 2,
    tapeTurns: 4,
    fixativeTurns: 4,
    wetFloorTurns: 2,
    trapTurns: 3,
    lockdownTurns: 3,
    chromeMarks: 2,
    chromeScore: 2,
  },
  cascade: {
    cooldown: {
      doubleTap: 12, shove: 12, overspray: 12,
      tape: 4, fixative: 4, wetFloor: 4,
      spin: 12, swap: 3, trap: 1,
      afterimage: 12, delay: 12, reverb: 12,
    },
    firstReady: { ...base(0), doubleTap: 14, overspray: 12, shove: 10, spin: 6, afterimage: 11, delay: 11, reverb: 11 },
    ultCost: { chrome: 50, lockdown: 9, flip: 7, rewind: 50 },
    ultPerTurn: 1,
    ultBonus: 2,
    dryTurns: 2,
    tapeTurns: 3,
    fixativeTurns: 3,
    wetFloorTurns: 2,
    trapTurns: 6,
    lockdownTurns: 2,
    chromeMarks: 1,
    chromeScore: 2,
  },
};

export type Effect =
  | { kind: 'tape' | 'trap' | 'seal'; cell: number; by: Player; turns: number }
  | { kind: 'floor'; line: number; by: Player; turns: number }
  | { kind: 'lockdown'; by: Player; turns: number };

/** What Rewind puts back: the board and effects at the start of the opponent's last turn. */
export interface Snapshot {
  round: RotatingState | CascadeState;
  wet: number[];
  chrome: boolean[];
  effects: Effect[];
  delay: [boolean, boolean];
  chromeLeft: [number, number];
  lost: [number | null, number | null];
  cd: [number[], number[]];
  ult: [number, number];
}

export interface AgentsState {
  picks: [AgentId, AgentId];
  /** Turns left on each power's cooldown (slots 0-2), per player. */
  cd: [number[], number[]];
  /** Ultimate pips. */
  ult: [number, number];
  /** The ability used this turn (one per turn). */
  used: AbilityId | null;
  /** Wet paint, per cell (it moves with its mark): how many of its owner's turn starts until it dries (0 = dry). */
  wet: number[];
  /** Chrome marks, per cell. */
  chrome: boolean[];
  effects: Effect[];
  /** Delay: this player's next marks this turn are wet. */
  delay: [boolean, boolean];
  /** Chrome: marks left that come out chrome. */
  chromeLeft: [number, number];
  /** Reverb is waiting for this turn's move. */
  reverb: boolean;
  /** Each player's most recently lost mark (faded, wiped or burst). */
  lost: [number | null, number | null];
  /** State at the start of the current turn. */
  start: Snapshot | null;
  /** State at the start of the previous turn (what the current player's Rewind restores). */
  prev: Snapshot | null;
}

export type AbilityUse = { kind: 'ability'; id: AbilityId; cells?: number[]; twists?: Twist[] };
/** Only when there is no other legal move (Cascade with every open column taped). */
export type PassMove = { kind: 'pass' };
export type AgentRound = RotatingState | CascadeState;
export type AgentMove = RotatingMove | CascadeMove | AbilityUse | PassMove;

/** Cascade with agents: a round with no winner after this many turns is a draw (a safety net). */
export const CASCADE_DRAW_TURNS = 120;

export function newAgents(picks: [AgentId, AgentId]): AgentsState {
  return {
    picks: [picks[0], picks[1]],
    cd: [[0, 0, 0], [0, 0, 0]],
    ult: [0, 0],
    used: null,
    wet: Array(CELLS).fill(0),
    chrome: Array(CELLS).fill(false),
    effects: [],
    delay: [false, false],
    chromeLeft: [0, 0],
    reverb: false,
    lost: [null, null],
    start: null,
    prev: null,
  };
}

/** A new round: cooldowns, effects and paint reset; picks and the ultimate meter carry over. */
export function resetAgentsForRound(a: AgentsState, round: AgentRound): AgentsState {
  const n = newAgents(a.picks);
  const t = AGENT_TUNING[round.mode];
  n.cd = [AGENTS[a.picks[0]].powers.map((id) => t.firstReady[id]), AGENTS[a.picks[1]].powers.map((id) => t.firstReady[id])];
  n.ult = [a.ult[0], a.ult[1]];
  n.start = snapshot(round, n);
  return n;
}

/** Powers that also make the same turn's move wet (they could otherwise open a line for it). */
export const WETS_MOVE: ReadonlySet<AbilityId> = new Set<AbilityId>(['shove', 'overspray', 'spin', 'fixative']);

export const tuning = (mode: AgentMode): ModeTuning => AGENT_TUNING[mode];
export const ultCostOf = (t: ModeTuning, agent: AgentId): number => t.ultCost[AGENTS[agent].ult];
export const isUlt = (id: AbilityId): id is UltId => id === 'chrome' || id === 'lockdown' || id === 'flip' || id === 'rewind';
export const slotOf = (agent: AgentId, id: AbilityId): number => (AGENTS[agent].powers as readonly AbilityId[]).indexOf(id);
export const abilitiesOf = (agent: AgentId): AbilityId[] => [...AGENTS[agent].powers, AGENTS[agent].ult];

// Hand-written copies: the simulations run millions of these, so no JSON round trips.
function copyRound(r: AgentRound): AgentRound {
  if (r.mode === 'rotating') {
    return {
      mode: 'rotating',
      cells: r.cells.slice(),
      marks: [r.marks[0].slice(), r.marks[1].slice()],
      turn: r.turn,
      turns: r.turns,
      lastTwist: r.lastTwist ? { ...r.lastTwist } : null,
      twistedLast: [r.twistedLast[0], r.twistedLast[1]],
      result: r.result ? (r.result.winner === null ? { winner: null } : { winner: r.result.winner, line: r.result.line }) : null,
    };
  }
  return { mode: 'cascade', cells: r.cells.slice(), turn: r.turn, turns: r.turns, scores: [r.scores[0], r.scores[1]], result: r.result ? { ...r.result } : null };
}
const copyEffects = (e: readonly Effect[]): Effect[] => e.map((x) => ({ ...x }));

/** Snapshots are never mutated once taken, so working copies share them. */
function snapshot(round: AgentRound, a: AgentsState): Snapshot {
  return {
    round: copyRound(round),
    wet: a.wet.slice(),
    chrome: a.chrome.slice(),
    effects: copyEffects(a.effects),
    delay: [a.delay[0], a.delay[1]],
    chromeLeft: [a.chromeLeft[0], a.chromeLeft[1]],
    lost: [a.lost[0], a.lost[1]],
    cd: [a.cd[0].slice(), a.cd[1].slice()],
    ult: [a.ult[0], a.ult[1]],
  };
}

function copyAgents(a: AgentsState): AgentsState {
  return {
    picks: [a.picks[0], a.picks[1]],
    cd: [a.cd[0].slice(), a.cd[1].slice()],
    ult: [a.ult[0], a.ult[1]],
    used: a.used,
    wet: a.wet.slice(),
    chrome: a.chrome.slice(),
    effects: copyEffects(a.effects),
    delay: [a.delay[0], a.delay[1]],
    chromeLeft: [a.chromeLeft[0], a.chromeLeft[1]],
    reverb: a.reverb,
    lost: [a.lost[0], a.lost[1]],
    start: a.start,
    prev: a.prev,
  };
}

// ---------------------------------------------------------------------------------
// Working copy: every operation below mutates one of these, then `finish` freezes it.

interface W {
  r: AgentRound;
  a: AgentsState;
  ev: GameEvent[];
  t: ModeTuning;
}

const working = (r: AgentRound, a: AgentsState): W => ({ r: copyRound(r), a: copyAgents(a), ev: [], t: tuning(r.mode) });

const effectAt = (w: W, kind: 'tape' | 'trap' | 'seal', cell: number) =>
  w.a.effects.find((e) => e.kind === kind && 'cell' in e && e.cell === cell) as Extract<Effect, { cell: number }> | undefined;
const sealed = (w: W, cell: number) => !!effectAt(w, 'seal', cell);
const taped = (w: W, cell: number) => !!effectAt(w, 'tape', cell);
/** Chrome and sealed marks can't be moved or wiped by powers. */
const shielded = (w: W, cell: number) => w.a.chrome[cell] || sealed(w, cell);
const lockedDown = (w: W, p: Player) => w.a.effects.some((e) => e.kind === 'lockdown' && e.by !== p);

/** Whether a full line counts for its owner now. */
function counts(w: W, li: number, owner: Player): boolean {
  const [a, b, c] = LINES[li];
  const cells = w.r.cells;
  if (cells[a] !== owner || cells[b] !== owner || cells[c] !== owner) return false;
  if (w.a.wet[a] > 0 || w.a.wet[b] > 0 || w.a.wet[c] > 0) return false;
  if (w.a.effects.some((e) => e.kind === 'floor' && e.line === li && e.by !== owner)) return false;
  if (w.r.mode === 'cascade' && lockedDown(w, owner)) return false;
  return true;
}

/** Fast check: is any line fully one player's? (Most positions have none.) */
function anyFullLine(cells: readonly Cell[]): boolean {
  for (const [a, b, c] of LINES) {
    const x = cells[a];
    if (x !== null && x === cells[b] && x === cells[c]) return true;
  }
  return false;
}

function countingLines(w: W, owner: Player): number[] {
  const out: number[] = [];
  for (let i = 0; i < LINES.length; i++) if (counts(w, i, owner)) out.push(i);
  return out;
}

/** Move the contents (and their wet/chrome/seal, plus tape and traps in Twist) along `perm`. */
function permute(w: W, perm: readonly number[], positional: boolean): void {
  const r = w.r;
  const move = <T>(arr: T[]): T[] => {
    const out = arr.slice();
    for (let i = 0; i < CELLS; i++) out[perm[i]] = arr[i];
    return out;
  };
  r.cells = move(r.cells);
  w.a.wet = move(w.a.wet);
  w.a.chrome = move(w.a.chrome);
  if (r.mode === 'rotating') r.marks = [r.marks[0].map((c) => perm[c]), r.marks[1].map((c) => perm[c])];
  for (const e of w.a.effects) if ('cell' in e && (e.kind === 'seal' || !positional)) e.cell = perm[e.cell];
  for (let p = 0; p < 2; p++) {
    const l = w.a.lost[p];
    if (l !== null && !positional) w.a.lost[p] = perm[l];
  }
}

/** Remove a mark (fade, wipe or burst): it becomes its owner's most recently lost. */
function clearCell(w: W, cell: number): void {
  const owner = w.r.cells[cell];
  if (owner === null) return;
  w.r.cells[cell] = null;
  w.a.wet[cell] = 0;
  w.a.chrome[cell] = false;
  w.a.effects = w.a.effects.filter((e) => !(e.kind === 'seal' && e.cell === cell));
  if (w.r.mode === 'rotating') w.r.marks[owner] = w.r.marks[owner].filter((c) => c !== cell);
  w.a.lost[owner] = cell;
}

/** Twist: the mark that fades next for `p` (oldest that isn't chrome or sealed). */
export function nextToFade(r: RotatingState, a: AgentsState, p: Player): number {
  const w = { r, a } as W;
  if (r.marks[p].length < MAX_MARKS) return -1;
  return r.marks[p].find((c) => !shielded(w, c)) ?? -1;
}

/**
 * Paint a mark (or drop a cube) for `painter`. A trap set by the other player turns it
 * into theirs (wet). Chrome and Delay apply to the painter's own marks. Twist: the
 * owner's oldest fadeable mark fades first when they are at the cap.
 */
function paint(w: W, cell: number, painter: Player, wet: boolean, column?: number): void {
  const r = w.r;
  let owner = painter;
  let isWet = wet || w.a.delay[painter];
  const trap = effectAt(w, 'trap', cell);
  if (trap) {
    w.a.effects = w.a.effects.filter((e) => e !== trap);
    if (trap.by !== painter) {
      owner = trap.by;
      isWet = true;
    }
  }
  if (r.mode === 'rotating') {
    const f = nextToFade(r, w.a, owner);
    if (f >= 0) {
      clearCell(w, f);
      w.ev.push({ type: 'faded', player: owner, cell: f });
    }
  }
  r.cells[cell] = owner;
  w.a.wet[cell] = isWet ? w.t.dryTurns : 0;
  let chrome = false;
  if (owner === painter && w.a.chromeLeft[painter] > 0) {
    w.a.chromeLeft[painter]--;
    w.a.chrome[cell] = chrome = true;
  }
  if (r.mode === 'rotating') r.marks[owner].push(cell);
  const ev: GameEvent = { type: 'placed', player: painter, cell };
  if (column !== undefined) ev.column = column;
  if (isWet) ev.wet = true;
  if (chrome) ev.chrome = true;
  w.ev.push(ev);
  if (owner !== painter) w.ev.push({ type: 'converted', cell, from: painter, to: owner });
  if (r.mode === 'rotating') {
    const f = nextToFade(r, w.a, owner);
    if (f >= 0) w.ev.push({ type: 'cracking', player: owner, cell: f });
  }
}

/** Twist a layer; marks moved by a power come out wet. */
function doTwist(w: W, t: Twist, player: Player, wet: boolean): void {
  const perm = permutation(t);
  const moves = w.r.cells.flatMap((c, from) => (c !== null && perm[from] !== from ? [{ from, to: perm[from] }] : []));
  permute(w, perm, w.r.mode === 'cascade');
  if (wet) for (const m of moves) w.a.wet[m.to] = w.t.dryTurns;
  if (w.r.mode === 'rotating') w.r.lastTwist = { ...t };
  w.ev.push({ type: 'twisted', twist: { ...t }, moves, player });
}

/** Cascade gravity, carrying each cube's wet/chrome/seal. Fallen cubes can be made wet. */
function settle(w: W, wave: number, wetFalls: boolean): void {
  const moves: { from: number; to: number; player: Player }[] = [];
  for (const col of COLUMNS) {
    let z = 0;
    for (let k = 0; k < 3; k++) {
      const c = col[k];
      const p = w.r.cells[c];
      if (p === null) continue;
      const to = col[z];
      if (k !== z) {
        w.r.cells[to] = p;
        w.r.cells[c] = null;
        w.a.wet[to] = wetFalls ? Math.max(w.a.wet[c], w.t.dryTurns) : w.a.wet[c];
        w.a.chrome[to] = w.a.chrome[c];
        w.a.wet[c] = 0;
        w.a.chrome[c] = false;
        for (const e of w.a.effects) if (e.kind === 'seal' && e.cell === c) e.cell = to;
        moves.push({ from: c, to, player: p });
      }
      z++;
    }
  }
  if (moves.length) w.ev.push({ type: 'fell', moves, wave });
}

/**
 * Cascade: burst and score every line that counts, let the rest fall, and repeat
 * (wave n scores n per line, double with chrome). Sealed cubes stay put when their
 * line bursts. Then check the target score; a tie goes to `mover`.
 */
function resolve(w: W, mover: Player, firstWave = 1): void {
  const r = w.r as CascadeState;
  for (let wave = firstWave; ; wave++) {
    if (!anyFullLine(r.cells)) break;
    const lines = [countingLines(w, 0), countingLines(w, 1)].map((ls) => ls.filter((li) => LINES[li].some((c) => !sealed(w, c))));
    if (!lines[0].length && !lines[1].length) break;
    const cleared = new Set<number>();
    for (const q of [0, 1] as const) {
      let pts = 0;
      for (const li of lines[q]) {
        const line = LINES[li];
        w.ev.push({ type: 'lineCompleted', player: q, cells: line, wave });
        pts += wave * (line.some((c) => w.a.chrome[c]) ? w.t.chromeScore : 1);
        line.forEach((c) => !sealed(w, c) && cleared.add(c));
      }
      if (pts) {
        r.scores[q] += pts;
        w.ev.push({ type: 'scored', player: q, points: pts, wave, total: r.scores[q] });
        const o = other(q);
        w.a.ult[o] = Math.min(ultCostOf(w.t, w.a.picks[o]), w.a.ult[o] + w.t.ultBonus);
      }
    }
    const shattered = [...cleared].sort((a, b) => a - b);
    shattered.forEach((c) => clearCell(w, c));
    w.ev.push({ type: 'shattered', cells: shattered, wave });
    settle(w, wave, false);
  }
  if (!r.result && Math.max(r.scores[0], r.scores[1]) >= TARGET) {
    const o = other(mover);
    r.result = { winner: r.scores[o] > r.scores[mover] ? o : mover };
    w.ev.push({ type: 'roundOver', winner: r.result.winner });
  }
}

/** Twist: a line that counts ends the round (the mover first). */
function checkWin(w: W, mover: Player): void {
  const r = w.r as RotatingState;
  if (r.result || !anyFullLine(r.cells)) return;
  for (const p of [mover, other(mover)]) {
    const li = countingLines(w, p)[0];
    if (li !== undefined) {
      r.result = { winner: p, line: LINES[li] };
      w.ev.push({ type: 'roundOver', winner: p, line: LINES[li] });
      return;
    }
  }
}

function afterAction(w: W, mover: Player): void {
  if (w.r.mode === 'rotating') checkWin(w, mover);
  else resolve(w, mover);
}

// ---------------------------------------------------------------------------------
// Turn flow.

/** End `p`'s turn: timers tick, the meter fills, then the next player's turn starts. */
function endTurn(w: W, p: Player): void {
  const a = w.a;
  const used = a.used;
  const slot = used && !isUlt(used) ? slotOf(a.picks[p], used) : -1;
  a.cd[p] = a.cd[p].map((v, i) => (i === slot ? v : Math.max(0, v - 1)));
  a.ult[p] = Math.min(ultCostOf(w.t, a.picks[p]), a.ult[p] + w.t.ultPerTurn);
  for (const e of a.effects) if (e.by !== p) e.turns--;
  const ended = a.effects.filter((e) => e.turns <= 0);
  a.effects = a.effects.filter((e) => e.turns > 0);
  for (const e of ended) w.ev.push({ type: 'effectEnded', kind: e.kind, ...('cell' in e ? { cell: e.cell } : {}), ...(e.kind === 'floor' ? { line: e.line } : {}) });
  a.delay[p] = false;
  a.used = null;
  a.reverb = false;
  a.prev = a.start;
  if (w.r.result) return;
  w.r.turn = other(p);
  startTurn(w, other(p), p);
}

/** Start of `p`'s turn: their wet paint dries, and lines that now count are scored. */
function startTurn(w: W, p: Player, mover: Player): void {
  dry(w, p);
  if (w.r.mode === 'rotating') checkWin(w, p);
  else resolve(w, mover);
  // Only Rewind reads snapshots: skip them when nobody picked Echo.
  w.a.start = w.a.picks.includes('echo') ? snapshot(w.r, w.a) : null;
}

function dry(w: W, p: Player): void {
  const cells: number[] = [];
  for (let c = 0; c < CELLS; c++) {
    if (w.a.wet[c] > 0 && w.r.cells[c] === p) {
      w.a.wet[c]--;
      if (!w.a.wet[c]) cells.push(c);
    }
  }
  if (cells.length) w.ev.push({ type: 'dried', player: p, cells });
}

// ---------------------------------------------------------------------------------
// Normal moves under the agent rules.

export function checkAgentMove(r: AgentRound, a: AgentsState, move: AgentMove): IllegalReason | null {
  if (r.result) return 'round-over';
  if (move.kind === 'ability') return checkAbility(r, a, move);
  if (move.kind === 'pass') return legalAgentMoves(r, a).length ? 'must-move' : null;
  const w = { r, a, ev: [], t: tuning(r.mode) } as W;
  if (r.mode === 'rotating') {
    if (move.kind === 'drop') return 'wrong-mode';
    if (move.kind === 'place') {
      const c = move.cell;
      if (!Number.isInteger(c) || c < 0 || c >= CELLS) return 'not-a-cell';
      if (c === CENTER) return 'core';
      if (r.cells[c] !== null) return 'occupied';
      if (taped(w, c)) return 'taped';
      return null;
    }
    if (!TWISTS.some((t) => sameTwist(t, move.twist))) return 'not-a-twist';
    if (lockedDown(w, r.turn)) return 'locked-down';
    if (r.twistedLast[r.turn]) return 'twisted-last-turn';
    if (r.lastTwist && sameTwist(move.twist, inverse(r.lastTwist))) return 'undoes-last-twist';
    if (layerSealed(w, move.twist)) return 'sealed';
    return null;
  }
  if (move.kind !== 'drop') return 'wrong-mode';
  if (!Number.isInteger(move.column) || move.column < 0 || move.column > 8) return 'not-a-column';
  const cell = landing(r.cells, move.column);
  if (cell < 0) return 'column-full';
  if (taped(w, cell)) return 'taped';
  return null;
}

/** A twist whose layer holds a sealed mark is blocked (Fixative). */
function layerSealed(w: W, t: Twist): boolean {
  return w.a.effects.some((e) => e.kind === 'seal' && coord(e.cell)[t.axis] === t.slice);
}
function layerShielded(w: W, t: Twist): boolean {
  for (let c = 0; c < CELLS; c++) if (coord(c)[t.axis] === t.slice && w.r.cells[c] !== null && shielded(w, c)) return true;
  return false;
}

export function legalAgentMoves(r: AgentRound, a: AgentsState): (RotatingMove | CascadeMove)[] {
  return normalMoves(r, a);
}

/** Legal normal moves, or a single pass when there are none. */
export function agentTurnMoves(r: AgentRound, a: AgentsState): (RotatingMove | CascadeMove | PassMove)[] {
  if (r.result) return [];
  const m = normalMoves(r, a);
  return m.length ? m : [{ kind: 'pass' }];
}

function normalMoves(r: AgentRound, a: AgentsState): (RotatingMove | CascadeMove)[] {
  if (r.result) return [];
  const out: (RotatingMove | CascadeMove)[] = [];
  if (r.mode === 'rotating') {
    for (let c = 0; c < CELLS; c++) if (!checkAgentMove(r, a, { kind: 'place', cell: c })) out.push({ kind: 'place', cell: c });
    for (const twist of TWISTS) if (!checkAgentMove(r, a, { kind: 'twist', twist })) out.push({ kind: 'twist', twist });
  } else for (let column = 0; column < 9; column++) if (!checkAgentMove(r, a, { kind: 'drop', column })) out.push({ kind: 'drop', column });
  return out;
}

function finish(w: W): { round: AgentRound; agents: AgentsState; events: GameEvent[] } {
  return { round: w.r, agents: w.a, events: w.ev };
}

export function applyAgentMove(r: AgentRound, a: AgentsState, move: AgentMove): { round: AgentRound; agents: AgentsState; events: GameEvent[] } {
  const why = checkAgentMove(r, a, move);
  if (why) throw new IllegalMove(why);
  if (move.kind === 'ability') return applyAbility(r, a, move);
  const w = working(r, a);
  const p = w.r.turn;
  let mark = -1;
  // After a power that moves, wipes or seals paint, your move's paint is wet too: the
  // power can't open a line for a same-turn win.
  const wetMove = !!w.a.used && WETS_MOVE.has(w.a.used);
  if (move.kind === 'pass') {
    w.r.turns++;
    w.ev.push({ type: 'passed', player: p });
    if (w.r.mode === 'rotating') {
      w.r.twistedLast[p] = false;
      w.r.lastTwist = null;
    }
    if (w.a.reverb) reverb(w, p, -1);
  } else if (w.r.mode === 'rotating') {
    const rr = w.r;
    if (move.kind === 'place') {
      paint(w, move.cell, p, wetMove);
      mark = move.cell;
    } else if (move.kind === 'twist') doTwist(w, move.twist, p, wetMove);
    rr.turns++;
    rr.twistedLast[p] = move.kind === 'twist';
    if (move.kind !== 'twist') rr.lastTwist = null;
    if (w.a.reverb) reverb(w, p, mark >= 0 ? mark : (rr.marks[p].at(-1) ?? -1));
    checkWin(w, p);
    if (!rr.result && rr.turns >= DRAW_TURNS) {
      rr.result = { winner: null };
      w.ev.push({ type: 'roundOver', winner: null });
    }
  } else {
    const col = (move as CascadeMove).column;
    const cell = landing(w.r.cells, col);
    paint(w, cell, p, wetMove, col);
    w.r.turns++;
    resolve(w, p);
    if (w.a.reverb && !w.r.result) reverb(w, p, cell);
  }
  if (!w.r.result && w.r.mode === 'cascade' && w.r.turns >= CASCADE_DRAW_TURNS) {
    (w.r as CascadeState).result = { winner: null };
    w.ev.push({ type: 'roundOver', winner: null });
  }
  endTurn(w, p);
  return finish(w);
}

/** Reverb: after the move, paint the cell straight through the Core from your last mark. */
function reverb(w: W, p: Player, from: number): void {
  w.a.reverb = false;
  if (from < 0) return void w.ev.push({ type: 'fizzled', id: 'reverb', player: p });
  if (w.r.mode === 'rotating') {
    const to = CELLS - 1 - from;
    if (to === CENTER || w.r.cells[to] !== null || taped(w, to)) return void w.ev.push({ type: 'fizzled', id: 'reverb', player: p });
    paint(w, to, p, true);
    checkWin(w, p);
    return;
  }
  const col = 8 - (from % 9);
  const cell = landing(w.r.cells, col);
  if (cell < 0 || taped(w, cell)) return void w.ev.push({ type: 'fizzled', id: 'reverb', player: p });
  paint(w, cell, p, true, col);
  resolve(w, p);
}

// ---------------------------------------------------------------------------------
// Abilities.

const neighbours = (c: number): number[] => {
  const [x, y, z] = coord(c);
  const out: number[] = [];
  for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
    const nx = x + dx;
    const ny = y + dy;
    const nz = z + dz;
    if (nx >= 0 && nx < 3 && ny >= 0 && ny < 3 && nz >= 0 && nz < 3) out.push(index(nx, ny, nz));
  }
  return out;
};
const NEIGHBOURS: readonly number[][] = Array.from({ length: CELLS }, (_, c) => neighbours(c));
const columnOf = (c: number) => c % 9;
const topOf = (cells: readonly Cell[], col: number): number => {
  const cs = COLUMNS[col];
  for (let k = 2; k >= 0; k--) if (cells[cs[k]] !== null) return cs[k];
  return -1;
};
/** The line through two distinct cells, if any. */
export function lineThrough(a: number, b: number): number {
  return LINES.findIndex((l) => l.includes(a) && l.includes(b));
}

/** Why `id` can't be used at all right now (before choosing targets), or null. */
export function abilityBlocked(r: AgentRound, a: AgentsState, id: AbilityId): IllegalReason | null {
  if (r.result) return 'round-over';
  const p = r.turn;
  const agent = a.picks[p];
  const t = tuning(r.mode);
  if (!abilitiesOf(agent).includes(id)) return 'not-your-power';
  if (a.used) return 'power-used';
  const w = { r, a, ev: [], t } as W;
  if (lockedDown(w, p)) return 'locked-down';
  if (isUlt(id)) {
    if (a.ult[p] < ultCostOf(t, agent)) return 'ult-not-ready';
  } else if (a.cd[p][slotOf(agent, id)] > 0) return 'cooldown';
  if (!abilityUses(r, a, id, true).length) return 'no-target';
  return null;
}

/** Every legal use of `id` for the player to move (cells/twists fully chosen). */
export function abilityUses(r: AgentRound, a: AgentsState, id: AbilityId, any = false): AbilityUse[] {
  const p = r.turn;
  const o = other(p);
  const w = { r, a, ev: [], t: tuning(r.mode) } as W;
  const cells = r.cells;
  const out: AbilityUse[] = [];
  const add = (u: Omit<AbilityUse, 'kind' | 'id'>) => out.push({ kind: 'ability', id, ...u });
  const rot = r.mode === 'rotating';
  const empties = () => {
    const e: number[] = [];
    for (let c = 0; c < CELLS; c++) if (c !== CENTER && cells[c] === null && !taped(w, c)) e.push(c);
    return e;
  };
  /** Cascade: one representative cell (the landing cell) per open column. */
  const openColumns = () => {
    const e: number[] = [];
    for (let col = 0; col < 9; col++) {
      const l = landing(cells, col);
      if (l >= 0 && !taped(w, l)) e.push(l);
    }
    return e;
  };
  switch (id) {
    case 'doubleTap':
      for (const c of rot ? empties() : openColumns()) add({ cells: [c] });
      break;
    case 'shove':
      for (let c = 0; c < CELLS; c++) {
        if (cells[c] !== o || shielded(w, c)) continue;
        if (rot) {
          for (const n of NEIGHBOURS[c]) if (n !== CENTER && cells[n] === null && !taped(w, n)) add({ cells: [c, n] });
        } else {
          const col = columnOf(c);
          if (topOf(cells, col) !== c) continue;
          const [x, y] = coord(c);
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || nx > 2 || ny < 0 || ny > 2) continue;
            const l = landing(cells, nx + 3 * ny);
            if (l >= 0 && !taped(w, l)) add({ cells: [c, l] });
          }
        }
      }
      break;
    case 'overspray':
      for (let c = 0; c < CELLS; c++) if (cells[c] === o && !shielded(w, c)) add({ cells: [c] });
      break;
    case 'tape':
      if (rot) for (const c of empties()) add({ cells: [c] });
      else for (const c of openColumns()) add({ cells: [c] });
      break;
    case 'fixative':
      for (let c = 0; c < CELLS; c++) if (cells[c] === p && !sealed(w, c)) add({ cells: [c] });
      break;
    case 'wetFloor':
      for (let li = 0; li < LINES.length; li++) {
        const l = LINES[li];
        if (rot && l.includes(CENTER)) continue;
        if (l.some((c) => cells[c] === p)) continue;
        if (!l.some((c) => cells[c] === o)) continue;
        if (a.effects.some((e) => e.kind === 'floor' && e.line === li)) continue;
        add({ cells: [l[0], l[2]] });
      }
      break;
    case 'spin':
      for (const t of TWISTS) {
        if (rot && r.lastTwist && sameTwist(t, inverse(r.lastTwist))) continue;
        if (layerShielded(w, t) || layerSealed(w, t)) continue;
        // A spin that moves nothing is pointless: require at least one mark in the layer.
        let any2 = false;
        for (let c = 0; c < CELLS && !any2; c++) if (coord(c)[t.axis] === t.slice && cells[c] !== null && c !== CENTER) any2 = true;
        if (any2) add({ twists: [t] });
      }
      break;
    case 'swap':
      for (let c = 0; c < CELLS; c++) {
        if (cells[c] !== p || shielded(w, c)) continue;
        for (const n of NEIGHBOURS[c]) if (cells[n] === o && !shielded(w, n)) add({ cells: [c, n] });
      }
      break;
    case 'trap':
      for (let c = 0; c < CELLS; c++) if (c !== (rot ? CENTER : -1) && cells[c] === null && !taped(w, c) && !effectAt(w, 'trap', c)) add({ cells: [c] });
      break;
    case 'afterimage': {
      const l = a.lost[p];
      if (l === null) break;
      if (rot) {
        if (cells[l] === null && l !== CENTER && !taped(w, l)) add({ cells: [l] });
      } else {
        const land = landing(cells, columnOf(l));
        if (land >= 0 && !taped(w, land)) add({ cells: [land] });
      }
      break;
    }
    case 'delay':
    case 'reverb':
    case 'chrome':
    case 'lockdown':
      add({});
      break;
    case 'flip':
      if (rot) {
        for (const t1 of TWISTS) for (const t2 of TWISTS) add({ twists: [t1, t2] });
      } else if (cells.some((c) => c !== null)) add({});
      break;
    case 'rewind':
      if (a.prev && !a.prev.round.result) add({});
      break;
  }
  return any ? out.slice(0, 1) : out;
}

export function checkAbility(r: AgentRound, a: AgentsState, u: AbilityUse): IllegalReason | null {
  const why = abilityBlocked(r, a, u.id);
  if (why) return why;
  const key = JSON.stringify([u.cells ?? [], u.twists ?? []]);
  return abilityUses(r, a, u.id).some((v) => JSON.stringify([v.cells ?? [], v.twists ?? []]) === key) ? null : 'bad-target';
}

export function applyAbility(r: AgentRound, a: AgentsState, u: AbilityUse): { round: AgentRound; agents: AgentsState; events: GameEvent[] } {
  const why = checkAbility(r, a, u);
  if (why) throw new IllegalMove(why);
  const w = working(r, a);
  const p = w.r.turn;
  const o = other(p);
  const t = w.t;
  const cells = u.cells ?? [];
  const twists = u.twists ?? [];
  const agent = w.a.picks[p];
  w.a.used = u.id;
  if (isUlt(u.id)) w.a.ult[p] = 0;
  else w.a.cd[p][slotOf(agent, u.id)] = t.cooldown[u.id as PowerId];
  w.ev.push({ type: 'ability', player: p, agent, id: u.id, cells: cells.slice(), twists: twists.map((x) => ({ ...x })) });
  const rot = w.r.mode === 'rotating';
  switch (u.id) {
    case 'doubleTap':
      if (rot) paint(w, cells[0], p, true);
      else paint(w, cells[0], p, true, columnOf(cells[0]));
      afterAction(w, p);
      break;
    case 'shove': {
      const [from, to] = cells;
      moveMark(w, from, to);
      w.a.wet[to] = t.dryTurns;
      w.ev.push({ type: 'moved', moves: [{ from, to, player: o }] });
      afterAction(w, p);
      break;
    }
    case 'overspray':
      clearCell(w, cells[0]);
      w.ev.push({ type: 'wiped', player: o, cell: cells[0] });
      if (!rot) settle(w, 1, true);
      afterAction(w, p);
      break;
    case 'tape':
      if (rot) w.a.effects.push({ kind: 'tape', cell: cells[0], by: p, turns: t.tapeTurns });
      else for (const c of COLUMNS[columnOf(cells[0])]) if (w.r.cells[c] === null) w.a.effects.push({ kind: 'tape', cell: c, by: p, turns: t.tapeTurns });
      break;
    case 'fixative':
      w.a.effects.push({ kind: 'seal', cell: cells[0], by: p, turns: t.fixativeTurns });
      break;
    case 'wetFloor':
      w.a.effects.push({ kind: 'floor', line: lineThrough(cells[0], cells[1]), by: p, turns: t.wetFloorTurns });
      break;
    case 'spin':
      doTwist(w, twists[0], p, true);
      if (!rot) settle(w, 1, true);
      afterAction(w, p);
      break;
    case 'swap': {
      const [mine, theirs] = cells;
      const r0 = w.r;
      r0.cells[mine] = o;
      r0.cells[theirs] = p;
      const ch = w.a.chrome[mine];
      w.a.chrome[mine] = w.a.chrome[theirs];
      w.a.chrome[theirs] = ch;
      w.a.wet[mine] = w.a.wet[theirs] = t.dryTurns;
      if (r0.mode === 'rotating') {
        r0.marks[p] = r0.marks[p].map((c) => (c === mine ? theirs : c));
        r0.marks[o] = r0.marks[o].map((c) => (c === theirs ? mine : c));
      }
      w.ev.push({ type: 'moved', moves: [{ from: mine, to: theirs, player: p }, { from: theirs, to: mine, player: o }] });
      afterAction(w, p);
      break;
    }
    case 'trap':
      w.a.effects.push({ kind: 'trap', cell: cells[0], by: p, turns: t.trapTurns });
      break;
    case 'afterimage':
      w.a.lost[p] = null;
      if (rot) paint(w, cells[0], p, true);
      else paint(w, cells[0], p, true, columnOf(cells[0]));
      afterAction(w, p);
      break;
    case 'delay':
      w.a.delay[o] = true;
      break;
    case 'reverb':
      w.a.reverb = true;
      break;
    case 'chrome':
      w.a.chromeLeft[p] = t.chromeMarks;
      break;
    case 'lockdown':
      w.a.effects.push({ kind: 'lockdown', by: p, turns: t.lockdownTurns });
      break;
    case 'flip':
      if (rot) {
        // Two twists at once, ignoring the twist rules; not wet.
        for (const tw of twists) doTwist(w, tw, p, false);
        checkWin(w, p);
      } else {
        const perm = Array.from({ length: CELLS }, (_, c) => {
          const [x, y, z] = coord(c);
          return index(x, y, 2 - z);
        });
        const moves = w.r.cells.flatMap((c, from) => (c !== null && perm[from] !== from ? [{ from, to: perm[from], player: c }] : []));
        permute(w, perm, true);
        w.ev.push({ type: 'moved', moves, flip: true });
        settle(w, 1, false);
        resolve(w, p);
      }
      break;
    case 'rewind':
      rewind(w, p);
      break;
  }
  return finish(w);
}

function moveMark(w: W, from: number, to: number): void {
  const r = w.r;
  const owner = r.cells[from]!;
  r.cells[to] = owner;
  r.cells[from] = null;
  w.a.wet[to] = w.a.wet[from];
  w.a.chrome[to] = w.a.chrome[from];
  w.a.wet[from] = 0;
  w.a.chrome[from] = false;
  if (r.mode === 'rotating') r.marks[owner] = r.marks[owner].map((c) => (c === from ? to : c));
}

/** Rewind: the board and effects go back to the start of the opponent's last turn. */
function rewind(w: W, p: Player): void {
  const s = w.a.prev!;
  const o = other(p);
  const round = copyRound(s.round);
  round.turn = p;
  w.r = round;
  w.a.wet = s.wet.slice();
  w.a.chrome = s.chrome.slice();
  w.a.effects = copyEffects(s.effects);
  w.a.delay = [s.delay[0], s.delay[1]];
  w.a.chromeLeft = [s.chromeLeft[0], s.chromeLeft[1]];
  w.a.lost = [s.lost[0], s.lost[1]];
  // Their power use is undone too: their timers go back; ours stay as they are now.
  w.a.cd[o] = s.cd[o].slice();
  w.a.ult[o] = s.ult[o];
  w.a.prev = null;
  w.ev.push({ type: 'rewound', cells: round.cells.slice() });
  // Our paint is dry by now; lines that count win as usual.
  dry(w, p);
  w.a.delay[p] = false;
  afterAction(w, p);
}

// ---------------------------------------------------------------------------------
// Rounds.

export function newAgentRound(mode: AgentMode, starter: Player, a: AgentsState): { round: AgentRound; agents: AgentsState } {
  const round = mode === 'rotating' ? newRotating(starter) : newCascade(starter);
  return { round, agents: resetAgentsForRound(a, round) };
}

/** What the HUD shows for a player's ability bar. */
export interface AbilityStatus {
  id: AbilityId;
  ult: boolean;
  /** Turns left on the cooldown (powers). */
  cooldown: number;
  /** Pips (ultimate). */
  pips: number;
  cost: number;
  blocked: IllegalReason | null;
}

export function abilityStatus(r: AgentRound, a: AgentsState, p: Player): AbilityStatus[] {
  const agent = a.picks[p];
  const t = tuning(r.mode);
  return abilitiesOf(agent).map((id, i) => ({
    id,
    ult: i === 3,
    cooldown: i < 3 ? a.cd[p][i] : 0,
    pips: a.ult[p],
    cost: ultCostOf(t, agent),
    blocked: r.turn === p ? abilityBlocked(r, a, id) : 'not-your-turn',
  }));
}

/** What the board draws on top of the paint: wet drips, chrome, cracks, tape, traps, seals, wet-floor lines. */
export interface Decor {
  wet: number[];
  chrome: number[];
  cracking: number[];
  tape: number[];
  trap: { cell: number; by: Player }[];
  seal: number[];
  floor: { line: Line; by: Player }[];
}

export function decorOf(r: AgentRound, a: AgentsState): Decor {
  const idx = (f: (c: number) => boolean) => Array.from({ length: CELLS }, (_, c) => c).filter(f);
  return {
    wet: idx((c) => a.wet[c] > 0 && r.cells[c] !== null),
    chrome: idx((c) => a.chrome[c] && r.cells[c] !== null),
    cracking: r.mode === 'rotating' ? ([0, 1] as const).map((p) => nextToFade(r, a, p)).filter((c) => c >= 0) : [],
    tape: a.effects.flatMap((e) => (e.kind === 'tape' ? [e.cell] : [])),
    trap: a.effects.flatMap((e) => (e.kind === 'trap' ? [{ cell: e.cell, by: e.by }] : [])),
    seal: a.effects.flatMap((e) => (e.kind === 'seal' ? [e.cell] : [])),
    floor: a.effects.flatMap((e) => (e.kind === 'floor' ? [{ line: LINES[e.line], by: e.by }] : [])),
  };
}
