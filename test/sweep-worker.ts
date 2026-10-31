// Runs one slice of an Agents sweep off the main thread (the balance test spreads the
// sweep over every core).
import { parentPort, workerData } from 'node:worker_threads';
import { agentSweep, type SweepOptions } from '../src/sim/sweep.ts';

const { mode, options } = workerData as { mode: 'rotating' | 'cascade'; options: SweepOptions };
parentPort!.postMessage(agentSweep(mode, options));
