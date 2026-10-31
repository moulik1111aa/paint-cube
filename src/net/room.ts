// Online rooms. The host's device runs the game: it owns the official match state and
// is the only one who writes it. The guest sends move requests; the host checks each
// one with the rules engine, applies it, and publishes the new state with its events.
// Both phones render only published state, so they can't drift apart.
//
// Room data at rooms/{code}:
//   host  { uid, name, seen }      seen: server time, refreshed every few seconds
//   guest { uid, name, seen }      written once by the guest when joining
//   mode, created, active          active: server time of the last state write
//   state { seq, json }            json = { match, events } (strings dodge Firebase's array quirks)
//   request { seq, json, by }      the guest's move for state `seq`
//   ended { reason, winner }       forfeit or the host leaving
//
// Presence: a player who hasn't refreshed `seen` for AWAY_MS is away; the match
// pauses for GRACE_MS, then the host wins by forfeit (guest gone) or the room closes
// (host gone). Turns are timed (TURN_MS); on timeout the host plays a random legal move.

import { SERVER_TIME, type Relay } from './relay.ts';
import { applyMove, checkMove, newMatch, nextRound, randomMove, type MatchState, type Mode, type Move } from '../core/match.ts';
import type { GameEvent, IllegalReason } from '../core/events.ts';
import type { Player } from '../core/geometry.ts';
import { rng } from '../core/rng.ts';

export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L
export const CODE_LENGTH = 5;
export const HEARTBEAT_MS = 4000;
export const AWAY_MS = 12000;
export const GRACE_MS = 60000;
export const TURN_MS = 20000;
export const STALE_MS = 2 * 60 * 60 * 1000;

export type JoinError = 'no-room' | 'full' | 'expired';
export type Ended = { reason: 'forfeit' | 'host-left' | 'left'; winner: Player | null };

export interface RoomView {
  code: string;
  me: Player;
  names: [string, string];
  phase: 'waiting' | 'playing' | 'ended';
  match: MatchState | null;
  /** Seconds left on the current turn (null when not timed or paused). */
  timeLeft: number | null;
  /** Seconds left before the absent opponent forfeits / the room closes (null = present). */
  awayLeft: number | null;
  ended: Ended | null;
}

interface Seat {
  uid: string;
  name: string;
  seen?: number;
}
interface RoomData {
  host?: Seat;
  guest?: Seat;
  mode?: Mode;
  created?: number;
  active?: number;
  state?: { seq: number; json: string };
  request?: { seq: number; json: string; by: string };
  ended?: Ended;
}

export function randomCode(random: () => number = Math.random): string {
  let s = '';
  for (let i = 0; i < CODE_LENGTH; i++) s += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  return s;
}

/** Normalise what someone typed: uppercase, spaces and stray characters dropped. */
export function normaliseCode(typed: string): string {
  return typed
    .toUpperCase()
    .split('')
    .filter((c) => CODE_ALPHABET.includes(c))
    .join('')
    .slice(0, CODE_LENGTH);
}

export class OnlineSession {
  readonly code: string;
  readonly me: Player;
  /** Called with the new view and the events to animate (empty when there's nothing to animate). */
  private onChange: ((view: RoomView, events: GameEvent[]) => void) | null = null;
  private readonly relay: Relay;
  private readonly path: string;
  private readonly now: () => number;
  private room: RoomData = {};
  private seq = 0;
  private match: MatchState | null = null;
  private names: [string, string] = ['', ''];
  private ended: Ended | null = null;
  private stop: (() => void) | null = null;
  private lastBeat = 0;
  /** Local time we last saw the opponent's `seen` change, and its value. */
  private otherSeen: { value: number | undefined; at: number } = { value: undefined, at: 0 };
  /** Local time the current turn started (when we received its state). */
  private turnAt = 0;
  private sentFor = -1;
  private sentAt = 0;
  private wasAway = false;
  private readonly random: () => number;

  private constructor(relay: Relay, code: string, me: Player, now: () => number) {
    this.relay = relay;
    this.code = code;
    this.me = me;
    this.path = `rooms/${code}`;
    this.now = now;
    this.random = rng(Math.floor(now()) % 2147483647);
  }

  /** Create a room as the host (player 0) and wait for a guest. */
  static async host(relay: Relay, name: string, mode: Mode, now: () => number = Date.now, random: () => number = Math.random): Promise<OnlineSession> {
    for (let attempt = 0; attempt < 8; attempt++) {
      const code = randomCode(random);
      const data: RoomData = { host: { uid: relay.uid, name, seen: SERVER_TIME as unknown as number }, mode, created: SERVER_TIME as unknown as number, active: SERVER_TIME as unknown as number };
      let ok = await relay.create(`rooms/${code}`, data);
      if (!ok) {
        // Reuse a code whose room has been idle for over two hours.
        const old = await relay.get<RoomData>(`rooms/${code}`);
        if (old?.active && now() - old.active > STALE_MS) {
          await relay.set(`rooms/${code}`, data);
          ok = true;
        }
      }
      if (ok) {
        const s = new OnlineSession(relay, code, 0, now);
        s.names = [name, ''];
        return s;
      }
    }
    throw new Error('could not find a free room code');
  }

  /** Join a room as the guest (player 1). Throws a JoinError string. */
  static async join(relay: Relay, typed: string, name: string, now: () => number = Date.now): Promise<OnlineSession> {
    const code = normaliseCode(typed);
    const room = code.length === CODE_LENGTH ? await relay.get<RoomData>(`rooms/${code}`) : null;
    if (!room?.host) throw 'no-room' satisfies JoinError;
    if (room.ended || (room.active && now() - room.active > STALE_MS)) throw 'expired' satisfies JoinError;
    if (room.guest && room.guest.uid !== relay.uid) throw 'full' satisfies JoinError;
    if (!room.guest) {
      const ok = await relay.create(`rooms/${code}/guest`, { uid: relay.uid, name, seen: SERVER_TIME });
      if (!ok) throw 'full' satisfies JoinError;
    }
    const s = new OnlineSession(relay, code, 1, now);
    s.names = [room.host.name, name];
    return s;
  }

  /** Start listening; `cb` gets every new view and the events to animate. */
  connect(cb: (view: RoomView, events: GameEvent[]) => void): void {
    this.onChange = cb;
    this.otherSeen = { value: undefined, at: this.now() };
    this.stop = this.relay.listen(this.path, (v: RoomData | null) => this.onRoom(v));
  }

  private onRoom(v: RoomData | null): void {
    if (!v) {
      if (!this.ended) this.finish(this.me === 1 ? { reason: 'host-left', winner: null } : { reason: 'left', winner: null });
      return;
    }
    this.room = v;
    if (v.host && v.guest) this.names = [v.host.name, v.guest.name];
    const other = this.me === 0 ? v.guest : v.host;
    if (other?.seen !== this.otherSeen.value) this.otherSeen = { value: other?.seen, at: this.now() };
    if (v.ended && !this.ended) {
      this.finish(v.ended);
      return;
    }
    let events: GameEvent[] = [];
    if (v.state && v.state.seq > this.seq) {
      const { match, events: ev } = JSON.parse(v.state.json) as { match: MatchState; events: GameEvent[] };
      // Animate only the next state in order; after a gap (reconnect), just show it.
      events = v.state.seq === this.seq + 1 ? ev : [];
      this.seq = v.state.seq;
      this.match = match;
      this.turnAt = this.now();
    }
    if (this.me === 0) this.hostDuties();
    this.emit(events);
  }

  /** Host: start the match once the guest is in; apply valid guest requests. */
  private hostDuties(): void {
    const v = this.room;
    if (!v.guest || this.ended) return;
    if (!v.state && this.seq === 0) {
      this.publish(newMatch(v.mode ?? 'rotating', 0), []);
      return;
    }
    const req = v.request;
    if (req && req.seq === this.seq && req.by === v.guest.uid && this.match && this.match.round.turn === 1 && !this.match.round.result) {
      const move = JSON.parse(req.json) as Move;
      if (checkMove(this.match, move) === null) this.apply(move);
    }
  }

  private apply(move: Move): void {
    const out = applyMove(this.match!, move);
    this.publish(out.state, out.events);
  }

  private publish(match: MatchState, events: GameEvent[]): void {
    const seq = this.seq + 1;
    // Update locally too, so a second move can't be built on the old state.
    this.seq = seq;
    this.match = match;
    this.turnAt = this.now();
    void this.relay.update(this.path, { state: { seq, json: JSON.stringify({ match, events }) }, request: null, active: SERVER_TIME }).catch(() => {});
    this.emit(events);
  }

  private emit(events: GameEvent[]): void {
    this.onChange?.(this.view(), events);
  }

  private finish(e: Ended): void {
    this.ended = e;
    this.emit([]);
  }

  view(): RoomView {
    const away = this.awayLeft();
    const r = this.match?.round;
    const timed = !!r && !r.result && this.match!.winner === null && away === null && !this.ended;
    return {
      code: this.code,
      me: this.me,
      names: [this.names[0] || 'Host', this.names[1] || 'Guest'],
      phase: this.ended ? 'ended' : this.match ? 'playing' : 'waiting',
      match: this.match,
      timeLeft: timed ? Math.max(0, Math.ceil((TURN_MS - (this.now() - this.turnAt)) / 1000)) : null,
      awayLeft: away,
      ended: this.ended,
    };
  }

  private awayLeft(): number | null {
    if (!this.match || this.ended) return null;
    const gone = this.now() - this.otherSeen.at;
    if (gone < AWAY_MS) return null;
    return Math.max(0, Math.ceil((GRACE_MS - (gone - AWAY_MS)) / 1000));
  }

  /** My move. Returns why it's refused, or null when sent. */
  submit(move: Move): IllegalReason | null {
    if (!this.match || this.ended) return 'match-over';
    if (this.match.round.turn !== this.me) return 'not-your-turn';
    const why = checkMove(this.match, move);
    if (why) return why;
    if (this.me === 0) this.apply(move);
    else {
      // One request per turn, unless it seems lost.
      if (this.sentFor === this.seq && this.now() - this.sentAt < 3000) return null;
      this.sentFor = this.seq;
      this.sentAt = this.now();
      void this.relay.set(`${this.path}/request`, { seq: this.seq, json: JSON.stringify(move), by: this.relay.uid }).catch(() => {
        this.sentFor = -1;
      });
    }
    return null;
  }

  /** Host: start the next round (or a rematch once the match is over). */
  next(): void {
    if (this.me !== 0 || !this.match || this.ended) return;
    if (this.match.winner !== null) this.publish(newMatch(this.match.mode, 0), []);
    else if (this.match.round.result) this.publish(nextRound(this.match), []);
  }

  /** Drive heartbeats, presence and the turn timer; call every few hundred ms. */
  tick(): void {
    if (this.ended) return;
    const t = this.now();
    if (t - this.lastBeat >= HEARTBEAT_MS) {
      this.lastBeat = t;
      void this.relay.set(`${this.path}/${this.me === 0 ? 'host' : 'guest'}/seen`, SERVER_TIME).catch(() => {});
    }
    const away = this.awayLeft();
    // The turn clock restarts when a missing opponent comes back.
    if (this.wasAway && away === null) this.turnAt = t;
    this.wasAway = away !== null;
    if (away === 0) {
      if (this.me === 0) {
        const e: Ended = { reason: 'forfeit', winner: 0 };
        void this.relay.set(`${this.path}/ended`, e).catch(() => {});
        this.finish(e);
      } else this.finish({ reason: 'host-left', winner: null });
      return;
    }
    // Host: a turn that runs out gets a random legal move.
    const m = this.match;
    if (this.me === 0 && m && !m.round.result && m.winner === null && away === null && t - this.turnAt >= TURN_MS) {
      this.apply(randomMove(m, this.random));
    }
    this.emit([]);
  }

  /** Leave: the host deletes the room; the guest just disconnects. */
  async leave(): Promise<void> {
    this.stop?.();
    this.stop = null;
    if (this.me === 0) await this.relay.remove(this.path).catch(() => {});
    this.ended ??= { reason: 'left', winner: null };
  }
}
