import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COLUMNS, index, linesOf, type Player } from '../src/core/geometry.ts';
import { TARGET, applyCascade, checkCascade, legalCascade, newCascade, type CascadeState } from '../src/core/cascade.ts';
import { rng } from '../src/core/rng.ts';

const drop = (column: number) => ({ kind: 'drop', column }) as const;
function setup(p0: number[], p1: number[], turn: Player = 0, scores: [number, number] = [0, 0]): CascadeState {
  const s = newCascade(turn);
  const cells = s.cells.slice();
  p0.forEach((c) => (cells[c] = 0));
  p1.forEach((c) => (cells[c] = 1));
  return { ...s, cells, scores };
}

test('a drop lands in the lowest empty cell of its column and alternates turns', () => {
  let r = applyCascade(newCascade(0), drop(4));
  assert.equal(r.state.cells[COLUMNS[4][0]], 0);
  assert.deepEqual(r.events, [{ type: 'placed', player: 0, cell: COLUMNS[4][0], column: 4 }]);
  assert.equal(r.state.turn, 1);
  r = applyCascade(r.state, drop(4));
  assert.equal(r.state.cells[COLUMNS[4][1]], 1);
});

test('a full column and bad columns are refused', () => {
  const s = setup([COLUMNS[0][0], COLUMNS[0][2]], [COLUMNS[0][1]]);
  assert.equal(checkCascade(s, drop(0)), 'column-full');
  assert.equal(checkCascade(s, drop(9)), 'not-a-column');
  assert.equal(legalCascade(s).length, 8);
});

test('a completed line scores 1, shatters, and the pieces above fall', () => {
  // Player 0 owns (1,0,0) and (2,0,0); player 1 sits on top of (1,0,0).
  const s = setup([index(1, 0, 0), index(2, 0, 0)], [index(1, 0, 1)]);
  const r = applyCascade(s, drop(0));
  assert.deepEqual(r.state.scores, [1, 0]);
  assert.equal(r.state.cells[index(1, 0, 0)], 1, 'player 1 fell down');
  assert.equal(r.state.cells[index(1, 0, 1)], null);
  assert.equal(r.state.cells[index(0, 0, 0)], null);
  const types = r.events.map((e) => e.type);
  assert.deepEqual(types, ['placed', 'lineCompleted', 'scored', 'shattered', 'fell']);
  assert.equal(r.state.result, null);
});

// Wave 1: player 0 completes the bottom row y=0. Player 1's piece above (2,0,0) falls
// into it and completes player 1's line along x=2: wave 2, worth 2 per line.
const CHAIN_P0 = [index(1, 0, 0), index(2, 0, 0)];
const CHAIN_P1 = [index(2, 1, 0), index(2, 2, 0), index(2, 0, 1)];

test('a 2-wave chain scores 1 per line, then 2 per line, even as an own goal', () => {
  const r = applyCascade(setup(CHAIN_P0, CHAIN_P1), drop(0));
  assert.deepEqual(r.state.scores, [1, 2]);
  const scored = r.events.filter((e) => e.type === 'scored');
  assert.deepEqual(scored, [
    { type: 'scored', player: 0, points: 1, wave: 1, total: 1 },
    { type: 'scored', player: 1, points: 2, wave: 2, total: 2 },
  ]);
  assert.equal(linesOf(r.state.cells, 0).length + linesOf(r.state.cells, 1).length, 0, 'no completed line is left on the board');
});

test('first to 5 wins', () => {
  const r = applyCascade(setup([index(1, 0, 0), index(2, 0, 0)], [], 0, [TARGET - 1, 0]), drop(0));
  assert.deepEqual(r.state.result, { winner: 0 });
  assert.deepEqual(r.events.at(-1), { type: 'roundOver', winner: 0 });
  assert.equal(checkCascade(r.state, drop(1)), 'round-over');
});

test('both past 5 in one chain: higher score wins, a tie goes to the mover', () => {
  const tie = applyCascade(setup(CHAIN_P0, CHAIN_P1, 0, [4, 3]), drop(0));
  assert.deepEqual(tie.state.scores, [5, 5]);
  assert.equal(tie.state.result?.winner, 0);
  const higher = applyCascade(setup(CHAIN_P0, CHAIN_P1, 0, [4, 4]), drop(0));
  assert.deepEqual(higher.state.scores, [5, 6]);
  assert.equal(higher.state.result?.winner, 1);
});

test('random play: no floating pieces, no lines left standing, always finishes, JSON-safe', () => {
  const r = rng(99);
  for (let g = 0; g < 300; g++) {
    let s = newCascade((g % 2) as Player);
    let turns = 0;
    while (!s.result) {
      const moves = legalCascade(s);
      assert.ok(moves.length > 0, 'a move is always available');
      s = applyCascade(s, moves[Math.floor(r() * moves.length)]).state;
      turns++;
      for (const col of COLUMNS) {
        const filled = col.map((c) => s.cells[c] !== null);
        assert.ok(!(filled[1] && !filled[0]) && !(filled[2] && !filled[1]), 'no gaps under a piece');
      }
      assert.equal(linesOf(s.cells, 0).length + linesOf(s.cells, 1).length, 0);
      assert.deepEqual(JSON.parse(JSON.stringify(s)), s);
    }
    assert.ok(Math.max(...s.scores) >= TARGET);
    assert.ok(turns < 200);
  }
});
