// Agents balance, as test code: seeded bot-vs-bot matches for every pairing of the
// four agents (mirrors included) in both modes, over three seeds and two noise levels
// (204 matches per pairing), plus each agent against a bot that never uses its powers.
// This is the full sweep (`npm run simulate -- agents` prints the same numbers; the
// tuning log is in docs/agents-balance.md), run across all cores to stay quick.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { mergeSweeps, printSweep, sweepFailures, type SweepOptions, type SweepResult } from '../src/sim/sweep.ts';
import { AGENT_BOT, agentBotTurn } from '../src/sim/bot.ts';
import { AGENT_IDS } from '../src/core/agents.ts';
import { applyMove, checkMove, newMatch, nextRound } from '../src/core/match.ts';
import { rng } from '../src/core/rng.ts';

// The same seeds and size as `npm run simulate -- agents` (204 matches per pairing),
// sliced by seed and noise level and spread over every core.
const OPTIONS: SweepOptions = { matchesPerSeed: 34, seeds: [1, 2, 3], noises: [0.1, 0.3] };

function slice(mode: 'rotating' | 'cascade', seed: number, noise: number): Promise<SweepResult> {
  return new Promise((resolve, reject) => {
    const options: SweepOptions = { ...OPTIONS, seeds: [seed], noises: [noise] };
    const w = new Worker(new URL('./sweep-worker.ts', import.meta.url), { workerData: { mode, options } });
    w.once('message', (r) => {
      void w.terminate();
      resolve(r);
    });
    w.once('error', reject);
  });
}

/** Run every slice through a pool of workers, one per core. */
async function sweepAll(): Promise<Record<'rotating' | 'cascade', SweepResult>> {
  const jobs: { mode: 'rotating' | 'cascade'; seed: number; noise: number }[] = [];
  for (const mode of ['rotating', 'cascade'] as const) for (const seed of OPTIONS.seeds) for (const noise of OPTIONS.noises) jobs.push({ mode, seed, noise });
  const out: Record<'rotating' | 'cascade', SweepResult[]> = { rotating: [], cascade: [] };
  let next = 0;
  const lane = async () => {
    while (next < jobs.length) {
      const j = jobs[next++];
      out[j.mode].push(await slice(j.mode, j.seed, j.noise));
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(jobs.length, availableParallelism())) }, lane));
  return { rotating: mergeSweeps(out.rotating), cascade: mergeSweeps(out.cascade) };
}

const all = sweepAll();
const runs = { rotating: all.then((r) => r.rotating), cascade: all.then((r) => r.cascade) };

for (const mode of ['rotating', 'cascade'] as const) {
  test(`${mode}: every agent pairing is balanced (${OPTIONS.matchesPerSeed * OPTIONS.seeds.length * OPTIONS.noises.length} matches per pairing)`, { timeout: 600_000 }, async () => {
    const r = await runs[mode];
    const fails = sweepFailures(r);
    if (fails.length) console.log(printSweep(r));
    assert.deepEqual(fails, [], printSweep(r));
    // The checks, spelled out (sweepFailures covers them all):
    for (const p of r.pairs) assert.equal(p.matches, OPTIONS.matchesPerSeed * OPTIONS.seeds.length * OPTIONS.noises.length);
    for (const id of AGENT_IDS) assert.ok(r.baseline[id].played > 0);
  });
}

test('the bot never picks an illegal action, with or without powers', () => {
  const random = rng(77);
  for (const mode of ['rotating', 'cascade'] as const) {
    for (const a of AGENT_IDS) {
      let m = newMatch(mode, 0, [a, AGENT_IDS[(AGENT_IDS.indexOf(a) + 1) % 4]]);
      while (m.winner === null) {
        if (m.round.result) m = nextRound(m);
        for (const act of agentBotTurn(m, random, { ...AGENT_BOT, noise: 0.3 })) {
          assert.equal(checkMove(m, act), null, JSON.stringify(act));
          m = applyMove(m, act).state;
          if (m.round.result) break;
        }
      }
    }
  }
});
