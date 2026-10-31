// Online rooms, two simulated phones on an in-memory relay with a fake clock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryHub, MemoryRelay } from '../src/net/relay.ts';
import { AWAY_MS, GRACE_MS, OnlineSession, STALE_MS, TURN_MS, normaliseCode, type RoomView } from '../src/net/room.ts';
import type { GameEvent } from '../src/core/events.ts';

const flush = async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
};

function setup() {
  let t = 1_000_000;
  const hub = new MemoryHub();
  hub.now = () => t;
  const clock = () => t;
  const host = new MemoryRelay(hub, 'uid-host');
  const guest = new MemoryRelay(hub, 'uid-guest');
  const advance = async (ms: number, sessions: OnlineSession[]) => {
    for (let k = 0; k < ms; k += 1000) {
      t += 1000;
      sessions.forEach((s) => s.tick());
      await flush();
    }
  };
  return { hub, host, guest, clock, advance };
}

function record(s: OnlineSession) {
  const log: { view: RoomView; events: GameEvent[] }[] = [];
  s.connect((view, events) => log.push({ view, events }));
  return { log, last: () => log[log.length - 1].view, events: () => log.flatMap((l) => l.events) };
}

async function pair(mode: 'rotating' | 'cascade' = 'rotating') {
  const env = setup();
  const h = await OnlineSession.host(env.host, 'Akshat', mode, env.clock);
  const hr = record(h);
  await flush();
  const g = await OnlineSession.join(env.guest, ` ${h.code.toLowerCase()} `, 'Riya', env.clock);
  const gr = record(g);
  await flush();
  return { ...env, h, g, hr, gr };
}

test('codes avoid look-alikes and typed codes are normalised', () => {
  assert.equal(normaliseCode(' ab-c d9z '), 'ABCD9');
  assert.equal(normaliseCode('o0i1l'), '');
});

test('host creates, guest joins with a messy code, the match starts with the host', async () => {
  const { h, g, hr, gr } = await pair();
  assert.match(h.code, /^[A-HJKMNP-Z2-9]{5}$/);
  assert.equal(h.me, 0);
  assert.equal(g.me, 1);
  assert.equal(hr.last().phase, 'playing');
  assert.equal(gr.last().phase, 'playing');
  assert.deepEqual(gr.last().names, ['Akshat', 'Riya']);
  assert.equal(gr.last().match?.round.turn, 0);
});

test('a whole round over the relay: both phones see the same states and events in order', async () => {
  const { h, g, hr, gr } = await pair();
  const moves: [OnlineSession, number][] = [[h, 0], [g, 9], [h, 1], [g, 10], [h, 2]];
  for (const [s, cell] of moves) {
    assert.equal(s.submit({ kind: 'place', cell }), null);
    await flush();
  }
  assert.equal(hr.last().match?.round.result?.winner, 0);
  assert.deepEqual(gr.last().match, hr.last().match);
  const placed = (events: GameEvent[]) => events.filter((e) => e.type === 'placed').map((e) => (e as { cell: number }).cell);
  assert.deepEqual(placed(gr.events()), [0, 9, 1, 10, 2]);
  assert.deepEqual(placed(hr.events()), [0, 9, 1, 10, 2]);
  assert.ok(gr.events().some((e) => e.type === 'roundWon'));
  h.next();
  await flush();
  assert.equal(gr.last().match?.roundNumber, 2);
  assert.equal(gr.last().match?.round.turn, 1, 'the guest starts round 2');
});

test('out-of-turn and illegal moves are refused locally; forged and stale requests are ignored', async () => {
  const { hub, h, g, gr } = await pair();
  assert.equal(g.submit({ kind: 'place', cell: 0 }), 'not-your-turn');
  h.submit({ kind: 'place', cell: 0 });
  await flush();
  assert.equal(g.submit({ kind: 'place', cell: 13 }), 'core');
  // Someone else writes a request in the guest's name: ignored.
  const code = h.code;
  hub.write(`rooms/${code}/request`, { seq: 2, json: JSON.stringify({ kind: 'place', cell: 5 }), by: 'intruder' });
  await flush();
  assert.equal(gr.last().match?.round.cells[5], null);
  // A request for an old state: ignored.
  hub.write(`rooms/${code}/request`, { seq: 1, json: JSON.stringify({ kind: 'place', cell: 6 }), by: 'uid-guest' });
  await flush();
  assert.equal(gr.last().match?.round.cells[6], null);
  // The real one goes through.
  assert.equal(g.submit({ kind: 'place', cell: 7 }), null);
  await flush();
  assert.equal(gr.last().match?.round.cells[7], 1);
});

test('wrong code, full room and expired room each fail with a reason', async () => {
  const env = await pair();
  const third = new MemoryRelay(env.hub, 'uid-third');
  await assert.rejects(OnlineSession.join(third, 'ZZZZZ', 'Sam', env.clock), (e) => e === 'no-room');
  await assert.rejects(OnlineSession.join(third, env.h.code, 'Sam', env.clock), (e) => e === 'full');
  const lone = await OnlineSession.host(new MemoryRelay(env.hub, 'uid-h2'), 'Old', 'cascade', env.clock);
  await flush();
  await env.advance(1000, []);
  env.hub.write(`rooms/${lone.code}/active`, env.clock() - STALE_MS - 1);
  await assert.rejects(OnlineSession.join(third, lone.code, 'Sam', env.clock), (e) => e === 'expired');
});

test('a guest who drops pauses the match, can come back, and forfeits after the grace period', async () => {
  const { hub, h, g, hr, advance } = await pair();
  hub.offline.add('uid-guest');
  await advance(AWAY_MS + 2000, [h]);
  const away = hr.last().awayLeft;
  assert.ok(away !== null && away > 50, `away ${away}`);
  assert.equal(hr.last().timeLeft, null, 'the turn clock pauses');
  // Back within the grace period.
  hub.offline.delete('uid-guest');
  await advance(5000, [h, g]);
  assert.equal(hr.last().awayLeft, null);
  // Gone for good.
  hub.offline.add('uid-guest');
  await advance(AWAY_MS + GRACE_MS + 2000, [h]);
  assert.deepEqual(hr.last().ended, { reason: 'forfeit', winner: 0 });
});

test('a turn that runs out gets a random legal move from the host', async () => {
  const { h, g, gr, advance } = await pair();
  const before = gr.last().match!.round.turns;
  await advance(TURN_MS + 1000, [h, g]);
  assert.equal(gr.last().match!.round.turns, before + 1);
  assert.equal(gr.last().match!.round.turn, 1);
});

test('the host leaving deletes the room and the guest is told', async () => {
  const { h, gr } = await pair();
  await h.leave();
  await flush();
  assert.deepEqual(gr.last().ended, { reason: 'host-left', winner: null });
});

test('a code whose room went stale is reused', async () => {
  const env = setup();
  const fixed = () => 0; // always the same code
  const first = await OnlineSession.host(env.host, 'A', 'rotating', env.clock, fixed);
  await flush();
  env.hub.write(`rooms/${first.code}/active`, env.clock() - STALE_MS - 1);
  const second = await OnlineSession.host(new MemoryRelay(env.hub, 'uid-new'), 'B', 'rotating', env.clock, fixed);
  assert.equal(second.code, first.code);
  assert.equal(env.hub.read(`rooms/${first.code}/host/name`), 'B');
});
