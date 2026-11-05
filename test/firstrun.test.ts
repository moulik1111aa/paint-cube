// The first-time tutorial: the watch-first demo and the coached practice game both play
// through the real rules, teach what they say they teach, and end in the right win.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BASICS, lessonMove, lessonStart, stepMoves } from '../src/ui/lessons.ts';
import { PRACTICE } from '../src/ui/coach.ts';
import { applyMove, checkMove, legalMoves, newMatch, type MatchState } from '../src/core/match.ts';
import type { RotatingState } from '../src/core/rotating.ts';

const VISIBLE = new Set([0, 3, 6, 9, 12, 15, 18, 21, 24, 7, 8, 16, 17, 25, 26, 19, 20, 22, 23]);

test('the demo plays the plain game legally: a block, a fade, then a twist that wins for Orange', () => {
  let m = lessonStart(BASICS);
  assert.equal(m.agents, undefined, 'no agents in the demo');
  let faded = false;
  let twistWon = false;
  let ended = -1;
  BASICS.steps.forEach((s, i) => {
    for (const mv of stepMoves(BASICS, s, m)) {
      assert.equal(checkMove(m, mv), null, `step ${i}: ${JSON.stringify(mv)} is illegal`);
      const out = lessonMove(m, mv);
      if (out.events.some((e) => e.type === 'faded' && e.player === 0)) faded = true;
      m = out.state;
      if (m.round.result) {
        twistWon = mv.kind === 'twist' && m.round.result.winner === 0;
        ended = i;
      }
    }
    if (ended < 0) assert.equal(m.round.result, null, `step ${i} ended the round early`);
  });
  assert.ok(faded, "Orange's oldest mark fades");
  assert.ok(twistWon, 'a twist wins the round for Orange');
  assert.ok(BASICS.steps[ended].ends, 'the winning step is marked');
});

test('in the demo, painting the winning block would fade Orange’s oldest mark, so only the twist wins', () => {
  let m = lessonStart(BASICS);
  const steps = BASICS.steps.slice(0, -2);
  for (const s of steps) for (const mv of stepMoves(BASICS, s, m)) m = lessonMove(m, mv).state;
  assert.equal(m.round.turn, 0);
  const paintWins = legalMoves(m).filter((mv) => mv.kind === 'place' && applyMove(m, mv).state.round.result?.winner === 0);
  assert.deepEqual(paintWins, []);
});

test('the practice game: every guided move is legal and visible, the computer never wins early, and the twist wins', () => {
  let m: MatchState = newMatch('rotating', 0);
  PRACTICE.forEach((t, i) => {
    assert.equal(m.round.turn, 0, `turn ${i}: the player's turn`);
    assert.equal(checkMove(m, t.you), null, `turn ${i}: ${JSON.stringify(t.you)}`);
    for (const c of t.focus) assert.ok(VISIBLE.has(c), `turn ${i}: focus ${c} is visible`);
    if (t.you.kind === 'place') assert.ok(t.focus.includes(t.you.cell), `turn ${i}: the move's block glows`);
    m = applyMove(m, t.you).state;
    if (i < PRACTICE.length - 1) {
      assert.equal(m.round.result, null, `turn ${i}: no early end`);
      assert.ok(t.pc, `turn ${i}: the computer replies`);
      // The computer could not have won instead of the scripted reply.
      const pcWins = legalMoves(m).filter((mv) => applyMove(m, mv).state.round.result?.winner === 1);
      assert.deepEqual(pcWins, [], `turn ${i}: the computer had a win`);
      assert.equal(checkMove(m, t.pc!), null, `turn ${i}: the reply is legal`);
      m = applyMove(m, t.pc!).state;
    }
  });
  assert.equal(m.round.result?.winner, 0, 'the twist wins');
  assert.equal(PRACTICE[PRACTICE.length - 1].you.kind, 'twist');
});

test('the practice game teaches what it says: you block a row, your oldest mark fades, the computer blocks yours', () => {
  let m: MatchState = newMatch('rotating', 0);
  const r = () => m.round as RotatingState;
  // Turn 3 (index 2): the computer has two in a row; the guided move is the third block.
  for (let i = 0; i < 2; i++) m = applyMove(applyMove(m, PRACTICE[i].you).state, PRACTICE[i].pc!).state;
  const block = PRACTICE[2].you;
  assert.equal(block.kind, 'place');
  const threat = legalMoves(m).filter((mv) => mv.kind === 'place' && applyMove({ ...m, round: { ...r(), turn: 1 } } as MatchState, mv).state.round.result?.winner === 1);
  assert.deepEqual(threat.map((mv) => (mv.kind === 'place' ? mv.cell : -1)), [block.kind === 'place' ? block.cell : -1]);
  m = applyMove(applyMove(m, PRACTICE[2].you).state, PRACTICE[2].pc!).state;
  // Turn 4: your 4th mark fades your oldest.
  const out = applyMove(m, PRACTICE[3].you);
  assert.ok(out.events.some((e) => e.type === 'faded' && e.player === 0));
});
