// Agents mode rules: every power and ultimate, timers, wet paint, interactions, and
// save/resume. States are built by hand so each rule is checked in isolation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CELLS, LINES, type Cell, type Player } from '../src/core/geometry.ts';
import { applyMove, checkMove, newMatch, nextRound, legalMoves, type MatchState, type Move } from '../src/core/match.ts';
import {
  AGENTS, AGENT_IDS, AGENT_TUNING, WETS_MOVE, wetsMove, abilitiesOf, abilityBlocked, abilityStatus, abilityUses, decorOf, isUlt, lineThrough,
  type AbilityId, type AbilityUse, type AgentId, type PowerId,
} from '../src/core/agents.ts';
import { TWISTS, inverse, permutation, type Twist } from '../src/core/twist.ts';
import type { RotatingState } from '../src/core/rotating.ts';
import type { CascadeState } from '../src/core/cascade.ts';
import { rng } from '../src/core/rng.ts';
import { agentBotTurn, AGENT_BOT } from '../src/sim/bot.ts';

const RT = AGENT_TUNING.rotating;
const CT = AGENT_TUNING.cascade;
const use = (id: AbilityId, cells?: number[], twists?: Twist[]): AbilityUse => ({ kind: 'ability', id, ...(cells ? { cells } : {}), ...(twists ? { twists } : {}) });
const place = (cell: number): Move => ({ kind: 'place', cell });
const drop = (column: number): Move => ({ kind: 'drop', column });
const twist = (axis: 0 | 1 | 2, slice: 0 | 1 | 2, dir: 1 | -1): Move => ({ kind: 'twist', twist: { axis, slice, dir } });

/** A Twist match with these marks (oldest first), every power ready, `turn` to move. */
function rot(picks: [AgentId, AgentId], marks: [number[], number[]], turn: Player = 0): MatchState {
  const m = newMatch('rotating', turn, picks);
  const r = m.round as RotatingState;
  marks[0].forEach((c) => (r.cells[c] = 0));
  marks[1].forEach((c) => (r.cells[c] = 1));
  r.marks = [marks[0].slice(), marks[1].slice()];
  r.turn = turn;
  m.agents!.cd = [[0, 0, 0], [0, 0, 0]];
  return m;
}
/** A Cascade match with these cubes, every power ready. */
function cas(picks: [AgentId, AgentId], cubes: Record<number, Player>, turn: Player = 0): MatchState {
  const m = newMatch('cascade', turn, picks);
  const r = m.round as CascadeState;
  for (const [c, p] of Object.entries(cubes)) r.cells[Number(c)] = p;
  r.turn = turn;
  m.agents!.cd = [[0, 0, 0], [0, 0, 0]];
  return m;
}
function play(m: MatchState, ...moves: Move[]): MatchState {
  for (const mv of moves) {
    const why = checkMove(m, mv);
    assert.equal(why, null, `expected ${JSON.stringify(mv)} to be legal, got ${why}`);
    m = applyMove(m, mv).state;
  }
  return m;
}
const ult = (m: MatchState, p: Player): MatchState => {
  const id = AGENTS[m.agents!.picks[p]].ult;
  m.agents!.ult[p] = RT.ultCost[id] > 0 && m.mode === 'rotating' ? RT.ultCost[id] : CT.ultCost[id];
  return m;
};
const cells = (m: MatchState): Cell[] => m.round.cells;
/** A placement (or drop) that doesn't end the round and avoids `avoid`. */
function safe(m: MatchState, avoid: number[] = []): Move {
  for (const mv of legalMoves(m)) {
    if (mv.kind === 'place' && avoid.includes(mv.cell)) continue;
    if (mv.kind === 'drop' && avoid.includes(mv.column)) continue;
    if (mv.kind !== 'place' && mv.kind !== 'drop') continue;
    if (!applyMove(m, mv).state.round.result) return mv;
  }
  throw new Error('no safe move');
}

test('the roster: four agents, three powers and an ultimate each, all tunable', () => {
  assert.deepEqual([...AGENT_IDS], ['blitz', 'stencil', 'drift', 'echo']);
  const all = AGENT_IDS.flatMap((a) => abilitiesOf(a));
  assert.equal(new Set(all).size, 16);
  for (const mode of ['rotating', 'cascade'] as const) {
    const t = AGENT_TUNING[mode];
    for (const id of all) {
      if (isUlt(id)) assert.ok(t.ultCost[id] > 0, `${mode} ${id} cost`);
      else {
        assert.ok(t.cooldown[id as PowerId] >= 1, `${mode} ${id} cooldown`);
        assert.ok(t.firstReady[id as PowerId] >= 0, `${mode} ${id} firstReady`);
      }
    }
  }
});

test('a new agents match: cooldowns start at firstReady, meter at 0; Classic refuses abilities', () => {
  const m = newMatch('rotating', 0, ['blitz', 'drift']);
  assert.deepEqual(m.agents!.cd[0], AGENTS.blitz.powers.map((id) => RT.firstReady[id]));
  assert.deepEqual(m.agents!.ult, [0, 0]);
  const classic = newMatch('rotating', 0);
  assert.equal(classic.agents, undefined);
  assert.equal(checkMove(classic, use('delay')), 'no-agents');
});

test('one ability per turn, cooldowns tick on your turns, the ultimate needs a full meter', () => {
  let m = rot(['echo', 'blitz'], [[0], [9]]);
  assert.equal(checkMove(m, use('rewind')), 'ult-not-ready');
  assert.equal(checkMove(m, use('tape', [5])), 'not-your-power');
  m = play(m, use('delay'));
  assert.equal(checkMove(m, use('reverb')), 'power-used');
  m = play(m, place(1));
  assert.equal(m.agents!.cd[0][1], RT.cooldown.delay, 'delay cooling down');
  assert.equal(m.agents!.ult[0], RT.ultPerTurn);
  m = play(m, place(18)); // blitz
  assert.equal(checkMove(m, use('delay')), 'cooldown');
  const st = abilityStatus(m.round, m.agents!, 0);
  assert.equal(st[1].cooldown, RT.cooldown.delay);
  assert.equal(st[1].blocked, 'cooldown');
  m = play(m, place(2));
  assert.equal(m.agents!.cd[0][1], RT.cooldown.delay - 1);
});

test('the meter fills one pip per turn, two more for losing a Twist round, and caps at the cost', () => {
  let m = rot(['blitz', 'echo'], [[0, 1], [9]]);
  m = play(m, place(2)); // blitz wins round 1
  assert.equal(m.round.result?.winner, 0);
  assert.equal(m.agents!.ult[1], RT.ultBonus);
  m = nextRound(m);
  assert.equal(m.agents!.ult[1], RT.ultBonus, 'carries over');
  m.agents!.ult[0] = RT.ultCost.chrome - 1;
  m.agents!.cd = [[0, 0, 0], [0, 0, 0]];
  const p = m.round.turn;
  const before = m.agents!.ult[p];
  m = play(m, place(4));
  assert.equal(m.agents!.ult[p], Math.min(RT.ultCost[AGENTS[m.agents!.picks[p]].ult], before + 1));
});

test('wet paint: a line with wet paint counts only at the start of its owner turn, and only if intact', () => {
  // Blitz holds 0, 1 and a wet 2 (one more of its turn starts to dry).
  const base = () => {
    const m = rot(['blitz', 'echo'], [[0, 1, 2], [9, 10]], 1);
    m.agents!.wet[2] = 1;
    return m;
  };
  let m = base();
  assert.equal(m.round.result, null, 'the wet line does not count yet');
  m = play(m, place(22)); // echo leaves it: it dries and counts as blitz's turn starts
  assert.equal(m.round.result?.winner, 0);
  const ev = applyMove(base(), place(22)).events;
  assert.ok(ev.some((e) => e.type === 'dried' && e.cells.includes(2)));
  // Broken before it dries: the top layer turns and the line is gone.
  m = play(base(), twist(0, 0, 1));
  assert.equal(cells(m)[0], null, 'cell 0 turned away');
  assert.equal(m.round.result, null);
});

test('Double Tap: a second (wet) mark; Twist keeps the 3-mark cap', () => {
  let m = rot(['blitz', 'echo'], [[0, 4, 8], [9]]);
  assert.ok(abilityUses(m.round, m.agents!, 'doubleTap').every((u) => cells(m)[u.cells![0]] === null && u.cells![0] !== 13));
  m = play(m, use('doubleTap', [20]));
  assert.equal(cells(m)[20], 0);
  assert.equal(cells(m)[0], null, 'oldest faded');
  assert.ok(m.agents!.wet[20] > 0);
  assert.deepEqual((m.round as RotatingState).marks[0], [4, 8, 20]);
  m = play(m, place(24));
  assert.equal((m.round as RotatingState).marks[0].length, 3);
  assert.equal(m.agents!.wet[24], 0, 'Double Tap does not make the move wet');
});

test('Double Tap in Cascade: a wet second drop whose line bursts when it dries', () => {
  let m = cas(['blitz', 'echo'], { 0: 0, 1: 0 });
  m = play(m, use('doubleTap', [2]));
  assert.equal(cells(m)[2], 0);
  assert.equal((m.round as CascadeState).scores[0], 0, 'wet: no burst yet');
  m = play(m, drop(8), drop(6));
  for (let k = 1; k < CT.dryTurns; k++) m = play(m, drop(7), drop(3 + k));
  assert.equal((m.round as CascadeState).scores[0], 1, 'dried and burst at the start of blitz turn');
  assert.deepEqual(cells(m).slice(0, 3), [null, null, null]);
});

test('Shove: an enemy mark slides into an empty neighbour (wet); my move that turn is wet too', () => {
  let m = rot(['blitz', 'echo'], [[0, 1], [2]]);
  const uses = abilityUses(m.round, m.agents!, 'shove');
  assert.ok(uses.every((u) => cells(m)[u.cells![0]] === 1 && cells(m)[u.cells![1]] === null && u.cells![1] !== 13));
  assert.equal(checkMove(m, use('shove', [2, 13])), 'bad-target');
  m = play(m, use('shove', [2, 5]));
  assert.equal(cells(m)[5], 1);
  assert.equal(cells(m)[2], null);
  assert.ok(m.agents!.wet[5] > 0);
  assert.ok(WETS_MOVE.has('shove'));
  m = play(m, place(2)); // completes 0-1-2, but wet: no win this turn
  assert.equal(m.round.result, null);
  assert.ok(m.agents!.wet[2] > 0);
});

test('Overspray wipes an enemy mark (it becomes their lost mark); Chrome and seals block it', () => {
  let m = rot(['blitz', 'echo'], [[0], [9, 10]]);
  m = play(m, use('overspray', [10]));
  assert.equal(cells(m)[10], null);
  assert.equal(m.agents!.lost[1], 10);
  assert.deepEqual((m.round as RotatingState).marks[1], [9]);
  const c = rot(['blitz', 'echo'], [[0], [9, 10]]);
  c.agents!.chrome[10] = true;
  c.agents!.effects.push({ kind: 'seal', cell: 9, by: 1, turns: 2 });
  assert.equal(checkMove(c, use('overspray', [10])), 'no-target');
  assert.equal(checkMove(c, use('shove', [10, 11])), 'no-target');
  assert.equal(abilityBlocked(c.round, c.agents!, 'overspray'), 'no-target');
  c.agents!.chrome[10] = false;
  assert.equal(checkMove(c, use('overspray', [9])), 'bad-target');
  assert.equal(checkMove(c, use('overspray', [10])), null);
});

test('Chrome: the next marks are chrome, never fade and are immune to powers', () => {
  let m = ult(rot(['blitz', 'echo'], [[0, 1, 21], [9]]), 0);
  m = play(m, use('chrome'), place(4));
  assert.ok(m.agents!.chrome[4]);
  assert.equal(m.agents!.ult[0], RT.ultPerTurn, 'meter spent, then a pip for the turn');
  assert.equal(cells(m)[0], null, 'a normal mark faded');
  m = play(m, safe(m));
  m = play(m, place(24));
  assert.ok(m.agents!.chrome[24]);
  for (let k = 0; k < 6; k++) m = play(m, safe(m));
  // Two chrome marks never fade; the plain ones cycle.
  assert.equal(cells(m)[4], 0);
  assert.equal(cells(m)[24], 0);
  assert.equal((m.round as RotatingState).marks[0].filter((c) => m.agents!.chrome[c]).length, 2);
  const o = { ...m, round: { ...m.round, turn: 1 as Player } } as MatchState;
  o.agents = { ...m.agents!, picks: ['echo', 'blitz'], cd: [[0, 0, 0], [0, 0, 0]] };
  assert.ok(!abilityUses(o.round, o.agents, 'overspray').some((u) => u.cells![0] === 4 || u.cells![0] === 24));
});

test('Tape blocks an empty cell for the opponent turns it lasts', () => {
  let m = rot(['stencil', 'echo'], [[0], [9]]);
  assert.equal(checkMove(m, use('tape', [9])), 'bad-target');
  m = play(m, use('tape', [5]), place(1));
  assert.equal(checkMove(m, place(5)), 'taped');
  assert.ok(decorOf(m.round, m.agents!).tape.includes(5));
  for (let k = 0; k < RT.tapeTurns; k++) {
    assert.ok(m.agents!.effects.some((e) => e.kind === 'tape'), `still taped after ${k} of their turns`);
    m = play(m, safe(m, [5]));
    if (k < RT.tapeTurns - 1) m = play(m, safe(m, [5]));
  }
  assert.ok(!m.agents!.effects.some((e) => e.kind === 'tape'), 'expired');
  assert.equal(checkMove(m, place(5)), null);
});

test('Tape in Cascade blocks a whole column', () => {
  let m = cas(['stencil', 'echo'], { 0: 1 });
  m = play(m, use('tape', [9]), drop(1));
  assert.equal(checkMove(m, drop(0)), 'taped');
  assert.equal(checkMove(m, drop(2)), null);
});

test('Fixative: a sealed mark never fades and its layers cannot be twisted (Fixative vs twist)', () => {
  let m = rot(['stencil', 'drift'], [[0, 4, 8], [9]]);
  m = play(m, use('fixative', [0]), place(20));
  assert.equal(cells(m)[0], 0, 'the sealed oldest mark stayed; the next one faded');
  assert.equal(cells(m)[4], null);
  // Drift can't twist a layer through cell 0, normally or with Spin.
  const through0 = TWISTS.filter((t) => [0, 0, 0][t.axis] === t.slice);
  for (const t of through0) {
    assert.equal(checkMove(m, { kind: 'twist', twist: t }), 'sealed');
    assert.ok(!abilityUses(m.round, m.agents!, 'spin').some((u) => JSON.stringify(u.twists![0]) === JSON.stringify(t)));
  }
});

test('Wet Floor: the opponent line does not count while it lasts, then counts if still intact', () => {
  let m = rot(['stencil', 'blitz'], [[18], [0, 1]]);
  const li = lineThrough(0, 2);
  m = play(m, use('wetFloor', [LINES[li][0], LINES[li][2]]), place(19));
  m = play(m, place(2)); // blitz completes the floored line: no win
  assert.equal(m.round.result, null);
  assert.equal(cells(m)[2], 1);
  // Nobody touches it; when the floor lifts, the line counts.
  let guard = 0;
  while (!m.round.result && guard++ < 10) {
    const mv = legalMoves(m).find((x) => x.kind === 'place' && ![0, 1, 2].includes(x.cell) && !applyMove(m, x).state.agents!.effects.length === false)!;
    const before = m.agents!.effects.length;
    m = applyMove(m, m.round.turn === 1 ? { kind: 'twist', twist: { axis: 2, slice: 2, dir: (guard % 2 ? 1 : -1) as 1 | -1 } } : safe(m, [0, 1, 2])).state;
    void mv;
    void before;
  }
  assert.equal(m.round.result?.winner, 1);
});

test('Lockdown: no powers and no twists for the opponent (Lockdown vs Spin)', () => {
  let m = ult(rot(['stencil', 'drift'], [[0], [9, 10]]), 0);
  m = play(m, use('lockdown'), place(1));
  assert.equal(checkMove(m, use('spin', undefined, [{ axis: 0, slice: 0, dir: 1 }])), 'locked-down');
  assert.equal(checkMove(m, twist(0, 0, 1)), 'locked-down');
  assert.equal(abilityStatus(m.round, m.agents!, 1)[0].blocked, 'locked-down');
  for (let k = 0; k < RT.lockdownTurns; k++) {
    assert.equal(checkMove(m, twist(0, 0, 1)), 'locked-down', `turn ${k + 1} of the lockdown`);
    m = play(m, safe(m));
    m = play(m, safe(m));
  }
  assert.equal(checkMove(m, twist(0, 0, 1)), null, 'lockdown lifted');
});

test('Lockdown in Cascade: their lines wait, then burst when it ends', () => {
  let m = ult(cas(['stencil', 'blitz'], { 0: 1, 1: 1 }), 0);
  m = play(m, use('lockdown'), drop(8), drop(2));
  assert.equal((m.round as CascadeState).scores[1], 0, 'locked: no burst');
  for (let k = 1; k < CT.lockdownTurns; k++) m = play(m, drop(6 + k - 1), drop(3 + k));
  m = play(m, drop(7));
  assert.equal((m.round as CascadeState).scores[1], 1, 'burst once lockdown ended');
});

test('Spin: a twist that ignores twisting last turn but not undoing the last twist; moved marks wet', () => {
  let m = rot(['drift', 'echo'], [[0], [9]]);
  m = play(m, twist(0, 0, 1), twist(2, 2, 1));
  assert.equal(checkMove(m, twist(0, 1, 1)), 'twisted-last-turn');
  const undo = inverse({ axis: 2, slice: 2, dir: 1 });
  assert.ok(abilityUses(m.round, m.agents!, 'spin').length > 0);
  assert.ok(!abilityUses(m.round, m.agents!, 'spin').some((u) => JSON.stringify(u.twists![0]) === JSON.stringify(undo)));
  const mine = (m.round as RotatingState).marks[0][0];
  const t: Twist = { axis: 0, slice: (mine % 3) as 0 | 1 | 2, dir: 1 };
  const where = permutation(t);
  m = play(m, use('spin', undefined, [t]));
  assert.ok(m.agents!.wet[where[mine]] > 0);
});

test('Spin in Cascade: the layer turns, then everything falls', () => {
  let m = cas(['drift', 'echo'], { 0: 0, 9: 0, 1: 1 });
  m = play(m, use('spin', undefined, [{ axis: 1, slice: 0, dir: 1 }]));
  for (const col of [0, 1, 2]) {
    const c = [col, col + 9, col + 18].map((i) => cells(m)[i]);
    const firstEmpty = c.indexOf(null);
    if (firstEmpty >= 0) assert.ok(c.slice(firstEmpty).every((x) => x === null), 'no floating cubes');
  }
});

test('Swap trades a mark with a touching enemy mark; both are wet', () => {
  let m = rot(['drift', 'echo'], [[0], [1]]);
  assert.equal(checkMove(m, use('swap', [0, 2])), 'bad-target');
  m = play(m, use('swap', [0, 1]));
  assert.equal(cells(m)[0], 1);
  assert.equal(cells(m)[1], 0);
  assert.ok(m.agents!.wet[0] > 0 && m.agents!.wet[1] > 0);
  assert.deepEqual((m.round as RotatingState).marks, [[1], [0]]);
});

test('Paint Trap: when the opponent paints it, the mark becomes the trapper (wet)', () => {
  let m = rot(['drift', 'echo'], [[0], [9]]);
  m = play(m, use('trap', [5]), place(1));
  assert.ok(decorOf(m.round, m.agents!).trap.some((t) => t.cell === 5 && t.by === 0));
  const r = applyMove(m, place(5));
  m = r.state;
  assert.equal(cells(m)[5], 0);
  assert.ok(r.events.some((e) => e.type === 'converted' && e.cell === 5 && e.to === 0));
  assert.ok((m.round as RotatingState).marks[0].includes(5));
  assert.ok(m.agents!.wet[5] > 0);
});

test('Flip (Twist): two twists at once, ignoring the twist rules; what it moves is wet, so it never wins at once', () => {
  // Drift holds 0 and 1; 20 sits in the top layer. Pairs of twists that line them up
  // make a wet line: it does not count straight away.
  const m = ult(rot(['drift', 'echo'], [[0, 1, 20], [9]]), 0);
  (m.round as RotatingState).twistedLast[0] = true;
  const uses = abilityUses(m.round, m.agents!, 'flip');
  assert.ok(uses.length > 0);
  let lined = 0;
  for (const u of uses) {
    const out = applyMove(m, u).state;
    assert.equal(out.round.result, null, 'Flip alone never ends the round');
    const mine = out.round.cells.flatMap((c, i) => (c === 0 ? [i] : []));
    if (LINES.some((l) => l.every((c) => mine.includes(c)))) lined++;
    for (const c of mine) if (out.round.cells[c] !== m.round.cells[c]) assert.ok(out.agents!.wet[c] > 0, 'moved paint is wet');
  }
  assert.ok(lined > 0, 'some Flip lines the three up (wet)');
  assert.ok(wetsMove('flip', 'rotating') && !wetsMove('flip', 'cascade'));
});

test('Flip (Cascade): the cube flips, everything falls, and lines chain and score as usual', () => {
  // Top row of the stack is blue; after the flip it lands on the floor as a line.
  let m = ult(cas(['drift', 'echo'], { 0: 1, 1: 1, 2: 1, 9: 0, 10: 0, 11: 0 }), 0);
  // Blue's bottom line would have burst already in play; mark it wet so it is waiting.
  m.agents!.wet[0] = m.agents!.wet[1] = m.agents!.wet[2] = 2;
  const out = applyMove(m, use('flip'));
  const sc = (out.state.round as CascadeState).scores;
  assert.ok(sc[0] >= 1, 'orange line scored after the flip');
  assert.ok(out.events.some((e) => e.type === 'moved' && e.flip));
});

test('Afterimage brings back your most recently lost mark (wet); nothing lost, nothing to bring', () => {
  let m = rot(['echo', 'blitz'], [[0, 4, 8], [9]]);
  assert.equal(abilityBlocked(m.round, m.agents!, 'afterimage'), 'no-target');
  m = play(m, place(20), place(10)); // 0 faded
  assert.equal(m.agents!.lost[0], 0);
  m = play(m, use('afterimage', [0]));
  assert.equal(cells(m)[0], 0);
  assert.ok(m.agents!.wet[0] > 0);
  assert.equal(m.agents!.lost[0], 4, 'bringing it back faded the next oldest');
});

test('Delay: the opponent next mark is wet', () => {
  let m = rot(['echo', 'blitz'], [[0], [9, 10]]);
  m = play(m, use('delay'), place(1), place(11));
  assert.ok(m.agents!.wet[11] > 0);
  assert.equal(m.round.result, null, '9-10-11 is wet, no win yet');
});

test('Reverb paints straight through the Core after your move; fizzles when that cell is taken', () => {
  let m = rot(['echo', 'blitz'], [[], [9]]);
  m = play(m, use('reverb'), place(0));
  assert.equal(cells(m)[26], 0);
  assert.ok(m.agents!.wet[26] > 0);
  let f = rot(['echo', 'blitz'], [[], [26]]);
  const out = applyMove(applyMove(f, use('reverb')).state, place(0));
  assert.ok(out.events.some((e) => e.type === 'fizzled'));
  f = out.state;
  assert.equal(cells(f)[26], 1);
});

test('Rewind undoes the opponent whole turn, power included, then you move', () => {
  let m = rot(['echo', 'blitz'], [[0], [9]]);
  m = play(m, place(1));
  const before = JSON.stringify(m.round.cells);
  m = play(m, use('overspray', [1]), place(10));
  assert.equal(cells(m)[1], null);
  assert.equal(m.agents!.cd[1][2], RT.cooldown.overspray);
  ult(m, 0);
  m = play(m, use('rewind'));
  assert.equal(JSON.stringify(m.round.cells), before, 'board back to before their turn');
  assert.equal(m.round.turn, 0, 'still my turn');
  assert.equal(m.agents!.cd[1][2], 0, 'their Overspray is back');
  assert.equal(checkMove(m, use('rewind')), 'power-used');
  // The move after a Rewind is wet: the row is made but does not count yet.
  m = play(m, place(2));
  assert.equal(m.round.result, null);
  assert.ok(m.agents!.wet[2] > 0);
  assert.ok(wetsMove('rewind', 'rotating') && !wetsMove('rewind', 'cascade'));
});

test('Cascade: with no legal drop the only move is a pass', () => {
  const cubes: Record<number, Player> = {};
  // Fill every column but one; tape the last.
  for (let c = 0; c < CELLS; c++) if (c % 9 !== 4) cubes[c] = ((c * 7) % 3 === 0 ? 0 : 1) as Player;
  let m = cas(['stencil', 'blitz'], cubes);
  m.agents!.wet = m.agents!.wet.map(() => 2);
  m.agents!.effects.push({ kind: 'tape', cell: 4, by: 1, turns: 2 }, { kind: 'tape', cell: 13, by: 1, turns: 2 }, { kind: 'tape', cell: 22, by: 1, turns: 2 });
  assert.deepEqual(legalMoves(m), [{ kind: 'pass' }]);
  m = play(m, { kind: 'pass' });
  assert.equal(m.round.turn, 1);
});

test('every legal ability use applies cleanly and keeps the state JSON-safe', () => {
  const r = rng(9);
  for (const mode of ['rotating', 'cascade'] as const) {
    for (const picks of [['blitz', 'stencil'], ['drift', 'echo']] as [AgentId, AgentId][]) {
      let m = newMatch(mode, 0, picks);
      for (let t = 0; t < 120 && m.winner === null; t++) {
        if (m.round.result) m = nextRound(m);
        m.agents!.cd = [[0, 0, 0], [0, 0, 0]];
        m.agents!.ult = [99, 99];
        const p = m.round.turn;
        for (const id of abilitiesOf(m.agents!.picks[p])) {
          if (abilityBlocked(m.round, m.agents!, id)) continue;
          const us = abilityUses(m.round, m.agents!, id);
          for (const u of us.slice(0, 6)) {
            assert.equal(checkMove(m, u), null);
            const out = applyMove(m, u).state;
            assert.deepEqual(JSON.parse(JSON.stringify(out)), out);
          }
        }
        const mv = legalMoves(m);
        m = applyMove(m, mv[Math.floor(r() * mv.length)]).state;
      }
    }
  }
});

test('save and resume: a match with agents survives JSON and plays on identically', () => {
  let m = newMatch('rotating', 0, ['echo', 'drift']);
  const r1 = rng(42);
  for (let i = 0; i < 9; i++) for (const a of agentBotTurn(m, r1, AGENT_BOT)) m = play(m, a);
  const saved = JSON.parse(JSON.stringify(m)) as MatchState;
  assert.deepEqual(saved, m);
  const ra = rng(7);
  const rb = rng(7);
  let a = m;
  let b = saved;
  for (let i = 0; i < 12 && a.winner === null; i++) {
    if (a.round.result) {
      a = nextRound(a);
      b = nextRound(b);
    }
    const ta = agentBotTurn(a, ra, AGENT_BOT);
    const tb = agentBotTurn(b, rb, AGENT_BOT);
    assert.deepEqual(tb, ta);
    for (const x of ta) a = applyMove(a, x).state;
    for (const x of tb) b = applyMove(b, x).state;
  }
  assert.deepEqual(b, a);
});
