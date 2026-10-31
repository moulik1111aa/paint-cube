// Show-me lessons: short scripted plays on the real cube, run by the real rules, with a
// line of narration per step (shown and read aloud). One per Agents idea (how powers
// work, wet paint, timers, the ultimate) and one per power. Twist lessons are written by
// hand; Cascade power lessons are set up from a fixed opening and pick a use that shows
// the power well.
//
// Pure data and rules here (no DOM), so test/lessons.test.ts can play every lesson
// through the engine and prove each step is legal.

import { AGENTS, AGENT_IDS, AGENT_TUNING, abilityUses, isUlt, slotOf, ultCostOf, type AbilityId, type AbilityUse, type AgentId } from '../core/agents.ts';
import { applyMove, checkMove, legalMoves, newMatch, type MatchState, type Mode, type Move } from '../core/match.ts';
import { coord, type Player } from '../core/geometry.ts';
import type { Twist } from '../core/twist.ts';
import type { GameEvent } from '../core/events.ts';
import { ABILITY_TEXT } from './agents-ui.ts';

export type Topic = 'powers' | 'wet' | 'timers' | 'ult';

export interface LessonStep {
  /** Narration: shown and read aloud. */
  say: string;
  /** Moves played in this step (in turn order). Powers are made ready first. */
  moves?: Move[];
  /** Cells to point at while the narration plays. */
  focus?: number[];
  /** Rebuild the board from scratch with these moves (played silently) before this step. */
  reset?: Move[];
  /** This step is allowed to end the round. */
  ends?: boolean;
}

export interface Lesson {
  key: string;
  title: string;
  mode: Mode;
  picks: [AgentId, AgentId];
  /** Played silently to reach the starting position. */
  setup: Move[];
  steps: LessonStep[];
  /** Keep powers' real timers (the timers lesson shows them counting down). */
  realTimers?: boolean;
}

const place = (cell: number): Move => ({ kind: 'place', cell });
const use = (id: AbilityId, cells?: number[], twists?: Twist[]): Move => ({ kind: 'ability', id, ...(cells ? { cells } : {}), ...(twists ? { twists } : {}) });
const twist = (axis: 0 | 1 | 2, slice: 0 | 1 | 2, dir: 1 | -1): Move => ({ kind: 'twist', twist: { axis, slice, dir } as Twist });

// The face toward the camera, top row first:  24 25 26 / 15 16 17 / 6 7 8
// Orange (player 1) is "Orange"; blue (player 2) is "Blue".

const TOPICS: Record<Topic, Lesson> = {
  powers: {
    key: 'powers',
    title: 'Using a power',
    mode: 'rotating',
    picks: ['blitz', 'stencil'],
    setup: [place(24), place(6)],
    steps: [
      { say: 'Orange is Blitz. Their powers sit in the bar at the bottom. On your turn you can use one power, then make your normal move.' },
      { say: 'Tap a power, and the cells you can use it on glow. Here Orange taps Double Tap, then a glowing cell: an extra mark lands.', moves: [use('doubleTap', [16])] },
      { say: 'Now the normal move, as always. Two marks in one turn!', moves: [place(8)] },
      { say: 'Blue is Stencil. Blue taps Tape and picks a cell: nobody can paint there for a few turns.', moves: [use('tape', [26]), place(7)], focus: [26] },
    ],
  },
  wet: {
    key: 'wet',
    title: 'Wet paint',
    mode: 'rotating',
    picks: ['blitz', 'stencil'],
    setup: [place(24), place(6)],
    steps: [
      { say: 'Wet paint. Orange has one mark in the top row.', focus: [24] },
      { say: 'Orange uses Double Tap. Paint from a power is wet: see it drip.', moves: [use('doubleTap', [25])], focus: [25] },
      { say: 'Orange finishes the row with the normal move. But a line with wet paint does not count yet.', moves: [place(26)], focus: [24, 25, 26] },
      { say: 'So Blue gets to answer. Blue twists the left layer, and the row breaks apart. Saved!', moves: [twist(0, 0, 1)] },
      {
        say: 'Again, but this time Blue plays somewhere else.',
        reset: [place(24), place(6), use('doubleTap', [25]), place(26)],
        moves: [place(0)],
        focus: [24, 25, 26],
      },
      { say: 'The paint dries at the start of Orange’s turns. Orange plays away from the row, so it stays whole.', moves: [twist(2, 0, 1)] },
      { say: 'Blue misses the last chance. The paint dries, the row counts, and Orange takes the round.', moves: [place(9)], ends: true },
    ],
  },
  timers: {
    key: 'timers',
    title: 'Timers',
    mode: 'rotating',
    picks: ['blitz', 'echo'],
    realTimers: true,
    setup: [place(24), place(6)],
    steps: [
      { say: 'Powers run on timers. Look at the bar: a number on a power is how many of your turns until it is back.' },
      { say: 'Orange uses Overspray to wipe Blue’s mark.', moves: [use('overspray', [6]), place(16)], focus: [6] },
      { say: 'Now Overspray shows a big number: it is cooling down. It counts down by one each of Orange’s turns.', moves: [place(7)] },
      { say: 'Every round starts fresh, and some powers only unlock a few turns into a round.', moves: [place(17), place(0)] },
    ],
  },
  ult: {
    key: 'ult',
    title: 'Ultimate',
    mode: 'rotating',
    picks: ['blitz', 'stencil'],
    setup: [place(24), place(6)],
    steps: [
      { say: 'The last button is the ultimate. Its ring fills by one every turn, and faster when you lose a round.' },
      { say: 'When the ring is full it says READY. Orange fires Chrome!', moves: [use('chrome')] },
      { say: 'Ultimates are never wet: they hit straight away. Orange’s next marks are chrome. They never fade, and no power can move or wipe them.', moves: [place(25)], focus: [25] },
    ],
  },
};

/** Twist lessons for each power, written by hand. Orange acts unless noted. */
const TWIST_POWERS: Record<AbilityId, Omit<Lesson, 'key' | 'title' | 'mode'>> = {
  doubleTap: {
    picks: ['blitz', 'stencil'],
    setup: [place(24), place(6)],
    steps: [
      { say: 'Double Tap: paint an extra cell first. It is wet, so it drips.', moves: [use('doubleTap', [25])], focus: [25] },
      { say: 'Then make your normal move. Two marks in one turn.', moves: [place(16)] },
    ],
  },
  shove: {
    picks: ['blitz', 'stencil'],
    setup: [place(24), place(25), place(26), place(6)],
    steps: [
      { say: 'Blue is blocking Orange’s top row.', focus: [25] },
      { say: 'Shove: tap an enemy mark, then the empty cell to push it into.', moves: [use('shove', [25, 16])], focus: [25, 16] },
      { say: 'Orange paints the gap. After a Shove your move is wet, so the row only counts if it survives Blue’s turn.', moves: [place(25)], focus: [24, 25, 26] },
    ],
  },
  overspray: {
    picks: ['blitz', 'stencil'],
    setup: [place(24), place(25), place(26), place(6)],
    steps: [
      { say: 'Blue is blocking Orange’s top row.', focus: [25] },
      { say: 'Overspray: tap an enemy mark to wipe it off the cube.', moves: [use('overspray', [25])], focus: [25] },
      { say: 'Orange paints the gap. After Overspray your move is wet, so Blue still gets a reply.', moves: [place(25)] },
    ],
  },
  chrome: {
    picks: ['blitz', 'stencil'],
    setup: [place(24), place(6), place(15), place(7)],
    steps: [
      { say: 'Chrome is Blitz’s ultimate.', moves: [use('chrome')] },
      { say: 'Orange’s next two marks come out chrome. They never fade, and no power can move or wipe them.', moves: [place(16)], focus: [16] },
    ],
  },
  tape: {
    picks: ['blitz', 'stencil'],
    setup: [place(24), place(6), place(25)],
    steps: [
      { say: 'Orange needs one more cell to finish the top row.', focus: [26] },
      { say: 'Blue is Stencil. Tape: tap an empty cell, and nobody can paint there for a few turns.', moves: [use('tape', [26]), place(16)], focus: [26] },
      { say: 'Orange can’t finish the row while the tape is up.', focus: [26] },
    ],
  },
  fixative: {
    picks: ['stencil', 'blitz'],
    setup: [place(24), place(6), place(25), place(7)],
    steps: [
      { say: 'Fixative: tap one of your marks to seal it.', moves: [use('fixative', [24])], focus: [24] },
      { say: 'A sealed mark can’t fade, be moved or wiped, and its layers can’t twist for a few turns. After Fixative your move is wet.', moves: [place(8)] },
    ],
  },
  wetFloor: {
    picks: ['blitz', 'stencil'],
    setup: [place(24), place(6), place(25)],
    steps: [
      { say: 'Orange needs one more cell for the top row.', focus: [26] },
      { say: 'Blue is Stencil. Wet Floor: pick a line, and it can’t count for Orange for 2 turns.', moves: [use('wetFloor', [24, 26]), place(16)], focus: [24, 25, 26] },
      { say: 'Orange finishes the row… and it doesn’t count. Slipped!', moves: [place(26)], focus: [24, 25, 26] },
    ],
  },
  lockdown: {
    picks: ['blitz', 'stencil'],
    setup: [place(24), place(6), place(25)],
    steps: [
      { say: 'Lockdown is Stencil’s ultimate.', moves: [use('lockdown'), place(26)] },
      { say: 'For the next few turns Orange can’t use powers or twist. Only plain painting.' },
    ],
  },
  spin: {
    picks: ['drift', 'stencil'],
    setup: [place(24), place(25), place(26), place(6)],
    steps: [
      { say: 'Blue is blocking Orange’s top row.', focus: [25] },
      { say: 'Spin: swipe a layer to give it an extra twist, even if you twisted last turn. Everything it moves is wet.', moves: [use('spin', undefined, [{ axis: 0, slice: 1, dir: 1 } as Twist])] },
      { say: 'Then the normal move, also wet this turn.', moves: [place(25)] },
    ],
  },
  swap: {
    picks: ['drift', 'stencil'],
    setup: [place(24), place(25), place(26), place(6), place(16), place(0)],
    steps: [
      { say: 'Blue blocks the top row, right next to Orange’s mark below it.', focus: [25, 16] },
      { say: 'Swap: tap your mark, then a touching enemy mark. They trade places, and both are wet.', moves: [use('swap', [16, 25])], focus: [16, 25] },
      { say: 'The row is complete, but wet: it only counts if it survives until it dries. Orange twists the bottom layer as the normal move.', moves: [twist(2, 0, 1)], focus: [24, 25, 26] },
    ],
  },
  trap: {
    picks: ['drift', 'stencil'],
    setup: [place(24), place(6)],
    steps: [
      { say: 'Paint Trap: mark an empty cell. Both players can see it.', moves: [use('trap', [7]), place(16)], focus: [7] },
      { say: 'If Blue paints the trap, the mark turns orange.', moves: [place(7)], focus: [7] },
    ],
  },
  flip: {
    picks: ['drift', 'stencil'],
    setup: [place(24), place(6), place(16), place(8)],
    steps: [
      { say: 'Flip is Drift’s ultimate: two twists at once, ignoring the twist rules. It isn’t wet, so it can win on the spot.', moves: [use('flip', undefined, [{ axis: 2, slice: 2, dir: 1 } as Twist, { axis: 0, slice: 0, dir: 1 } as Twist])] },
      { say: 'Then Orange makes the normal move.', moves: [place(26)] },
    ],
  },
  afterimage: {
    picks: ['echo', 'blitz'],
    setup: [place(24), use('overspray', [24]), place(6), place(25), place(7)],
    steps: [
      { say: 'Blue wiped Orange’s corner mark off the cube.', focus: [24] },
      { say: 'Afterimage brings back your most recently lost mark, if its cell is empty. It comes back wet.', moves: [use('afterimage', [24])], focus: [24] },
      { say: 'Then the normal move: Orange blocks Blue’s row.', moves: [place(8)] },
    ],
  },
  delay: {
    picks: ['echo', 'stencil'],
    setup: [place(24), place(6), place(15), place(7)],
    steps: [
      { say: 'Blue needs one more cell for the bottom row.', focus: [8] },
      { say: 'Delay: Blue’s next mark will be wet.', moves: [use('delay'), place(16)] },
      { say: 'Blue finishes the row… but it’s wet, so it doesn’t count yet. Orange gets an answer.', moves: [place(8)], focus: [6, 7, 8] },
    ],
  },
  reverb: {
    picks: ['echo', 'stencil'],
    setup: [place(16), place(0)],
    steps: [
      { say: 'Reverb: after your move, the cell straight through the Core from it gets painted too.', moves: [use('reverb')] },
      { say: 'Orange paints the front corner, and its echo lands on the far top corner, wet.', moves: [place(6)], focus: [6, 20] },
    ],
  },
  rewind: {
    picks: ['echo', 'stencil'],
    setup: [place(24), place(6), place(25), place(26)],
    steps: [
      { say: 'Blue just blocked Orange’s top row.', focus: [26] },
      { say: 'Rewind is Echo’s ultimate: it undoes Blue’s whole last turn.', moves: [use('rewind')], focus: [26] },
      { say: 'The gap is open again, and Orange takes the row. Ultimates aren’t wet, so it counts at once.', moves: [place(26)], ends: true },
    ],
  },
};

/** Cascade power lessons: a fixed opening, then the power and a drop. */
const CASCADE_OPENING: Move[] = [0, 4, 1, 5, 3, 7, 2, 8, 6, 4].map((column) => ({ kind: 'drop', column }) as Move);

export function topicLesson(t: Topic): Lesson {
  return TOPICS[t];
}

export function abilityLesson(id: AbilityId, mode: Mode): Lesson {
  const owner = AGENT_IDS.find((a) => (AGENTS[a].powers as readonly AbilityId[]).includes(id) || AGENTS[a].ult === id)!;
  const title = `${ABILITY_TEXT[id].name}${isUlt(id) ? ' · ultimate' : ''}`;
  if (mode === 'rotating') return { key: `${id}:rotating`, title, mode, ...TWIST_POWERS[id] };
  // Cascade: the owner moves next after the opening.
  const opp: AgentId = owner === 'stencil' ? 'blitz' : 'stencil';
  const setup = CASCADE_OPENING.slice();
  return {
    key: `${id}:cascade`,
    title,
    mode,
    picks: setup.length % 2 === 0 ? [owner, opp] : [opp, owner],
    setup,
    steps: [{ say: ABILITY_TEXT[id].cascade.replace(/^ULTIMATE\. /, `${ABILITY_TEXT[id].name} is an ultimate. `), moves: [] }],
  };
}

/** Make a power usable now (lessons skip the waiting). */
export function readyPower(m: MatchState, id: AbilityId): MatchState {
  if (!m.agents) return m;
  const a = structuredClone(m.agents);
  const p = m.round.turn;
  const agent = a.picks[p];
  if (isUlt(id)) a.ult[p] = ultCostOf(AGENT_TUNING[m.round.mode], agent);
  else if (slotOf(agent, id) >= 0) a.cd[p][slotOf(agent, id)] = 0;
  return { ...m, agents: a };
}

/** Play one lesson move: ready the power if needed, then apply. */
export function lessonMove(m: MatchState, mv: Move, realTimers = false): { state: MatchState; events: GameEvent[] } {
  const s = mv.kind === 'ability' && !realTimers ? readyPower(m, mv.id) : m;
  return applyMove(s, mv);
}

/** Build a lesson's position: a fresh match with the setup moves played. */
export function lessonStart(l: Lesson, moves: Move[] = l.setup): MatchState {
  let m = newMatch(l.mode, 0, l.picks);
  for (const mv of moves) m = lessonMove(m, mv, l.realTimers).state;
  return m;
}

/**
 * Cascade lessons choose their moves from the position: the power on the target that
 * changes the most, then the drop that keeps the most open. Twist lessons are fixed.
 */
export function stepMoves(l: Lesson, step: LessonStep, m: MatchState): Move[] {
  if (l.mode === 'rotating' || (step.moves && step.moves.length)) return step.moves ?? [];
  const id = (l.key.split(':')[0] as AbilityId);
  const ready = readyPower(m, id);
  const uses: AbilityUse[] = abilityUses(ready.round, ready.agents!, id);
  if (!uses.length) return [];
  const score = (u: AbilityUse) => {
    try {
      const after = applyMove(ready, u).state;
      return after.round.cells.reduce<number>((n, c, i) => n + (c !== ready.round.cells[i] ? 1 : 0), 0) + (u.cells?.[0] !== undefined ? coord(u.cells[0])[1] * 0.1 : 0);
    } catch {
      return -1;
    }
  };
  const best = uses.reduce((a, b) => (score(b) > score(a) ? b : a));
  const after = applyMove(ready, best).state;
  // The drop: one that doesn't finish a line, so the power's effect is what you see.
  const drops = legalMoves(after).filter((mv) => !checkMove(after, mv));
  const quiet = drops.find((mv) => !applyMove(after, mv).events.some((e) => e.type === 'lineCompleted'));
  const drop = quiet ?? drops[0];
  return drop ? [best, drop] : [best];
}

/** The player who acts first in a step (for the demo power bar). */
export function actorOf(m: MatchState): Player {
  return m.round.turn;
}

export const ALL_TOPICS: Topic[] = ['powers', 'wet', 'timers', 'ult'];
