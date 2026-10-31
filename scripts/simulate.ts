// Bigger balance runs for exploring rule changes by hand:
//   npm run simulate -- [games] [seed]
import { simulate } from '../src/sim/bot.ts';

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
