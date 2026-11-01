// Bigger balance runs for exploring rule changes by hand:
//   npm run simulate -- [games] [seed]          classic bot-vs-bot rounds
//   npm run simulate -- agents [matches] [seeds] [modes] [simple]  the Agents sweep: every pairing
import { simulate } from '../src/sim/bot.ts';
import { agentSweep, printSweep } from '../src/sim/sweep.ts';

if (process.argv[2] === 'agents') {
  const matches = Number(process.argv[3] ?? 34);
  const seeds = (process.argv[4] ?? '1,2,3').split(',').map(Number);
  const modes = (process.argv[5] ?? 'rotating,cascade').split(',') as ('rotating' | 'cascade')[];
  const simple = process.argv[6] === 'simple';
  for (const mode of modes) {
    const t0 = Date.now();
    const r = agentSweep(mode, { matchesPerSeed: matches, seeds, noises: [0.1, 0.3], simple });
    if (simple) console.log('(Simple rules)');
    console.log(printSweep(r));
    console.log(`(${((Date.now() - t0) / 1000).toFixed(0)} s)\n`);
  }
} else {
  const games = Number(process.argv[2] ?? 1000);
  const seed = Number(process.argv[3] ?? 1);
  for (const mode of ['rotating', 'cascade'] as const) {
    for (const noise of [0.1, 0.4, 2]) {
      const s = simulate(mode, games, seed, noise);
      const decisive = s.firstWins + s.secondWins;
      console.log(
        `${mode.padEnd(8)} noise ${String(noise).padEnd(3)}  first ${((100 * s.firstWins) / decisive).toFixed(1)}% of decisive` +
          `  draws ${((100 * s.draws) / s.games).toFixed(1)}%  median ${s.medianTurns} turns`,
      );
    }
  }
}
