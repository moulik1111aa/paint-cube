// The Agents balance sweep: every pairing of the four agents (mirrors included) plays
// whole bot-vs-bot matches over several seeds and noise levels, plus each agent against
// a bot that never uses powers (Classic play inside Agents rules). Used by
// test/agents-balance.test.ts (a smaller run) and `npm run simulate -- agents`.

import { AGENT_IDS, abilitiesOf, type AgentId } from '../core/agents.ts';
import { rng } from '../core/rng.ts';
import type { Player } from '../core/geometry.ts';
import { AGENT_BOT, agentBotMatch, type AgentBotOptions } from './bot.ts';

export interface SweepOptions {
  /** Matches per pairing, per seed, per noise level. */
  matchesPerSeed: number;
  seeds: number[];
  noises: number[];
  /** Matches per agent against the no-powers baseline, per seed and noise (default: same). */
  baselineMatches?: number;
  /** Simple rules (default: Pro). */
  simple?: boolean;
}

export interface PairResult {
  a: AgentId;
  b: AgentId;
  matches: number;
  /** Matches won by `a` (for a mirror: by the first seat). */
  aWins: number;
}

export interface SweepResult {
  mode: 'rotating' | 'cascade';
  /** Simple rules. */
  simple?: boolean;
  pairs: PairResult[];
  /** Per agent: matches won / played against the other three agents (mirrors excluded). */
  agentShare: Record<AgentId, { won: number; played: number }>;
  starterRoundWins: number;
  decisiveRounds: number;
  drawnRounds: number;
  rounds: number;
  medianTurns: number;
  /** How many rounds lasted each number of turns (index = turns). */
  turnHist: number[];
  /** Per agent, per ability: rounds in which it was used / rounds that agent played. */
  usage: Record<AgentId, Record<string, { used: number; rounds: number }>>;
  /** Per agent: winning turns by the ability used on them ('-' = none). */
  winningTurns: Record<AgentId, Record<string, number>>;
  /** Per agent: matches won / played against the no-powers baseline. */
  baseline: Record<AgentId, { won: number; played: number }>;
}

const blank = <T>(f: () => T): Record<AgentId, T> => Object.fromEntries(AGENT_IDS.map((id) => [id, f()])) as Record<AgentId, T>;

export function agentSweep(mode: 'rotating' | 'cascade', o: SweepOptions): SweepResult {
  const res: SweepResult = {
    mode,
    simple: !!o.simple,
    pairs: [],
    agentShare: blank(() => ({ won: 0, played: 0 })),
    starterRoundWins: 0,
    decisiveRounds: 0,
    drawnRounds: 0,
    rounds: 0,
    medianTurns: 0,
    turnHist: [],
    usage: blank(() => ({})),
    winningTurns: blank(() => ({})),
    baseline: blank(() => ({ won: 0, played: 0 })),
  };
  const simple = !!o.simple;
  for (const id of AGENT_IDS) for (const ab of abilitiesOf(id, simple)) res.usage[id][ab] = { used: 0, rounds: 0 };
  const turns: number[] = [];
  const bot = (noise: number, usePowers = true): AgentBotOptions => ({ ...AGENT_BOT, noise, usePowers });

  for (const a of AGENT_IDS) {
    for (const b of AGENT_IDS) {
      if (AGENT_IDS.indexOf(b) < AGENT_IDS.indexOf(a)) continue;
      const pr: PairResult = { a, b, matches: 0, aWins: 0 };
      for (const seed of o.seeds) {
        for (const noise of o.noises) {
          const random = rng(seed * 7919 + Math.round(noise * 1000) + AGENT_IDS.indexOf(a) * 131 + AGENT_IDS.indexOf(b) * 17);
          for (let g = 0; g < o.matchesPerSeed; g++) {
            // Alternate seats and the first starter so neither side has an edge.
            const flip = g % 2 === 1;
            const picks: [AgentId, AgentId] = flip ? [b, a] : [a, b];
            const starter = (Math.floor(g / 2) % 2) as Player;
            const st = agentBotMatch(mode, picks, random, [bot(noise), bot(noise)], starter, simple);
            pr.matches++;
            const aSeat: Player = flip ? 1 : 0;
            if (st.winner === aSeat) pr.aWins++;
            res.starterRoundWins += st.starterRoundWins;
            res.decisiveRounds += st.decisiveRounds;
            res.drawnRounds += st.drawnRounds;
            res.rounds += st.rounds;
            turns.push(...st.roundTurns);
            for (const seat of [0, 1] as const) {
              const agent = picks[seat];
              for (const ab of abilitiesOf(agent, simple)) {
                const u = res.usage[agent][ab];
                u.rounds += st.rounds;
                u.used += st.roundsUsing[seat].get(ab) ?? 0;
              }
              for (const [k, n] of st.winningTurns[seat]) res.winningTurns[agent][k] = (res.winningTurns[agent][k] ?? 0) + n;
            }
            if (a !== b) {
              res.agentShare[a].played++;
              res.agentShare[b].played++;
              res.agentShare[st.winner === aSeat ? a : b].won++;
            }
          }
        }
      }
      res.pairs.push(pr);
    }
  }

  // Each agent against a bot that never uses its powers.
  const bm = o.baselineMatches ?? o.matchesPerSeed;
  for (const a of AGENT_IDS) {
    for (const seed of o.seeds) {
      for (const noise of o.noises) {
        const random = rng(seed * 104729 + Math.round(noise * 1000) + AGENT_IDS.indexOf(a) * 7);
        for (let g = 0; g < bm; g++) {
          const flip = g % 2 === 1;
          const other = AGENT_IDS[(AGENT_IDS.indexOf(a) + 1 + (g % 3)) % 4];
          const picks: [AgentId, AgentId] = flip ? [other, a] : [a, other];
          const opts: [AgentBotOptions, AgentBotOptions] = flip ? [bot(noise, false), bot(noise)] : [bot(noise), bot(noise, false)];
          const st = agentBotMatch(mode, picks, random, opts, (Math.floor(g / 2) % 2) as Player, simple);
          res.baseline[a].played++;
          if (st.winner === (flip ? 1 : 0)) res.baseline[a].won++;
        }
      }
    }
  }

  for (const t of turns) res.turnHist[t] = (res.turnHist[t] ?? 0) + 1;
  res.medianTurns = medianOf(res.turnHist);
  return res;
}

function medianOf(hist: readonly (number | null | undefined)[]): number {
  const total = hist.reduce<number>((a, b) => a + (b ?? 0), 0);
  let seen = 0;
  for (let t = 0; t < hist.length; t++) {
    seen += hist[t] ?? 0;
    if (seen > total / 2) return t;
  }
  return 0;
}

/** Add up sweeps of the same mode (e.g. slices run in parallel). */
export function mergeSweeps(rs: SweepResult[]): SweepResult {
  const m: SweepResult = JSON.parse(JSON.stringify(rs[0]));
  for (const r of rs.slice(1)) {
    r.turnHist.forEach((n, t) => (m.turnHist[t] = (m.turnHist[t] ?? 0) + (n ?? 0)));
    m.starterRoundWins += r.starterRoundWins;
    m.decisiveRounds += r.decisiveRounds;
    m.drawnRounds += r.drawnRounds;
    m.rounds += r.rounds;
    r.pairs.forEach((p, i) => {
      m.pairs[i].matches += p.matches;
      m.pairs[i].aWins += p.aWins;
    });
    for (const id of AGENT_IDS) {
      m.agentShare[id].won += r.agentShare[id].won;
      m.agentShare[id].played += r.agentShare[id].played;
      m.baseline[id].won += r.baseline[id].won;
      m.baseline[id].played += r.baseline[id].played;
      for (const ab of Object.keys(m.usage[id])) {
        m.usage[id][ab].used += r.usage[id][ab].used;
        m.usage[id][ab].rounds += r.usage[id][ab].rounds;
      }
      for (const [k, v] of Object.entries(r.winningTurns[id])) m.winningTurns[id][k] = (m.winningTurns[id][k] ?? 0) + v;
    }
  }
  m.medianTurns = medianOf(m.turnHist);
  return m;
}

const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : '-');

/** Whole-sweep checks; returns the list of failures (empty = balanced). */
export function sweepFailures(r: SweepResult): string[] {
  const f: string[] = [];
  const [lo, hi] = r.mode === 'rotating' ? [10, 30] : [20, 45];
  for (const id of AGENT_IDS) {
    const s = r.agentShare[id];
    const share = s.won / s.played;
    if (share < 0.4 || share > 0.6) f.push(`${id} wins ${pct(s.won, s.played)} of its matches (want 40-60%)`);
  }
  for (const p of r.pairs) {
    if (p.a === p.b) continue;
    const share = p.aWins / p.matches;
    if (share < 0.35 || share > 0.65) f.push(`${p.a} vs ${p.b}: ${pct(p.aWins, p.matches)} (want 35-65%)`);
  }
  const first = r.starterRoundWins / r.decisiveRounds;
  if (first < 0.45 || first > 0.6) f.push(`first player wins ${pct(r.starterRoundWins, r.decisiveRounds)} of decisive rounds (want 45-60%)`);
  if (r.drawnRounds / r.rounds > 0.15) f.push(`draws ${pct(r.drawnRounds, r.rounds)} (want <= 15%)`);
  if (r.medianTurns < lo || r.medianTurns > hi) f.push(`median round ${r.medianTurns} turns (want ${lo}-${hi})`);
  for (const id of AGENT_IDS) {
    for (const [ab, u] of Object.entries(r.usage[id])) {
      if (u.used / u.rounds < 0.1) f.push(`${id} ${ab} used in ${pct(u.used, u.rounds)} of rounds (want >= 10%)`);
    }
    const wt = r.winningTurns[id];
    const total = Object.values(wt).reduce((x, y) => x + y, 0);
    for (const [k, n] of Object.entries(wt)) {
      if (k !== '-' && n / total > 0.5) f.push(`${id} ${k} is on ${pct(n, total)} of its winning turns (want <= 50%)`);
    }
    // Simple powers can't finish a line on the turn they're used, so their edge over a
    // bot that never uses them varies more by writer: a wider sanity band.
    const [blo, bhi] = r.simple ? [0.4, 0.9] : [0.5, 0.8];
    const b = r.baseline[id];
    const bs = b.won / b.played;
    if (bs < blo || bs > bhi) f.push(`${id} beats the no-powers bot ${pct(b.won, b.played)} (want ${blo * 100}-${bhi * 100}%)`);
  }
  return f;
}

export function printSweep(r: SweepResult): string {
  const lines: string[] = [];
  const name = r.mode === 'rotating' ? 'TWIST' : 'CASCADE';
  lines.push(`== ${name} ==  rounds ${r.rounds}, first player ${pct(r.starterRoundWins, r.decisiveRounds)} of decisive, draws ${pct(r.drawnRounds, r.rounds)}, median ${r.medianTurns} turns`);
  lines.push('agent    | win share | vs no-powers | power use (% of rounds)                         | top winning-turn power');
  for (const id of AGENT_IDS) {
    const s = r.agentShare[id];
    const b = r.baseline[id];
    const use = Object.entries(r.usage[id]).map(([ab, u]) => `${ab} ${pct(u.used, u.rounds)}`).join(', ');
    const wt = Object.entries(r.winningTurns[id]).filter(([k]) => k !== '-');
    const total = Object.values(r.winningTurns[id]).reduce((x, y) => x + y, 0);
    wt.sort((x, y) => y[1] - x[1]);
    const top = wt[0] ? `${wt[0][0]} ${pct(wt[0][1], total)}` : '-';
    lines.push(`${id.padEnd(8)} | ${pct(s.won, s.played).padStart(9)} | ${pct(b.won, b.played).padStart(12)} | ${use.padEnd(48)}| ${top}`);
  }
  lines.push('pairings (row agent wins %):');
  const cell = (a: AgentId, b: AgentId) => {
    const p = r.pairs.find((x) => (x.a === a && x.b === b) || (x.a === b && x.b === a))!;
    const w = p.a === a ? p.aWins : p.matches - p.aWins;
    return a === b ? ' mirror' : pct(w, p.matches).padStart(7);
  };
  lines.push(`         ${AGENT_IDS.map((id) => id.padStart(8)).join('')}`);
  for (const a of AGENT_IDS) lines.push(`${a.padEnd(9)}${AGENT_IDS.map((b) => ` ${cell(a, b)}`).join('')}`);
  const fails = sweepFailures(r);
  lines.push(fails.length ? `FAILS:\n  ${fails.join('\n  ')}` : 'all balance checks pass');
  return lines.join('\n');
}
