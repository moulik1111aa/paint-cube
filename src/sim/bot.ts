// A simple bot for balance testing (not shipped in the app). It looks one move ahead:
// it takes a win when it has one, avoids moves that hand the opponent an immediate
// win, and otherwise prefers positions with more open threats. Seeded noise keeps
// games varied but reproducible.

import { CELLS, CENTER, LINES, other, type Cell, type Player } from '../core/geometry.ts';
import { MAX_MARKS, applyRotating, legalRotating, type RotatingMove, type RotatingState } from '../core/rotating.ts';
import { applyCascade, legalCascade, newCascade, type CascadeMove, type CascadeState } from '../core/cascade.ts';
import { newRotating } from '../core/rotating.ts';
import { TWISTS, applyTwist, inverse, permutation, sameTwist, type Twist } from '../core/twist.ts';
import { rng } from '../core/rng.ts';

const WIN = 1e6;

function hasLine(cells: readonly Cell[], p: Player): boolean {
  return LINES.some(([a, b, c]) => cells[a] === p && cells[b] === p && cells[c] === p);
}

/** Can `q` (to move) win on this turn? Placement (respecting fading) or twist. */
export function canWinNext(s: RotatingState, q: Player): boolean {
  const fade = s.marks[q].length >= MAX_MARKS ? s.marks[q][0] : -1;
  for (const line of LINES) {
    let mine = 0;
    let empty = -1;
    for (const c of line) {
      if (s.cells[c] === q) mine++;
      else if (s.cells[c] === null) empty = c;
    }
    if (mine === 2 && empty >= 0 && empty !== CENTER && !line.includes(fade)) return true;
  }
  if (!s.twistedLast[q]) {
    for (const t of TWISTS) {
      if (s.lastTwist && sameTwist(t, inverse(s.lastTwist))) continue;
      if (hasLine(applyTwist(s.cells, t), q)) return true;
    }
  }
  return false;
}

/** Threat score of a rotating position for `p`. Lines through a mark about to fade count less. */
function rotatingHeuristic(s: RotatingState, p: Player): number {
  const o = other(p);
  const fadeP = s.marks[p].length >= MAX_MARKS ? s.marks[p][0] : -1;
  const fadeO = s.marks[o].length >= MAX_MARKS ? s.marks[o][0] : -1;
  const my2 = new Set<number>();
  const op2 = new Set<number>();
  let score = 0;
  for (const line of LINES) {
    let a = 0;
    let b = 0;
    let empty = -1;
    for (const c of line) {
      if (s.cells[c] === p) a++;
      else if (s.cells[c] === o) b++;
      else empty = c;
    }
    if (a && b) continue;
    if (a) {
      const n = a - (line.includes(fadeP) ? 1 : 0);
      if (n >= 2 && empty !== CENTER) my2.add(empty);
      else score += n;
    } else if (b) {
      const n = b - (line.includes(fadeO) ? 1 : 0);
      if (n >= 2 && empty !== CENTER) op2.add(empty);
      else score -= n;
    }
  }
  score += 5 * my2.size - 5 * op2.size;
  if (my2.size >= 2) score += 15;
  return score;
}

export function rotatingBotMove(s: RotatingState, random: () => number, noise = 0.4): RotatingMove {
  const p = s.turn;
  let best: RotatingMove | null = null;
  let bestV = -Infinity;
  for (const m of legalRotating(s)) {
    const n = applyRotating(s, m).state;
    let v: number;
    if (n.result) v = n.result.winner === p ? WIN : n.result.winner === null ? 0 : -WIN;
    else v = rotatingHeuristic(n, p) - (canWinNext(n, other(p)) ? 5000 : 0);
    if (v >= WIN) return m;
    v += gauss(random) * noise;
    if (v > bestV) {
      bestV = v;
      best = m;
    }
  }
  return best!;
}

function cascadeThreats(cells: readonly Cell[], p: Player): number {
  let v = 0;
  for (const line of LINES) {
    let a = 0;
    let b = 0;
    for (const c of line) {
      if (cells[c] === p) a++;
      else if (cells[c] !== null) b++;
    }
    if (a === 2 && !b) v += 2;
    if (b === 2 && !a) v -= 2;
  }
  return v;
}

export function cascadeBotMove(s: CascadeState, random: () => number, noise = 0.4): CascadeMove {
  const p = s.turn;
  const o = other(p);
  let best: CascadeMove | null = null;
  let bestV = -Infinity;
  for (const m of legalCascade(s)) {
    const n = applyCascade(s, m).state;
    let v: number;
    if (n.result) v = n.result.winner === p ? WIN : -WIN;
    else {
      v = 10 * (n.scores[p] - n.scores[o]) + cascadeThreats(n.cells, p);
      let reply = 0;
      for (const r of legalCascade(n)) {
        const k = applyCascade(n, r).state;
        if (k.result?.winner === o) {
          reply = 500;
          break;
        }
        reply = Math.max(reply, k.scores[o] - n.scores[o] - (k.scores[p] - n.scores[p]));
      }
      v -= 10 * reply;
    }
    if (v >= WIN) return m;
    v += gauss(random) * noise;
    if (v > bestV) {
      bestV = v;
      best = m;
    }
  }
  return best!;
}

function gauss(random: () => number): number {
  return Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
}

export interface RoundStats {
  games: number;
  firstWins: number;
  secondWins: number;
  draws: number;
  /** Median turns per round. */
  medianTurns: number;
}

/** Play `games` bot-vs-bot rounds of a mode, alternating who starts; seeded. */
export function simulate(mode: 'rotating' | 'cascade', games: number, seed = 1, noise = 0.4): RoundStats {
  const random = rng(seed);
  const turns: number[] = [];
  let firstWins = 0;
  let secondWins = 0;
  let draws = 0;
  for (let g = 0; g < games; g++) {
    const first = (g % 2) as Player;
    let winner: Player | null;
    let played: number;
    if (mode === 'rotating') {
      let s = newRotating(first);
      while (!s.result) s = applyRotating(s, rotatingBotMove(s, random, noise)).state;
      winner = s.result.winner;
      played = s.turns;
    } else {
      let s = newCascade(first);
      while (!s.result) s = applyCascade(s, cascadeBotMove(s, random, noise)).state;
      winner = s.result.winner;
      played = s.turns;
    }
    turns.push(played);
    if (winner === null) draws++;
    else if (winner === first) firstWins++;
    else secondWins++;
  }
  turns.sort((a, b) => a - b);
  return { games, firstWins, secondWins, draws, medianTurns: turns[Math.floor(turns.length / 2)] };
}

// ---------------------------------------------------------------------------------
// Agents mode. The same one-move lookahead and fade-aware threat logic, taught the
// agent rules (wet paint, tape, traps, seals, wet floor, lockdown, delay, chrome), and
// a power search: each available power is tried on a sample of its targets, the most
// promising few are searched with every follow-up move, and the bot uses one when it
// beats its best plain move. The ultimate fires when it creates or blocks a threat,
// or now and then at random. Seeded noise makes the play imperfect.

import {
  abilitiesOf, abilityBlocked, abilityUses, agentTurnMoves, applyAgentMove, isUlt, nextToFade,
  type AbilityUse, type AgentRound, type AgentsState, type AgentId, type AbilityId,
} from '../core/agents.ts';
import { applyMove, checkMove, newMatch, nextRound, type MatchState, type Move } from '../core/match.ts';

export interface AgentBotOptions {
  /** Gaussian noise on every evaluation (imperfect play). */
  noise: number;
  /** false: never use powers (the Classic-rules baseline). */
  usePowers: boolean;
  /** Chance to fire a ready ultimate even when it doesn't clearly help. */
  ultChance: number;
  /** Targets tried per power before the full search. */
  samples: number;
}
export const AGENT_BOT: AgentBotOptions = { noise: 0.3, usePowers: true, ultChance: 0.15, samples: 6 };

type S = { r: AgentRound; a: AgentsState };

const floored = (a: AgentsState, li: number, owner: Player) => a.effects.some((e) => e.kind === 'floor' && e.line === li && e.by !== owner);
const tapedAt = (a: AgentsState, c: number) => a.effects.some((e) => e.kind === 'tape' && e.cell === c);
const trapBy = (a: AgentsState, c: number): Player | null => {
  const e = a.effects.find((x) => x.kind === 'trap' && x.cell === c);
  return e ? e.by : null;
};
const locked = (a: AgentsState, p: Player) => a.effects.some((e) => e.kind === 'lockdown' && e.by !== p);
const layerHasSeal = (a: AgentsState, t: Twist) => a.effects.some((e) => e.kind === 'seal' && coordOf(e.cell)[t.axis] === t.slice);
const coordOf = (i: number): [number, number, number] => [i % 3, Math.floor(i / 3) % 3, Math.floor(i / 9)];
const LINES_NO_CORE = LINES.map((l, i) => [l, i] as const).filter(([l]) => !l.includes(CENTER));

/** For each twist: where each cell's contents come from, and the lines it can change. */
const TWIST_INFO = TWISTS.map((t) => {
  const perm = permutation(t);
  const from = Array<number>(CELLS);
  for (let i = 0; i < CELLS; i++) from[perm[i]] = i;
  const moving = new Set(Array.from({ length: CELLS }, (_, i) => i).filter((i) => perm[i] !== i));
  const lines = LINES_NO_CORE.filter(([l]) => l.some((c) => moving.has(c)));
  return { t, from, lines };
});

/** Twist: can `q` (to move, upkeep done) complete a counting line with a normal move? */
function agentCanWinNext(r: RotatingState, a: AgentsState, q: Player): boolean {
  const cells = r.cells;
  let count = 0;
  for (let c = 0; c < CELLS; c++) if (cells[c] === q) count++;
  if (count < 2) return false;
  const floor = new Set<number>();
  for (const e of a.effects) if (e.kind === 'floor' && e.by !== q) floor.add(e.line);
  if (!a.delay[q]) {
    const fade = nextToFade(r, a, q);
    for (const [line, li] of LINES_NO_CORE) {
      let mine = 0;
      let empty = -1;
      for (const c of line) {
        if (cells[c] === q) mine++;
        else if (cells[c] === null) empty = c;
      }
      if (mine !== 2 || empty < 0 || line.includes(fade) || floor.has(li) || tapedAt(a, empty)) continue;
      const t = trapBy(a, empty);
      if (t !== null && t !== q) continue;
      return true;
    }
  }
  if (count >= 3 && !r.twistedLast[q] && !locked(a, q)) {
    for (const { t, from, lines } of TWIST_INFO) {
      if (r.lastTwist && sameTwist(t, inverse(r.lastTwist))) continue;
      if (a.effects.length && layerHasSeal(a, t)) continue;
      for (const [line, li] of lines) {
        if (cells[from[line[0]]] === q && cells[from[line[1]]] === q && cells[from[line[2]]] === q && !floor.has(li)) return true;
      }
    }
  }
  return false;
}

/** Twist position value for `p` (it is the other player's turn). */
function agentRotatingValue(r: RotatingState, a: AgentsState, p: Player): number {
  const o = other(p);
  const fadeP = nextToFade(r, a, p);
  const fadeO = nextToFade(r, a, o);
  // Effects looked up once: floors against each player, tape, traps.
  const floorVs: [Set<number>, Set<number>] = [new Set(), new Set()];
  const tape = new Set<number>();
  const trap = new Map<number, Player>();
  for (const e of a.effects) {
    if (e.kind === 'floor') floorVs[other(e.by)].add(e.line);
    else if (e.kind === 'tape') tape.add(e.cell);
    else if (e.kind === 'trap') trap.set(e.cell, e.by);
  }
  const my2 = new Set<number>();
  const op2 = new Set<number>();
  let score = 0;
  const cells = r.cells;
  for (const [line, li] of LINES_NO_CORE) {
    let x = 0;
    let y = 0;
    let empty = -1;
    for (const c of line) {
      const v = cells[c];
      if (v === p) x++;
      else if (v === o) y++;
      else empty = c;
    }
    if (x && y) continue;
    if (x === 3) {
      // A full line of ours that doesn't count yet (wet paint or wet floor).
      score += floorVs[p].has(li) ? 30 : 2500;
      continue;
    }
    if (y === 3) {
      score -= floorVs[o].has(li) ? 30 : 2500;
      continue;
    }
    const open = empty >= 0 && !tape.has(empty);
    if (x) {
      const n = x - (line[0] === fadeP || line[1] === fadeP || line[2] === fadeP ? 1 : 0);
      if (n >= 2 && open && trap.get(empty) !== o && !floorVs[p].has(li)) my2.add(empty);
      else score += n;
    } else if (y) {
      const n = y - (line[0] === fadeO || line[1] === fadeO || line[2] === fadeO ? 1 : 0);
      if (n >= 2 && open && trap.get(empty) !== p && !floorVs[o].has(li)) op2.add(empty);
      else score -= n;
    }
  }
  score += 5 * my2.size - 5 * op2.size;
  if (my2.size >= 2) score += 15;
  // Chrome marks still to come are worth a little.
  score += 1.5 * a.chromeLeft[p] - 1.5 * a.chromeLeft[o];
  return score - (agentCanWinNext(r, a, o) ? 5000 : 0);
}

function agentCascadeThreats(r: CascadeState, a: AgentsState, p: Player): number {
  let v = 0;
  const o = other(p);
  for (let li = 0; li < LINES.length; li++) {
    const line = LINES[li];
    let x = 0;
    let y = 0;
    for (const c of line) {
      if (r.cells[c] === p) x++;
      else if (r.cells[c] === o) y++;
    }
    // A full line that hasn't burst yet (wet paint, wet floor or lockdown): worth less
    // the longer it has to survive.
    if (x === 3 || y === 3) {
      let wet = 0;
      for (const c of line) wet = Math.max(wet, a.wet[c]);
      const worth = Math.max(2, 8 - 3 * wet);
      v += x === 3 ? worth : -worth;
    }
    else if (x === 2 && !y && !floored(a, li, p)) v += 2;
    else if (y === 2 && !x && !floored(a, li, o)) v -= 2;
  }
  // Wet cubes are out of play for a while: a small cost for ours, a small gain for theirs.
  for (let c = 0; c < CELLS; c++) {
    if (!a.wet[c]) continue;
    if (r.cells[c] === p) v -= 0.6 * a.wet[c];
    else if (r.cells[c] === o) v += 0.6 * a.wet[c];
  }
  return v + 2 * a.chromeLeft[p] - 2 * a.chromeLeft[o];
}

/** Value for `p` after their turn ended (it's the opponent's turn, upkeep done). */
function agentValue(s: S, p: Player, deep: boolean): number {
  const r = s.r;
  if (r.result) return r.result.winner === p ? WIN : r.result.winner === null ? 0 : -WIN;
  if (r.mode === 'rotating') return agentRotatingValue(r, s.a, p);
  const o = other(p);
  let v = 10 * (r.scores[p] - r.scores[o]) + agentCascadeThreats(r, s.a, p);
  if (deep) {
    let reply = 0;
    for (const mv of agentTurnMoves(r, s.a)) {
      const k = applyAgentMove(r, s.a, mv).round as CascadeState;
      if (k.result?.winner === o) {
        reply = 500;
        break;
      }
      reply = Math.max(reply, k.scores[o] - r.scores[o] - (k.scores[p] - r.scores[p]));
    }
    v -= 10 * reply;
  }
  return v;
}

/** Best normal move from `s` for the player to move. */
function bestAgentMove(s: S, random: () => number, noise: number, deep: boolean): { move: Move; value: number } {
  const p = s.r.turn;
  let best: Move | null = null;
  let bestV = -Infinity;
  for (const m of agentTurnMoves(s.r, s.a)) {
    const out = applyAgentMove(s.r, s.a, m);
    let v = agentValue({ r: out.round, a: out.agents }, p, deep);
    if (v >= WIN) return { move: m, value: v };
    v += gauss(random) * noise;
    if (v > bestV) {
      bestV = v;
      best = m;
    }
  }
  return { move: best!, value: bestV };
}

function shuffleTake<T>(items: T[], n: number, random: () => number): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

/** One whole turn for the player to move: an optional ability, then the move. */
export function agentBotTurn(m: MatchState, random: () => number, opt: AgentBotOptions = AGENT_BOT): Move[] {
  const s: S = { r: m.round, a: m.agents! };
  const p = s.r.turn;
  const deep = s.r.mode === 'cascade';
  const plain = bestAgentMove(s, random, opt.noise, deep);
  if (!opt.usePowers) return [plain.move];
  // Score each sampled ability use cheaply (best follow-up without the reply search).
  const cands: { use: AbilityUse; s1: S; quick: number }[] = [];
  for (const id of abilitiesOf(s.a.picks[p])) {
    if (abilityBlocked(s.r, s.a, id)) continue;
    const uses = abilityUses(s.r, s.a, id);
    const n = isUlt(id) && s.r.mode === 'rotating' && id === 'flip' ? opt.samples * 4 : opt.samples;
    for (const use of shuffleTake(uses, n, random)) {
      const out = applyAgentMove(s.r, s.a, use);
      const s1 = { r: out.round, a: out.agents };
      if (s1.r.result) {
        const v = s1.r.result.winner === p ? WIN : s1.r.result.winner === null ? 0 : -WIN;
        if (v >= WIN) return [use];
        continue;
      }
      // Cheap first pass: how good is the position the power leaves (before our move)?
      cands.push({ use, s1, quick: agentValue(s1, p, false) + gauss(random) * opt.noise });
    }
  }
  if (!cands.length) return [plain.move];
  cands.sort((x, y) => y.quick - x.quick);
  let pickUse: AbilityUse | null = null;
  let pickMove = plain.move;
  let pickV = plain.value;
  for (const c of cands.slice(0, 2)) {
    const b = bestAgentMove(c.s1, random, opt.noise, deep);
    const ult = isUlt(c.use.id);
    // Powers cost their cooldown: use one when it beats the plain move. An ultimate
    // fires when it clearly helps (makes or blocks a threat), or now and then anyway.
    const margin = ult ? 3 : 0.5;
    const v = b.value;
    if (v > pickV + margin || (ult && v > pickV - 2 && random() < opt.ultChance)) {
      pickUse = c.use;
      pickV = v;
      pickMove = b.move;
    }
  }
  return pickUse ? [pickUse, pickMove] : [plain.move];
}

export interface AgentMatchStats {
  winner: Player;
  /** Decisive rounds won by the round's starter. */
  starterRoundWins: number;
  decisiveRounds: number;
  drawnRounds: number;
  roundTurns: number[];
  /** Per player: abilities used in each round (sets), and on the round-winning player's turns. */
  roundsUsing: [Map<AbilityId, number>, Map<AbilityId, number>];
  rounds: number;
  /** Per player: winning turns (the turn that ended a round they won), by ability used that turn ('-' none). */
  winningTurns: [Map<string, number>, Map<string, number>];
}

/** Play one whole Agents match between two bots; every action is checked legal first. */
export function agentBotMatch(
  mode: 'rotating' | 'cascade',
  picks: [AgentId, AgentId],
  random: () => number,
  opts: [AgentBotOptions, AgentBotOptions],
  starter: Player = 0,
): AgentMatchStats {
  let m = newMatch(mode, starter, picks);
  const st: AgentMatchStats = {
    winner: 0,
    starterRoundWins: 0,
    decisiveRounds: 0,
    drawnRounds: 0,
    roundTurns: [],
    roundsUsing: [new Map(), new Map()],
    rounds: 0,
    winningTurns: [new Map(), new Map()],
  };
  let used: [Set<AbilityId>, Set<AbilityId>] = [new Set(), new Set()];
  const lastUsed: [AbilityId | null, AbilityId | null] = [null, null];
  let guard = 0;
  while (m.winner === null) {
    if (m.round.result) {
      m = nextRound(m);
      used = [new Set(), new Set()];
      lastUsed[0] = lastUsed[1] = null;
    }
    const p = m.round.turn;
    const actions = agentBotTurn(m, random, opts[p]);
    let usedNow: AbilityId | null = null;
    for (const a of actions) {
      const why = checkMove(m, a);
      if (why) throw new Error(`bot picked an illegal action (${why}): ${JSON.stringify(a)}`);
      if (a.kind === 'ability') {
        usedNow = a.id;
        used[p].add(a.id);
      }
      m = applyMove(m, a).state;
      if (m.round.result) break;
    }
    lastUsed[p] = usedNow;
    if (++guard > 5000) throw new Error('match did not finish');
    const res = m.round.result;
    if (res) {
      st.rounds++;
      st.roundTurns.push(m.round.turns);
      for (const q of [0, 1] as const) for (const id of used[q]) st.roundsUsing[q].set(id, (st.roundsUsing[q].get(id) ?? 0) + 1);
      if (res.winner === null) st.drawnRounds++;
      else {
        st.decisiveRounds++;
        if (res.winner === m.starter) st.starterRoundWins++;
        // The winning turn: this one, or (a wet line counted at the start of their
        // turn) the winner's previous turn.
        const w = res.winner;
        const k = (w === p ? usedNow : lastUsed[w]) ?? '-';
        st.winningTurns[w].set(k, (st.winningTurns[w].get(k) ?? 0) + 1);
      }
    }
  }
  st.winner = m.winner;
  return st;
}
