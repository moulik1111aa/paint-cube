// A match: best of 3 rounds in one mode. The starting player alternates every round
// (drawn rounds included), and a drawn round counts for nobody and is replayed.

import { other, type Player } from './geometry.ts';
import { IllegalMove, type GameEvent, type IllegalReason } from './events.ts';
import { applyRotating, checkRotating, legalRotating, newRotating, type RotatingMove, type RotatingState } from './rotating.ts';
import { applyCascade, checkCascade, legalCascade, newCascade, type CascadeMove, type CascadeState } from './cascade.ts';
import { pick } from './rng.ts';
import {
  agentTurnMoves, applyAgentMove, checkAgentMove, newAgentRound, newAgents, resetAgentsForRound, tuning, ultCostOf,
  type AbilityUse, type AgentId, type AgentsState, type PassMove,
} from './agents.ts';

export type Mode = 'rotating' | 'cascade';
export type Round = RotatingState | CascadeState;
/** A normal move; in Agents mode also an ability use, or a pass when nothing else is legal. */
export type Move = RotatingMove | CascadeMove | AbilityUse | PassMove;

export const WINS_NEEDED = 2;

export interface MatchState {
  mode: Mode;
  round: Round;
  /** 1-based; every round counts, draws included. */
  roundNumber: number;
  /** Who started the current round. */
  starter: Player;
  wins: [number, number];
  /** The match winner, once someone reaches 2 round wins. */
  winner: Player | null;
  /** Agents mode (absent in Classic). */
  agents?: AgentsState;
}

const freshRound = (mode: Mode, starter: Player): Round => (mode === 'rotating' ? newRotating(starter) : newCascade(starter));

/** A new match; pass `picks` for Agents mode (`simple` for the Simple rules). */
export function newMatch(mode: Mode, starter: Player = 0, picks?: [AgentId, AgentId], simple = false): MatchState {
  const m: MatchState = { mode, round: freshRound(mode, starter), roundNumber: 1, starter, wins: [0, 0], winner: null };
  if (picks) m.agents = resetAgentsForRound(newAgents(picks, simple), m.round);
  return m;
}

export function checkMove(m: MatchState, move: Move): IllegalReason | null {
  if (m.winner !== null) return 'match-over';
  if (m.agents) return checkAgentMove(m.round, m.agents, move);
  if (move.kind === 'ability' || move.kind === 'pass') return 'no-agents';
  if (m.round.mode === 'rotating') return move.kind === 'drop' ? 'wrong-mode' : checkRotating(m.round, move);
  return move.kind !== 'drop' ? 'wrong-mode' : checkCascade(m.round, move);
}

/** Legal normal moves (abilities are listed by agents.ts). */
export function legalMoves(m: MatchState): Move[] {
  if (m.winner !== null) return [];
  if (m.agents) return agentTurnMoves(m.round, m.agents);
  return m.round.mode === 'rotating' ? legalRotating(m.round) : legalCascade(m.round);
}

/** A random legal move (for the online turn timer). */
export function randomMove(m: MatchState, random: () => number): Move {
  return pick(legalMoves(m), random);
}

export function applyMove(m: MatchState, move: Move): { state: MatchState; events: GameEvent[] } {
  const why = checkMove(m, move);
  if (why) throw new IllegalMove(why);
  let state: MatchState;
  let events: GameEvent[];
  if (m.agents) {
    const out = applyAgentMove(m.round, m.agents, move);
    state = { ...m, round: out.round, agents: out.agents, wins: [m.wins[0], m.wins[1]] };
    events = out.events;
    // Losing a Twist round charges the ultimate (Cascade charges per line scored against you).
    const res = out.round.result;
    if (res && res.winner !== null && out.round.mode === 'rotating') {
      const t = tuning('rotating', state.agents!.simple);
      const o = other(res.winner);
      state.agents!.ult[o] = Math.min(ultCostOf(t, state.agents!.picks[o]), state.agents!.ult[o] + t.ultBonus);
    }
  } else {
    const out = m.round.mode === 'rotating' ? applyRotating(m.round, move as RotatingMove) : applyCascade(m.round, move as CascadeMove);
    state = { ...m, round: out.state, wins: [m.wins[0], m.wins[1]] };
    events = out.events.slice();
  }
  const result = state.round.result;
  if (result) {
    if (result.winner !== null) state.wins[result.winner]++;
    events.push({ type: 'roundWon', winner: result.winner, round: m.roundNumber, wins: [state.wins[0], state.wins[1]] });
    if (result.winner !== null && state.wins[result.winner] >= WINS_NEEDED) {
      state.winner = result.winner;
      events.push({ type: 'matchWon', winner: result.winner, wins: [state.wins[0], state.wins[1]] });
    }
  }
  return { state, events };
}

/** Start the next round, with the other player starting. */
export function nextRound(m: MatchState): MatchState {
  if (m.winner !== null) throw new IllegalMove('match-over');
  if (!m.round.result) throw new Error('the current round is still being played');
  const starter = other(m.starter);
  if (m.agents) {
    const { round, agents } = newAgentRound(m.mode, starter, m.agents);
    return { ...m, round, agents, roundNumber: m.roundNumber + 1, starter };
  }
  return { ...m, round: freshRound(m.mode, starter), roundNumber: m.roundNumber + 1, starter };
}
