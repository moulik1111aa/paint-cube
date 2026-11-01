// Every show-me lesson plays through the real rules: each step's moves are legal, the
// narration matches what happens (wet paint where it says wet, no early round end), and
// the step marked as the winning one really wins.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ABILITY_TEXT } from '../src/ui/agents-ui.ts';
import { ALL_TOPICS, abilityLesson, lessonMove, lessonPowers, lessonStart, stepMoves, topicLesson, topicsFor, type Lesson } from '../src/ui/lessons.ts';
import { decorOf, type AbilityId } from '../src/core/agents.ts';
import type { MatchState } from '../src/core/match.ts';

const DEBUG = !!process.env.LESSON_DEBUG;

function play(l: Lesson): MatchState {
  let m = lessonStart(l);
  assert.equal(m.round.result, null, `${l.key}: setup ended the round`);
  l.steps.forEach((s, i) => {
    if (s.reset) m = lessonStart(l, s.reset);
    for (const mv of stepMoves(l, s, m)) {
      const out = lessonMove(m, mv, l.realTimers);
      assert.equal(!!out.state.agents!.simple, !!l.simple, `${l.key}: rule set`);
      m = out.state;
      if (DEBUG) console.log(l.key, i, JSON.stringify(mv), out.events.map((e) => e.type).join(','), 'wet', decorOf(m.round, m.agents!).wet, 'cells', m.round.cells.map((c) => (c === null ? '.' : c)).join(''));
    }
    if (s.ends) assert.notEqual(m.round.result, null, `${l.key} step ${i}: should end the round`);
    else assert.equal(m.round.result, null, `${l.key} step ${i}: ended the round early (${JSON.stringify(m.round.result)})`);
    for (const c of s.focus ?? []) assert.ok(c >= 0 && c < 27);
  });
  return m;
}

test('topic lessons play legally', () => {
  for (const t of ALL_TOPICS) play(topicLesson(t));
});

test('every power has a Twist and a Cascade lesson that play legally and use the power', () => {
  for (const id of lessonPowers(false)) {
    for (const mode of ['rotating', 'cascade'] as const) {
      const l = abilityLesson(id, mode);
      let used = false;
      let m = lessonStart(l);
      for (const s of l.steps) {
        if (s.reset) m = lessonStart(l, s.reset);
        for (const mv of stepMoves(l, s, m)) {
          if (mv.kind === 'ability' && mv.id === id) used = true;
          m = lessonMove(m, mv).state;
        }
      }
      assert.ok(used, `${l.key}: never uses ${id}`);
      play(l);
    }
  }
});

test('the wet paint lesson shows a wet line that does not count, then one that dries and wins', () => {
  const l = topicLesson('wet');
  let m = lessonStart(l);
  for (const mv of l.steps[1].moves!) m = lessonMove(m, mv).state;
  assert.ok(decorOf(m.round, m.agents!).wet.includes(25));
  for (const mv of l.steps[2].moves!) m = lessonMove(m, mv).state;
  assert.deepEqual([24, 25, 26].map((c) => m.round.cells[c]), [0, 0, 0]);
  assert.equal(m.round.result, null);
  const end = play(l);
  assert.equal(end.round.result?.winner, 0);
});

test('Simple lessons: every topic and every Simple power plays legally and uses the power', () => {
  for (const t of topicsFor(true)) play(topicLesson(t, true));
  for (const id of lessonPowers(true)) {
    for (const mode of ['rotating', 'cascade'] as const) {
      const l = abilityLesson(id, mode, true);
      assert.ok(l.simple);
      let used = false;
      let m = lessonStart(l);
      for (const s of l.steps) {
        for (const mv of stepMoves(l, s, m)) {
          if (mv.kind === 'ability' && mv.id === id) used = true;
          m = lessonMove(m, mv).state;
        }
      }
      assert.ok(used, `${l.key}: never uses ${id}`);
      play(l);
    }
  }
});
