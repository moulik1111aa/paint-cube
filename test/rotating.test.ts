import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CENTER, LINES, coord, index, linesOf, type Player } from '../src/core/geometry.ts';
import { TWISTS, inverse } from '../src/core/twist.ts';
import { DRAW_TURNS, MAX_MARKS, applyRotating, checkRotating, legalRotating, newRotating, roundWinner, type RotatingMove, type RotatingState } from '../src/core/rotating.ts';
import { rng } from '../src/core/rng.ts';

const place = (cell: number): RotatingMove => ({ kind: 'place', cell });
function play(s: RotatingState, ...moves: RotatingMove[]): RotatingState {
  for (const m of moves) s = applyRotating(s, m).state;
  return s;
}
/** A state built by hand: marks oldest first, `turn` to move. */
function setup(marks: [number[], number[]], turn: Player = 0, extra: Partial<RotatingState> = {}): RotatingState {
  const s = newRotating(turn);
  const cells = s.cells.slice();
  marks[0].forEach((c) => (cells[c] = 0));
  marks[1].forEach((c) => (cells[c] = 1));
  return { ...s, cells, marks: [marks[0].slice(), marks[1].slice()], ...extra };
}

test('a new round is empty and the chosen player starts', () => {
  const s = newRotating(1);
  assert.equal(s.turn, 1);
  assert.ok(s.cells.every((c) => c === null));
  assert.equal(s.result, null);
});

test('placing alternates turns; occupied cells and the Core are refused', () => {
  let s = play(newRotating(0), place(0));
  assert.equal(s.cells[0], 0);
  assert.equal(s.turn, 1);
  assert.equal(checkRotating(s, place(0)), 'occupied');
  assert.equal(checkRotating(s, place(CENTER)), 'core');
  assert.equal(checkRotating(s, place(27)), 'not-a-cell');
  s = play(s, place(1));
  assert.equal(s.cells[1], 1);
  assert.throws(() => applyRotating(s, place(CENTER)), /core/);
});

test('the oldest mark fades before the fourth lands, and cracking warns first', () => {
  let s = play(newRotating(0), place(0), place(20), place(4), place(25));
  const third = applyRotating(s, place(26));
  assert.deepEqual(third.events.find((e) => e.type === 'cracking'), { type: 'cracking', player: 0, cell: 0 });
  s = play(third.state, place(15));
  assert.equal(s.result, null);
  const fourth = applyRotating(s, place(10));
  const types = fourth.events.map((e) => e.type);
  assert.ok(types.indexOf('faded') < types.indexOf('placed'), 'fade happens before the new mark');
  assert.deepEqual(fourth.events.find((e) => e.type === 'faded'), { type: 'faded', player: 0, cell: 0 });
  assert.equal(fourth.state.cells[0], null);
  assert.deepEqual(fourth.state.marks[0], [4, 26, 10]);
  assert.equal(MAX_MARKS, 3);
});

test('a faded mark cannot complete the new line', () => {
  // Player 0 owns 0 and 1 (0 oldest) plus 20; placing 2 would make the line 0-1-2,
  // but 0 fades first, so there is no win.
  const s = setup([[0, 1, 20], [24, 26]], 0);
  const r = applyRotating(s, place(2));
  assert.equal(r.state.result, null);
  assert.equal(r.state.cells[0], null);
});

test('completing a line wins the round', () => {
  const s = setup([[0, 1], [24, 26]], 0);
  const r = applyRotating(s, place(2));
  assert.deepEqual(r.state.result, { winner: 0, line: [0, 1, 2] });
  assert.deepEqual(r.events.at(-1), { type: 'roundOver', winner: 0, line: [0, 1, 2] });
  assert.equal(checkRotating(r.state, place(5)), 'round-over');
});

test('a twist moves marks with the layer and keeps their ages', () => {
  const t = TWISTS[0];
  const s = setup([[index(0, 0, 0)], []], 0);
  const r = applyRotating(s, { kind: 'twist', twist: t });
  const ev = r.events.find((e) => e.type === 'twisted');
  assert.ok(ev && ev.type === 'twisted');
  const to = ev.moves[0].to;
  assert.equal(r.state.cells[to], 0);
  assert.deepEqual(r.state.marks[0], [to]);
  assert.equal(coord(to)[t.axis], t.slice);
});

test('no twisting on two of your turns in a row', () => {
  const s = play(newRotating(0), { kind: 'twist', twist: TWISTS[0] }, place(5));
  assert.equal(checkRotating(s, { kind: 'twist', twist: TWISTS[4] }), 'twisted-last-turn');
  assert.equal(checkRotating(s, place(6)), null);
});

test('no twist that undoes the twist made on the previous turn', () => {
  const t = TWISTS[7];
  const s = play(newRotating(0), place(0), { kind: 'twist', twist: t });
  assert.equal(checkRotating(s, { kind: 'twist', twist: inverse(t) }), 'undoes-last-twist');
  assert.equal(checkRotating(s, { kind: 'twist', twist: t }), null, 'the same direction again is fine');
  const later = play(s, place(3), place(4));
  assert.equal(checkRotating(later, { kind: 'twist', twist: inverse(t) }), null, 'only the immediately previous twist');
});

test('win priority: the mover wins when both have lines; the opponent wins when only they do', () => {
  const cells = Array(27).fill(null);
  [0, 1, 2].forEach((c) => (cells[c] = 0));
  [24, 25, 26].forEach((c) => (cells[c] = 1));
  assert.equal(roundWinner(cells, 1)?.winner, 1);
  assert.equal(roundWinner(cells, 0)?.winner, 0);
  cells[0] = null;
  assert.equal(roundWinner(cells, 0)?.winner, 1);
  assert.equal(roundWinner(Array(27).fill(null), 0), null);
});

test('a twist that completes only the opponent line hands them the round', () => {
  // Search seeded random positions for such a twist, then check the engine agrees.
  const r = rng(7);
  let found = false;
  for (let trial = 0; trial < 20000 && !found; trial++) {
    const free = Array.from({ length: 27 }, (_, i) => i).filter((i) => i !== CENTER);
    const pick = () => free.splice(Math.floor(r() * free.length), 1)[0];
    const s = setup([[pick(), pick(), pick()], [pick(), pick(), pick()]], 0);
    if (linesOf(s.cells, 0).length || linesOf(s.cells, 1).length) continue;
    for (const twist of TWISTS) {
      const out = applyRotating(s, { kind: 'twist', twist }).state;
      const mine = linesOf(out.cells, 0).length > 0;
      const theirs = linesOf(out.cells, 1).length > 0;
      if (!mine && theirs) {
        assert.equal(out.result?.winner, 1);
        found = true;
        break;
      }
    }
  }
  assert.ok(found, 'found an example');
});

test('a round with no line after the turn limit is a draw', () => {
  const s = setup([[0], [26]], 0, { turns: DRAW_TURNS - 1 });
  const r = applyRotating(s, place(5));
  assert.deepEqual(r.state.result, { winner: null });
  assert.deepEqual(r.events.at(-1), { type: 'roundOver', winner: null });
  assert.equal(DRAW_TURNS, 40);
});

test('random play keeps every invariant and survives a JSON round trip', () => {
  const r = rng(42);
  for (let g = 0; g < 300; g++) {
    let s = newRotating((g % 2) as Player);
    while (!s.result) {
      const moves = legalRotating(s);
      assert.ok(moves.length > 0);
      const m = moves[Math.floor(r() * moves.length)];
      assert.equal(checkRotating(s, m), null);
      s = applyRotating(s, m).state;
      assert.equal(s.cells[CENTER], null, 'Core stays empty');
      for (const p of [0, 1] as const) {
        assert.ok(s.marks[p].length <= MAX_MARKS);
        assert.equal(s.cells.filter((c) => c === p).length, s.marks[p].length);
        for (const c of s.marks[p]) assert.equal(s.cells[c], p);
      }
      assert.deepEqual(JSON.parse(JSON.stringify(s)), s);
    }
    assert.ok(s.turns <= DRAW_TURNS);
    if (s.result.winner !== null) assert.ok(LINES.some((l) => l.every((c) => s.cells[c] === s.result!.winner)));
  }
});
