// Balance guard: bot-vs-bot rounds on the real engine. If a rule change pushes the
// first player's share of decisive rounds outside 45-60%, or rounds get much shorter
// or longer, the build fails. Seeded, so the result is the same every run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulate } from '../src/sim/bot.ts';

const GAMES = 200;

for (const mode of ['rotating', 'cascade'] as const) {
  test(`${mode}: the first player wins 45-60% of decisive rounds`, () => {
    const s = simulate(mode, GAMES, 7, 0.1);
    const share = s.firstWins / (s.firstWins + s.secondWins);
    assert.ok(share >= 0.45 && share <= 0.6, `first-player share ${(share * 100).toFixed(1)}% (${JSON.stringify(s)})`);
    assert.ok(s.draws / s.games <= 0.15, `draw rate ${s.draws}/${s.games}`);
    const [lo, hi] = mode === 'rotating' ? [10, 30] : [20, 45];
    assert.ok(s.medianTurns >= lo && s.medianTurns <= hi, `median ${s.medianTurns} turns`);
  });
}
