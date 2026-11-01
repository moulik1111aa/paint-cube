// Simple rules (the default for Agents): no wet paint; on a turn you use a power you
// can't finish a line of your own; powers once per round; every ultimate ready after
// the same number of your turns; Shield, Relocate and Freeze.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { type Player } from '../src/core/geometry.ts';
import { applyMove, checkMove, newMatch, nextRound, type MatchState, type Move } from '../src/core/match.ts';
import { ONCE, SIMPLE_POWERS, SIMPLE_TUNING, abilitiesOf, abilityBlocked, abilityUses, decorOf, type AbilityId, type AbilityUse, type AgentId } from '../src/core/agents.ts';
import type { RotatingState } from '../src/core/rotating.ts';
import type { CascadeState } from '../src/core/cascade.ts';

const use = (id: AbilityId, cells?: number[]): AbilityUse => ({ kind: 'ability', id, ...(cells ? { cells } : {}) });
const place = (cell: number): Move => ({ kind: 'place', cell });
const drop = (column: number): Move => ({ kind: 'drop', column });

function rot(picks: [AgentId, AgentId], marks: [number[], number[]], turn: Player = 0): MatchState {
  const m = newMatch('rotating', turn, picks, true);
  const r = m.round as RotatingState;
  marks[0].forEach((c) => (r.cells[c] = 0));
  marks[1].forEach((c) => (r.cells[c] = 1));
  r.marks = [marks[0].slice(), marks[1].slice()];
  r.turn = turn;
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

test('Simple rosters: Stencil and Echo swap their trickiest powers; ultimates stay', () => {
  assert.deepEqual(abilitiesOf('stencil', true), ['tape', 'shield', 'relocate', 'lockdown']);
  assert.deepEqual(abilitiesOf('echo', true), ['afterimage', 'freeze', 'reverb', 'rewind']);
  assert.deepEqual(abilitiesOf('stencil'), ['tape', 'fixative', 'wetFloor', 'lockdown'], 'Pro keeps the original powers');
  for (const a of Object.keys(SIMPLE_POWERS) as AgentId[]) assert.equal(SIMPLE_POWERS[a].length, 3);
  assert.equal(newMatch('rotating', 0, ['blitz', 'echo'], true).agents!.simple, true);
  assert.equal(newMatch('rotating', 0, ['blitz', 'echo']).agents!.simple, undefined);
});

test('no wet paint: a power’s mark is dry, and nothing shows as wet', () => {
  let m = rot(['blitz', 'stencil'], [[], [9]]);
  m = play(m, use('doubleTap', [0]), place(4));
  assert.equal(m.agents!.wet[0], 0);
  assert.deepEqual(decorOf(m.round, m.agents!).wet, []);
});

test('power turn: after a power you can’t finish your own row; next turn you can', () => {
  // Orange holds 0 and 1. After Overspray, painting 2 would finish the row: refused.
  let m = rot(['blitz', 'stencil'], [[0, 1], [9, 10]]);
  m = play(m, use('overspray', [9]));
  assert.equal(checkMove(m, place(2)), 'power-turn');
  m = play(m, place(22));
  assert.ok(!m.round.result);
  m = play(m, place(9));
  assert.equal(checkMove(m, place(2)), null, 'a turn without a power can finish it');
  // Without a power, finishing a row is fine.
  let n = rot(['blitz', 'stencil'], [[0, 1], [9, 10]]);
  n = play(n, place(2));
  assert.equal(n.round.result?.winner, 0);
});

test('power turn: a power that would itself finish your row is not offered', () => {
  const m = rot(['blitz', 'stencil'], [[0, 1], [9, 10]]);
  const uses = abilityUses(m.round, m.agents!, 'doubleTap');
  assert.ok(uses.length > 0);
  assert.ok(!uses.some((u) => u.cells![0] === 2), 'Double Tap on 2 would finish 0-1-2');
  assert.equal(checkMove(m, use('doubleTap', [2])), 'bad-target');
});

test('powers are once per round and every one is ready from the first turn; a new round resets them', () => {
  let m = rot(['blitz', 'stencil'], [[], [9]]);
  for (const id of ['doubleTap', 'shove', 'overspray'] as AbilityId[]) assert.notEqual(abilityBlocked(m.round, m.agents!, id), 'cooldown');
  m = play(m, use('overspray', [9]), place(0));
  assert.equal(m.agents!.cd[0][2], ONCE);
  m = play(m, place(18), place(4), place(19));
  assert.equal(abilityBlocked(m.round, m.agents!, 'overspray'), 'cooldown');
  // A new round: ready again.
  m = { ...m, round: { ...m.round, result: { winner: 0, line: [0, 1, 2] } } as RotatingState };
  m = nextRound(m);
  assert.deepEqual(m.agents!.cd, [[0, 0, 0], [0, 0, 0]]);
});

test('every ultimate is ready after the same number of your own turns', () => {
  const cost = SIMPLE_TUNING.rotating.ultCost; // Twist: all the same
  assert.ok(Object.values(cost).every((c) => c === cost.chrome));
  let m = newMatch('rotating', 0, ['echo', 'drift'], true);
  const free = [0, 9, 1, 10, 3, 12, 4, 21, 6, 22, 7, 25];
  for (let i = 0; i < 2 * cost.rewind; i++) m = play(m, place(free[i]));
  assert.equal(m.agents!.ult[0], cost.rewind);
  assert.equal(abilityBlocked(m.round, m.agents!, 'rewind'), null);
});

test('Shield: the mark can’t be wiped or moved and doesn’t fade, but its layer still twists', () => {
  let m = rot(['stencil', 'blitz'], [[0, 1, 2 + 18], [9]]);
  m = play(m, use('shield', [0]), place(24));
  assert.equal(m.round.cells[0], 0, 'shielded mark did not fade');
  assert.ok(!abilityUses(m.round, m.agents!, 'overspray').some((u) => u.cells![0] === 0));
  assert.equal(checkMove(m, { kind: 'twist', twist: { axis: 2, slice: 0, dir: 1 } }), null, 'its layer can twist');
});

test('Relocate: slide one of your marks into an empty cell next to it (Cascade: onto another column)', () => {
  let m = rot(['stencil', 'blitz'], [[0], [9]]);
  m = play(m, use('relocate', [0, 3]), place(4));
  assert.equal(m.round.cells[0], null);
  assert.equal(m.round.cells[3], 0);
  assert.equal(checkMove(rot(['stencil', 'blitz'], [[0], [9]]), use('relocate', [0, 24])), 'bad-target', 'only next to it');
  let c = newMatch('cascade', 0, ['stencil', 'blitz'], true);
  (c.round as CascadeState).cells[0] = 0;
  c = play(c, use('relocate', [0, 4]), drop(8));
  assert.equal(c.round.cells[0], null);
  assert.equal(c.round.cells[4], 0);
});

test('Freeze: the other player can’t use a power on their next turn, then can again', () => {
  let m = rot(['echo', 'blitz'], [[], [9]]);
  m = play(m, use('freeze'), place(0));
  assert.equal(abilityBlocked(m.round, m.agents!, 'doubleTap'), 'frozen');
  m = play(m, place(10), place(1));
  assert.equal(abilityBlocked(m.round, m.agents!, 'doubleTap'), null);
});

test('Cascade power turn: a drop that would score your own line is refused', () => {
  let m = newMatch('cascade', 0, ['blitz', 'stencil'], true);
  const r = m.round as CascadeState;
  r.cells[0] = 0;
  r.cells[1] = 0;
  r.cells[4] = 1;
  m.agents!.cd = [[0, 0, 0], [0, 0, 0]]; // (Overspray wakes up later in Cascade)
  m = play(m, use('overspray', [4]));
  assert.equal(checkMove(m, drop(2)), 'power-turn');
  const n = play(newMatch('cascade', 0, ['blitz', 'stencil'], true), drop(0), drop(4), drop(1), drop(5), drop(2));
  assert.ok((n.round as CascadeState).scores[0] >= 1, 'without a power, the line scores');
});
