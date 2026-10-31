import { test } from 'node:test';
import assert from 'node:assert/strict';
import { type Player } from '../src/core/geometry.ts';
import { applyMove, checkMove, legalMoves, newMatch, nextRound, randomMove, type MatchState } from '../src/core/match.ts';
import { newRotating, type RotatingState } from '../src/core/rotating.ts';
import { rng } from '../src/core/rng.ts';

/** Put the current round one move from a win for `p` (rotating: owns 0 and 1, place 2). */
function rigged(m: MatchState, p: Player): MatchState {
  const r: RotatingState = { ...newRotating(p), turn: p };
  const cells = r.cells.slice();
  cells[0] = p;
  cells[1] = p;
  return { ...m, round: { ...r, cells, marks: p === 0 ? [[0, 1], []] : [[], [0, 1]] } };
}
const win = { kind: 'place', cell: 2 } as const;

test('a match starts with round 1 and the chosen starter', () => {
  const m = newMatch('cascade', 1);
  assert.equal(m.round.mode, 'cascade');
  assert.equal(m.round.turn, 1);
  assert.equal(m.roundNumber, 1);
  assert.deepEqual(m.wins, [0, 0]);
  assert.equal(checkMove(m, { kind: 'place', cell: 0 }), 'wrong-mode');
});

test('round wins are counted, the starter alternates, and 2 wins take the match', () => {
  let m = newMatch('rotating', 0);
  let r = applyMove(rigged(m, 0), win);
  assert.deepEqual(r.events.at(-1), { type: 'roundWon', winner: 0, round: 1, wins: [1, 0] });
  m = nextRound(r.state);
  assert.equal(m.roundNumber, 2);
  assert.equal(m.starter, 1);
  assert.equal(m.round.turn, 1);
  assert.equal(m.round.result, null);

  r = applyMove(rigged(m, 1), win);
  m = nextRound(r.state);
  assert.equal(m.starter, 0);
  assert.deepEqual(m.wins, [1, 1]);

  r = applyMove(rigged(m, 0), win);
  assert.equal(r.state.winner, 0);
  assert.deepEqual(r.events.slice(-2).map((e) => e.type), ['roundWon', 'matchWon']);
  assert.deepEqual(r.events.at(-1), { type: 'matchWon', winner: 0, wins: [2, 1] });
  assert.equal(checkMove(r.state, { kind: 'place', cell: 5 }), 'match-over');
  assert.throws(() => nextRound(r.state));
});

test('a drawn round counts for nobody and is replayed with the other starter', () => {
  const m = newMatch('rotating', 0);
  const drawn: MatchState = { ...m, round: { ...m.round, turns: 39 } as RotatingState };
  const r = applyMove(drawn, { kind: 'place', cell: 0 });
  assert.deepEqual(r.events.at(-1), { type: 'roundWon', winner: null, round: 1, wins: [0, 0] });
  const next = nextRound(r.state);
  assert.equal(next.roundNumber, 2);
  assert.equal(next.starter, 1);
});

test('next round is refused while the round is still being played', () => {
  assert.throws(() => nextRound(newMatch('cascade', 0)));
});

test('whole random matches finish in both modes and stay JSON-safe', () => {
  const r = rng(5);
  for (const mode of ['rotating', 'cascade'] as const) {
    for (let g = 0; g < 40; g++) {
      let m = newMatch(mode, (g % 2) as Player);
      while (m.winner === null) {
        if (m.round.result) m = nextRound(m);
        const mv = randomMove(m, r);
        assert.equal(checkMove(m, mv), null);
        m = applyMove(m, mv).state;
        assert.deepEqual(JSON.parse(JSON.stringify(m)), m);
      }
      assert.equal(Math.max(...m.wins), 2);
      assert.equal(legalMoves(m).length, 0);
    }
  }
});
