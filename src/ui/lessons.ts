// Show-me lessons: short scripted plays on the real cube, run by the real rules, with a
// line of narration per step (shown and read aloud). One per Agents idea (how powers
// work, wet paint, timers, the ultimate) and one per power. Twist lessons are written by
// hand; Cascade power lessons are set up from a fixed opening and pick a use that shows
// the power well.
//
// Pure data and rules here (no DOM), so test/lessons.test.ts can play every lesson
// through the engine and prove each step is legal.

import { AGENTS, AGENT_IDS, SIMPLE_POWERS, abilityUses, isUlt, slotOf, tuning, ultCostOf, type AbilityId, type AbilityUse, type AgentId } from '../core/agents.ts';
import { applyMove, checkMove, legalMoves, newMatch, type MatchState, type Mode, type Move } from '../core/match.ts';
import { coord, type Player } from '../core/geometry.ts';
import type { Twist } from '../core/twist.ts';
import type { GameEvent } from '../core/events.ts';
import { ABILITY_TEXT, abilityText } from './agents-ui.ts';

export type Topic = 'powers' | 'wet' | 'timers' | 'ult' | 'powerTurn';

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
  /** Played under the Simple rules. */
  simple?: boolean;
  /** Steps with no moves get a power use and a normal move picked from the position. */
  auto?: AbilityId;
  /** No agents: the plain game (the first-time demo). `picks` is ignored. */
  classic?: boolean;
}

const place = (cell: number): Move => ({ kind: 'place', cell });
const use = (id: AbilityId, cells?: number[], twists?: Twist[]): Move => ({ kind: 'ability', id, ...(cells ? { cells } : {}), ...(twists ? { twists } : {}) });
const twist = (axis: 0 | 1 | 2, slice: 0 | 1 | 2, dir: 1 | -1): Move => ({ kind: 'twist', twist: { axis, slice, dir } as Twist });

// The face toward the camera, top row first:  24 25 26 / 15 16 17 / 6 7 8
// Orange (player 1) is "Orange"; blue (player 2) is "Blue".

const TOPICS: Record<Exclude<Topic, 'powerTurn'>, Lesson> = {
  powers: {
    key: 'powers',
    title: 'Using a power',
    mode: 'rotating',
    picks: ['blitz', 'stencil'],
    setup: [place(24), place(6)],
    steps: [
      { say: 'Orange is Blitz. Their powers sit in the bar at the bottom. On your turn you can use one power, then make your normal move.' },
      { say: 'Tap a power, and the cells you can use it on glow. Here Orange taps Double Tap, then a glowing cell: an extra mark lands.', moves: [use('doubleTap', [16])] },
      { say: 'Now the normal move, as always. Two marks in one turn!', moves: [place(17)] },
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
      { say: 'Wet paint is paint that hasn’t dried yet. A row with wet paint in it does not count. Orange has one mark in the top row.', focus: [24] },
      { say: 'Orange uses Double Tap. Paint put down by a power is wet: see it drip.', moves: [use('doubleTap', [25])], focus: [25] },
      { say: 'Orange finishes the row with the normal move. The row is complete, but one mark is wet, so it does not count yet.', moves: [place(26)], focus: [24, 25, 26] },
      { say: 'Wet paint dries at the start of Orange’s turn after next. Until then Blue gets two turns to break the row. Here Blue twists the left layer, and the row breaks apart. Saved!', moves: [twist(0, 0, 1)] },
      {
        say: 'What makes paint wet? Paint a power puts down or moves. Your normal move on a turn you used Shove, Overspray, Spin, Fixative, Flip or Rewind. And the other player’s next mark after you use Delay.',
      },
      {
        say: 'Again, but this time Blue ignores the row. That was Blue’s first turn to answer.',
        reset: [place(24), place(6), use('doubleTap', [25]), place(26)],
        moves: [place(0)],
        focus: [24, 25, 26],
      },
      { say: 'Orange’s turn starts: the paint is still wet, one more turn to go. Orange plays away from the row.', moves: [twist(2, 0, 1)] },
      { say: 'Blue’s second and last chance, and Blue misses it. At the start of Orange’s turn the paint dries, the row is whole, and it counts. Orange takes the round.', moves: [place(9)], ends: true },
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
      { say: 'Chrome hits straight away: Orange’s next marks are chrome. They never fade, and no power can move or wipe them.', moves: [place(25)], focus: [25] },
    ],
  },
};

/** Twist lessons for each power, written by hand. Orange acts unless noted. */
const TWIST_POWERS: Partial<Record<AbilityId, Omit<Lesson, 'key' | 'title' | 'mode'>>> = {
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
      { say: 'Flip is Drift’s ultimate: two twists at once, ignoring the twist rules. Everything it moves is wet.', moves: [use('flip', undefined, [{ axis: 2, slice: 2, dir: 1 } as Twist, { axis: 0, slice: 0, dir: 1 } as Twist])] },
      { say: 'Then Orange makes the normal move, wet too: a row it makes has to survive Blue’s reply.', moves: [place(26)] },
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
      { say: 'The gap is open again, and Orange fills it. The move after a Rewind is wet, so Blue still gets a chance to answer.', moves: [place(26)], focus: [24, 25, 26] },
    ],
  },
};

/** Simple rules: what changes (no wet paint; the power-turn rule; once per round). */
const SIMPLE_TOPICS: Partial<Record<Topic, Lesson>> = {
  powerTurn: {
    key: 'powerTurn',
    title: 'Power turns',
    mode: 'rotating',
    simple: true,
    picks: ['blitz', 'stencil'],
    setup: [place(24), place(6), place(25), place(26)],
    steps: [
      { say: 'One rule to remember: on a turn you use a power, you can’t finish a line of your own. Orange has two in the top row; Blue blocked the end.', focus: [24, 25, 26] },
      { say: 'Orange wipes Blue’s block with Overspray. The gap is open… but this is a power turn, so Orange can’t fill it now.', moves: [use('overspray', [26])], focus: [26] },
      { say: 'Orange twists the bottom layer instead. Now Blue gets a chance to block again… but plays elsewhere.', moves: [twist(2, 0, 1), place(15)] },
      { say: 'Blue didn’t block. On a normal turn, Orange can finish the row and win.', moves: [place(26)], ends: true },
    ],
  },
  timers: {
    key: 'timers',
    title: 'Once a round',
    mode: 'rotating',
    simple: true,
    realTimers: true,
    picks: ['blitz', 'echo'],
    setup: [place(24), place(6)],
    steps: [
      { say: 'Each power works once per round. Orange uses Overspray.', moves: [use('overspray', [6]), place(16)], focus: [6] },
      { say: 'Now Overspray shows a tick: it’s used up until the next round. The other powers are still ready.', moves: [place(7)] },
      { say: 'Every new round, all the powers are ready again.' },
    ],
  },
  ult: {
    key: 'ult',
    title: 'Ultimate',
    mode: 'rotating',
    simple: true,
    picks: ['blitz', 'stencil'],
    setup: [place(24), place(6)],
    steps: [
      { say: 'The last button is the ultimate. Its ring fills a bit every turn. When it says READY, fire it.' },
      { say: 'Orange fires Chrome!', moves: [use('chrome')] },
      { say: 'Orange’s next two marks are chrome: they never fade, and no power can move or wipe them.', moves: [place(25)], focus: [25] },
    ],
  },
};

/** Twist starting positions for the Simple-only powers. */
const SIMPLE_SETUPS: Partial<Record<AbilityId, Move[]>> = {
  shield: [place(24), place(6), place(25), place(7)],
  relocate: [place(24), place(6), place(16), place(7)],
  freeze: [place(24), place(6), place(25), place(7)],
  // Orange's oldest mark (24) faded when a 4th was painted: Afterimage brings it back.
  afterimage: [place(24), place(6), place(25), place(7), place(16), place(0), place(17), place(1)],
};

/** Cascade power lessons: a fixed opening, then the power and a drop. */
const CASCADE_OPENING: Move[] = [0, 4, 1, 5, 3, 7, 2, 8, 6, 4].map((column) => ({ kind: 'drop', column }) as Move);

export function topicLesson(t: Topic, simple = false): Lesson {
  if (simple) return SIMPLE_TOPICS[t] ?? { ...(TOPICS as Record<string, Lesson>)[t], simple: true, key: `${t}:simple` };
  return (TOPICS as Record<string, Lesson>)[t];
}
export const topicsFor = (simple: boolean): Topic[] => (simple ? ['powers', 'powerTurn', 'timers', 'ult'] : ['powers', 'wet', 'timers', 'ult']);

export function abilityLesson(id: AbilityId, mode: Mode, simple = false): Lesson {
  const owner = AGENT_IDS.find((a) => (AGENTS[a].powers as readonly AbilityId[]).includes(id) || (SIMPLE_POWERS[a] as readonly AbilityId[]).includes(id) || AGENTS[a].ult === id)!;
  const title = `${ABILITY_TEXT[id].name}${isUlt(id) ? ' · ultimate' : ''}`;
  if (simple) {
    // Simple: the power, picked from a fixed position, then a normal move.
    const opp: AgentId = owner === 'stencil' ? 'blitz' : 'stencil';
    const setup = mode === 'rotating' ? (SIMPLE_SETUPS[id] ?? TWIST_POWERS[id]?.setup ?? [place(24), place(6)]) : CASCADE_OPENING.slice();
    const say = abilityText(id, mode, true).replace(/^ULTIMATE\. /, `${ABILITY_TEXT[id].name} is an ultimate. `);
    return {
      key: `${id}:${mode}:simple`,
      title,
      mode,
      simple: true,
      auto: id,
      picks: setup.length % 2 === 0 ? [owner, opp] : [opp, owner],
      setup,
      steps: [
        { say },
        { say: 'Then the normal move. Remember: on a power turn you can’t finish a line of your own.' },
      ],
    };
  }
  if (mode === 'rotating') return { key: `${id}:rotating`, title, mode, ...TWIST_POWERS[id]! };
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
  if (isUlt(id)) a.ult[p] = ultCostOf(tuning(m.round.mode, a.simple), agent);
  else if (slotOf(agent, id, a.simple) >= 0) a.cd[p][slotOf(agent, id, a.simple)] = 0;
  return { ...m, agents: a };
}

/** Play one lesson move: ready the power if needed, then apply. */
export function lessonMove(m: MatchState, mv: Move, realTimers = false): { state: MatchState; events: GameEvent[] } {
  const s = mv.kind === 'ability' && !realTimers ? readyPower(m, mv.id) : m;
  return applyMove(s, mv);
}

/** Build a lesson's position: a fresh match with the setup moves played. */
export function lessonStart(l: Lesson, moves: Move[] = l.setup): MatchState {
  let m = l.classic ? newMatch(l.mode, 0) : newMatch(l.mode, 0, l.picks, !!l.simple);
  for (const mv of moves) m = lessonMove(m, mv, l.realTimers).state;
  return m;
}

/**
 * Cascade lessons choose their moves from the position: the power on the target that
 * changes the most, then the drop that keeps the most open. Twist lessons are fixed.
 */
export function stepMoves(l: Lesson, step: LessonStep, m: MatchState): Move[] {
  if (l.auto) return autoMoves(l, step, m);
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

/**
 * Auto lessons (Simple): step 1 is the power, on the target that changes the board the
 * most (a Twist script's own target when it has one); step 2 is a quiet normal move.
 */
function autoMoves(l: Lesson, step: LessonStep, m: MatchState): Move[] {
  const id = l.auto!;
  const first = l.steps.indexOf(step) === 0;
  if (first) {
    const ready = readyPower(m, id);
    const uses: AbilityUse[] = abilityUses(ready.round, ready.agents!, id);
    if (!uses.length) return [];
    const scripted = TWIST_POWERS[id]?.steps.flatMap((s) => s.moves ?? []).find((mv) => mv.kind === 'ability' && mv.id === id);
    const keep = l.mode === 'rotating' && scripted && !checkMove(ready, scripted) ? (scripted as AbilityUse) : null;
    if (keep) return [keep];
    const changed = (u: AbilityUse) => {
      try {
        const after = applyMove(ready, u).state;
        return after.round.cells.reduce<number>((n, c, i) => n + (c !== ready.round.cells[i] ? 1 : 0), 0) + (u.cells?.[0] !== undefined ? coord(u.cells[0])[1] * 0.1 : 0);
      } catch {
        return -1;
      }
    };
    return [uses.reduce((a, b) => (changed(b) > changed(a) ? b : a))];
  }
  // The normal move: one that doesn't end the round or finish a line.
  const moves = legalMoves(m).filter((mv) => mv.kind !== 'ability' && !checkMove(m, mv));
  const quiet = moves.find((mv) => {
    const out = applyMove(m, mv);
    return !out.state.round.result && !out.events.some((e) => e.type === 'lineCompleted');
  });
  const mv = quiet ?? moves[0];
  return mv ? [mv] : [];
}

/** The player who acts first in a step (for the demo power bar). */
export function actorOf(m: MatchState): Player {
  return m.round.turn;
}

export const ALL_TOPICS: Topic[] = ['powers', 'wet', 'timers', 'ult'];
/** Every power that has a lesson, by rule set. */
export const lessonPowers = (simple: boolean): AbilityId[] =>
  [...new Set(AGENT_IDS.flatMap((a) => [...(simple ? SIMPLE_POWERS[a] : AGENTS[a].powers), AGENTS[a].ult]))];

/**
 * The first-time demo: the whole plain game in one short watch, played by the real rules
 * (test/lessons.test.ts plays it). Orange can't just paint the winning block at the end,
 * because a 4th mark would fade their oldest: the twist is what wins.
 */
export const BASICS: Lesson = {
  key: 'basics',
  title: 'How to play',
  mode: 'rotating',
  picks: ['blitz', 'stencil'],
  classic: true,
  setup: [],
  steps: [
    { say: 'Tic Tac Three is tic-tac-toe on a cube of 3 × 3 × 3 blocks. Two players take turns painting blocks. Orange goes first.', moves: [place(16)] },
    { say: 'Then Blue.', moves: [place(26)] },
    { say: 'Three in a row wins the round. A row can run any way: across, up and down, front to back, or corner to corner, like this one.', focus: [8, 16, 24] },
    { say: 'Orange paints right next to their first block: two in a row. Blue has to block the third block, or Orange wins next turn.', moves: [place(15), place(17)], focus: [15, 16, 17] },
    { say: 'Each player keeps at most 3 marks. The small numbers show their age: 1 is the oldest.', moves: [place(8), place(0)] },
    { say: 'Paint a 4th, and your number 1 fades away. Watch Orange’s 1.', moves: [place(24)], focus: [16] },
    { say: 'Blue paints where Orange’s mark faded.', moves: [place(16)] },
    {
      say: 'Instead of painting, you can twist a layer: swipe across the cube. Everything in that layer turns, yours and theirs. Orange twists the bottom layer and lines up three. Orange wins the round!',
      moves: [twist(2, 0, 1)],
      ends: true,
    },
    { say: 'Win 2 rounds to win the match. Now it’s your turn to try!' },
  ],
};
