# Tic Tac Three by Moulik

3x3x3 tic-tac-toe for two players, with two modes, paint-splash effects and online rooms.

- **Rotating mode (Twist):** place a mark or twist a layer of the cube. The center is a sealed Core, each player keeps at most 3 marks (the oldest fades), first to a line of 3 wins.
- **Stacking mode (Cascade):** drop paint down 9 columns; completed lines shatter, everything above falls, chains score more. First to 5 points.
- **Agents (optional, local):** switch Agents on at match setup and each player picks a graffiti writer with three powers and an ultimate:
  - **BLITZ** (Duelist): Double Tap, Shove, Overspray; ult Chrome.
  - **STENCIL** (Sentinel): Tape, Fixative, Wet Floor; ult Lockdown.
  - **DRIFT** (Controller): Spin, Swap, Paint Trap; ult Flip.
  - **ECHO** (Initiator): Afterimage, Delay, Reverb; ult Rewind.
  Powers run on cooldowns; paint they put down is *wet* and only counts once it dries, so a power never wins a round on its own. Every number lives in `AGENT_TUNING` (`src/core/agents.ts`); the balance runs and tuning log are in [docs/agents-balance.md](docs/agents-balance.md).
- Best of 3, pass-and-play on one phone, or online by room code (Classic only).

The design spec and build plan live in the 3 d Tic Tac Toe project on claude.ai.

## Install

- **Android:** download [TicTacThree.apk](../../releases/latest/download/TicTacThree.apk) on your phone and open it. Updates install over the old version.
- **Web:** the GitHub Pages site for this repository.

## Develop

```sh
npm install          # or, with globally installed tools: npm run setup:local
npm run check        # type-check, unit tests, build, Playwright end-to-end tests
npm run serve        # preview dist/ at http://localhost:4180
npm run simulate -- agents   # the full Agents balance sweep (both modes, ~4 min each)
```

`npm run build` writes one self-contained `dist/index.html` (fonts and three.js inlined). The same file is the website and the app's web content.

## Release

Every push to `main` runs two workflows:

- **Build APK** builds, signs and verifies the APK (`TicTacThree.apk`), then publishes it as the latest GitHub Release.
- **Website** deploys `dist/index.html` to GitHub Pages.

One-time setup:

1. Add a `PAINTCUBE_SIGNING_PASSWORD` repository secret (at least 12 characters) under Settings → Secrets and variables → Actions.
2. Run Actions → **Create signing key** → Run workflow. It commits the encrypted key and its fingerprint. Never replace that key: Android only installs updates signed with it.
3. Under Settings → Pages, set the source to **GitHub Actions**.

The toolchain (bundler, Android generation, release workflow) is adapted from Study Hard.
