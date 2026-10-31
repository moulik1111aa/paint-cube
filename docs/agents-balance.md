# Agents mode: balance

Every tunable number lives in `AGENT_TUNING` in `src/core/agents.ts`. The bot sweep is
the measuring stick:

```sh
npm run simulate -- agents          # both modes, 204 matches per pairing (~3 min per mode)
node --test test/agents-balance.test.ts   # the same sweep, as assertions, on every core
```

The sweep plays whole best-of-3 matches between bots for all 16 pairings (mirrors
included) over 3 seeds x 2 noise levels (0.1 and 0.3), 34 matches each, so 204 matches
per pairing, alternating seats and starters. Each agent also plays 204 matches against a
bot that never uses its powers (Classic play inside the Agents rules). The bot looks one
move ahead with the fade-aware threat logic, knows every agent rule (wet paint, tape,
traps, seals, wet floor, lockdown, delay, chrome), tries each available power on a
sample of targets, searches the best few with every follow-up move, and fires its
ultimate when it makes or blocks a threat (or 15% of the time anyway).

## Checks (all must pass, both modes)

- each agent wins 40-60% of its decisive matches against the other three;
- no non-mirror pairing outside 35-65%;
- the first player wins 45-60% of decisive rounds; draws at most 15%;
- median round length: Twist 10-30 turns, Cascade 20-45;
- no dead power: every power and ultimate is used in at least 10% of the rounds its owner plays;
- no auto-win power: no single power is on more than 50% of its agent's winning turns
  (the turn that won the round, or for a wet line that counted at the start of the
  winner's turn, the winner's previous turn);
- every agent beats the no-powers bot, but not overwhelmingly: 50-80% of matches.

## Build 20: cheaper ultimates that can't win on the spot

Rewind (24 pips) and Flip (36) were only ready about once a match in Twist: at 7 pips
they decided too many rounds by themselves (undo the block, or line three up, and win
the same turn, since ultimates weren't wet). Instead of pricing them out, the rule
changed: **in Twist, the move after a Rewind or a Flip is wet, and so is everything a
Flip moves.** Then they could be cheap again: Rewind 10, Flip 12 (about once a round).

Wet lines make Twist rounds longer, so draws rose to 21% with the old 40-turn limit;
Agents rounds now draw at **50 turns** (`drawTurns`; Classic stays at 40). Other
retuning: Blitz powers cooldown 9, Stencil Wet Floor 3 and Lockdown 6, Drift Spin and
Swap 8, Echo Reverb 5.

In Cascade the wet move made Echo stronger, not weaker (a delayed burst can chain
bigger), so Cascade's Rewind stays instant; its cost dropped from 50 to 30.

```
== TWIST ==  rounds 5919, first player 48.9% of decisive, draws 14.0%, median 23 turns
blitz 55.6%  stencil 58.7%  drift 41.3%  echo 44.4%   (vs no-powers 55-77%)
Rewind used in 76% of Echo's rounds, Flip in 79% of Drift's.  all balance checks pass
== CASCADE ==  first player 54.6%, median 29 turns
blitz ~54%  stencil ~49%  drift ~45%  echo 58.6% (vs no-powers 78.7%)  all balance checks pass
```

## Final numbers (build 18)

```
== TWIST ==  rounds 5984, first player 51.1% of decisive, draws 13.5%, median 19 turns
agent    | win share | vs no-powers | power use (% of rounds)                         | top winning-turn power
blitz    |     44.3% |        77.0% | doubleTap 96.9%, shove 98.7%, overspray 99.5%, chrome 57.2%| chrome 4.1%
stencil  |     52.6% |        60.3% | tape 48.9%, fixative 67.6%, wetFloor 89.9%, lockdown 36.1%| lockdown 4.1%
drift    |     49.5% |        76.0% | spin 91.4%, swap 75.2%, trap 71.2%, flip 17.4%  | flip 26.5%
echo     |     53.6% |        74.5% | afterimage 67.6%, delay 78.5%, reverb 97.4%, rewind 30.2%| rewind 42.7%
pairings (row agent wins %):
            blitz stencil   drift    echo
blitz      mirror   48.0%   46.1%   38.7%
stencil     52.0%  mirror   44.6%   61.3%
drift       53.9%   55.4%  mirror   39.2%
echo        61.3%   38.7%   60.8%  mirror
all balance checks pass

== CASCADE ==  rounds 5102, first player 55.3% of decisive, draws 0.0%, median 29 turns
agent    | win share | vs no-powers | power use (% of rounds)                         | top winning-turn power
blitz    |     55.2% |        71.1% | doubleTap 49.5%, shove 89.4%, overspray 74.3%, chrome 16.9%| doubleTap 7.3%
stencil  |     48.7% |        76.5% | tape 58.4%, fixative 45.8%, wetFloor 99.9%, lockdown 61.5%| lockdown 5.5%
drift    |     42.6% |        67.6% | spin 99.0%, swap 99.8%, trap 54.2%, flip 81.7%  | flip 45.4%
echo     |     53.4% |        72.5% | afterimage 69.4%, delay 66.8%, reverb 59.0%, rewind 18.1%| afterimage 4.7%
pairings (row agent wins %):
            blitz stencil   drift    echo
blitz      mirror   53.4%   61.8%   50.5%
stencil     46.6%  mirror   50.0%   49.5%
drift       38.2%   50.0%  mirror   39.7%
echo        49.5%   50.5%   60.3%  mirror
all balance checks pass
```

## Final timers

A cooldown counts the owner's turns a power stays out after use (the button shows it).
`firstReady` is the cooldown a power starts each round with (0 = ready on turn one).
Durations count the opposing player's turns. Cooldowns and effects reset every round;
the ultimate meter carries over.

| | Twist | Cascade |
|---|---|---|
| Wet paint dries after | 2 of its owner's turn starts | 2 |
| Ultimate meter | +1 per own turn, +2 when you lose a round | +1 per own turn, +2 each time you're scored on |
| **BLITZ** Double Tap / Shove / Overspray | cooldown 9 / 9 / 9, unlock turn 2 / 2 / 2 | 12 / 12 / 12, unlock turn 15 / 11 / 13 |
| Chrome (ult) | 10 pips, next 2 marks | 50 pips, next 1 cube (scores double) |
| **STENCIL** Tape / Fixative / Wet Floor | 2 / 1 / 3 (tape 4 turns, seal 4, floor 2) | 4 / 4 / 4 (tape 3, seal 3, floor 2) |
| Lockdown (ult) | 6 pips, 3 turns | 9 pips, 2 turns |
| **DRIFT** Spin / Swap / Paint Trap | 8 / 8 / 9, unlock turn 4 / 6 / 1 (trap 3 turns) | 12 / 3 / 1, unlock turn 7 / 1 / 1 (trap 6 turns) |
| Flip (ult) | 12 pips (moves wet, move wet) | 7 pips |
| **ECHO** Afterimage / Delay / Reverb | 6 / 4 / 5 | 12 / 12 / 12, unlock turn 12 / 12 / 12 |
| Rewind (ult) | 10 pips (move after it wet) | 30 pips |
| A round is a draw after | 50 turns (Classic: 40) | 120 turns |

In Twist a cooldown of 8-10 means "about once per round" (a round is ~9 turns each). In
Cascade most powers unlock only in the second half of a round: one extra cube decides a
race to 5 points.

## Rules settled while tuning

These came out of the first runs and are rules, not numbers:

1. **Powers that move, wipe or seal paint (Shove, Overspray, Spin, Fixative) also make
   that turn's move wet.** The first run had Blitz winning 92% of its rounds with
   Shove: push the blocker out of a line, then complete it with the normal move, which
   was not wet. That broke the promise that a power never wins on its own. Swap is not
   on the list: both swapped marks are already wet, so it can't open a same-turn line.
2. **Wet paint dries after N of its owner's turn starts** (`dryTurns`, 2 in both modes).
   With 1, a Double Tap line only had to survive one reply, and in Twist a placement
   can't break a line (only a twist or a power can), so wet lines were near-certain wins.
3. **`firstReady`** (a power's cooldown at the start of each round) and **per-ultimate
   costs** were added as timers.
4. Cascade: a round with no winner after 120 turns is a draw (a safety net; it never
   happened in the sweeps), and a player with no legal drop (every open column taped)
   passes.
5. Ultimates ignore Chrome and Fixative (Flip turns sealed layers; Cascade's Flip turns
   the whole cube).

The bot also got two fixes during tuning (they change how powers are used, not the
rules): Cascade's evaluation now discounts full lines that are still wet (worth less the
longer they must survive) and counts wet cubes as briefly out of play. Before that the
bot used Drift's Spin and Swap greedily and lost with them (Drift won 17% against the
no-powers bot; after the fix, 58-68%).

## Tuning log

Numbers are win shares of decisive matches (agents vs agents), and match wins against
the no-powers bot ("base"). Early runs used 32-128 matches per pairing; the final ones
204-256.

**Twist**

| step | change | result |
|---|---|---|
| 0 | start: every cooldown 4, every ultimate 7, dry 1 | median round 6 turns; Shove on 92% of Blitz wins; Blitz/Drift/Echo 100% vs base |
| 1 | rule 1 (power turn's move is wet) | median 12; Drift 80-92% (Flip on 72% of its wins), Rewind 70% of Echo wins, Stencil 13-17% |
| 2 | once-per-round powers, no ultimates (probe) | Blitz 97% vs base even then |
| 3 | dry 2 (rule 2) | Blitz 84%, others 41-53% vs base: the right scale |
| 4 | Swap off the wet-move list; Flip 16-26, Rewind 18-22, Stencil 1-2 | Flip and Rewind still 50-70% of their agents' wins |
| 5 | Wet Floor 3 turns (probe) | Stencil 92-97% vs base: 3 turns is a wall; back to 2 |
| 6 | Flip 32, Rewind 22-24, Spin 10 (unlock 4), Swap 10 (unlock 6), Trap 9 | all checks pass at 128 per pairing; Stencil/Echo/Drift form a triangle (Stencil beats Echo ~60%, Echo beats Drift ~60%, Drift beats Stencil ~60%) |
| 7 | Tape 2, Fixative 1, Lockdown 3/3 turns, Afterimage 6, Delay 4, Reverb 7 | pass at 256: shares 48-53%, Blitz 79% vs base (tight) |
| 8 | Double Tap unlock turn 2 | Blitz 75% vs base but only 34% vs agents |
| 9 | Chrome 14 → 10, Shove unlock turn 2, Flip 36 | **final**: shares 44-54%, pairings 39-61%, base 60-77%, draws 13.5% |

**Cascade**

| step | change | result |
|---|---|---|
| 0 | start (dry 1 or 2) | Blitz and Echo 100% vs base, Drift 4-19%; Blitz/Echo 83-93% share |
| 1 | probes: one Double Tap per round alone = 74% vs base; Chrome alone at 7 pips = 100% | one extra cube (or point) decides a race to 5 |
| 2 | bot: wet-line discount | Drift 17% → 58% vs base |
| 3 | powers once per round and late (unlock turns 7-12), Chrome 1 cube at 45-50, Rewind 40-50 | Blitz 86% vs base, Drift 23% share |
| 4 | Swap off the wet-move list; Drift Swap 2-3, Trap 1 (6 turns), Flip 6-7 | all pass at 128; Flip 45-50% of Drift wins (tight) |
| 5 | Double Tap / Overspray / Shove unlock turns 15 / 13 / 11, Echo powers turn 12, Rewind 50, Lockdown 9 | **final**: shares 43-55%, pairings 38-62%, base 68-77%, Flip 45% of Drift wins |

## Known soft spots

- Twist: the Stencil > Echo > Drift > Stencil triangle sits around 60/40; Blitz is the
  strongest against the no-powers bot (77%) and the weakest against agents (44%): its
  powers punish a passive opponent most.
- Cascade: Drift is the weakest (43%) and leans on Flip (45% of its winning turns).
  Next things to try: Flip 6, Spin unlocking later.
- Draws in Twist are 13.5% (limit 15%): powers stretch rounds toward the 40-turn limit.
