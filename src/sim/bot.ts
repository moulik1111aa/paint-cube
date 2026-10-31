// A simple bot for balance testing (not shipped in the app). It looks one move ahead:
// it takes a win when it has one, avoids moves that hand the opponent an immediate
// win, and otherwise prefers positions with more open threats. Seeded noise keeps
// games varied but reproducible.

import { CENTER, LINES, other, type Cell, type Player } from '../core/geometry.ts';
import { MAX_MARKS, applyRotating, legalRotating, type RotatingMove, type RotatingState } from '../core/rotating.ts';
import { applyCascade, legalCascade, newCascade, type CascadeMove, type CascadeState } from '../core/cascade.ts';
import { newRotating } from '../core/rotating.ts';
import { TWISTS, applyTwist, inverse, sameTwist } from '../core/twist.ts';
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
