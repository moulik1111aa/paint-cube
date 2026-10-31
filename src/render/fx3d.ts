// 3D effects: paint droplets and dry-paint shards (instanced, so hundreds cost one draw
// call each), splat and ring sprites, tweens, and camera shake. Everything advances on
// a game clock that supports slow motion and hit-pause.

import type { Three } from './three.ts';
import { splatTexture, ringTexture } from './look.ts';

export const ease = {
  outCubic: (k: number) => 1 - (1 - k) ** 3,
  inCubic: (k: number) => k * k * k,
  outBack: (k: number) => 1 + 2.4 * (k - 1) ** 3 + 1.4 * (k - 1) ** 2,
  outElastic: (k: number) => (k === 0 || k === 1 ? k : 2 ** (-9 * k) * Math.sin((k * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1),
  inOutCubic: (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2),
};

interface Tween {
  t: number;
  dur: number;
  delay: number;
  step: (k: number) => void;
  done?: () => void;
}

/** The game clock: slow motion (`scale`) and hit-pause (`freeze` seconds of stopped time). */
export class Clock {
  scale = 1;
  freeze = 0;
  /** Real seconds in, game seconds out. */
  advance(real: number): number {
    if (this.freeze > 0) {
      this.freeze -= real;
      return 0;
    }
    return real * this.scale;
  }
}

export class Tweens {
  private list: Tween[] = [];
  add(dur: number, step: (k: number) => void, done?: () => void, delay = 0): void {
    this.list.push({ t: 0, dur, delay, step, done });
  }
  wait(delay: number, fn: () => void): void {
    this.add(0.0001, () => {}, fn, delay);
  }
  update(dt: number): void {
    const keep: Tween[] = [];
    // Tweens added by a `done` callback are appended to this same list, so the loop
    // picks them up this frame and they survive into `keep`.
    for (const tw of this.list) {
      if (tw.delay > 0) {
        tw.delay -= dt;
        keep.push(tw);
        continue;
      }
      tw.t += dt;
      const k = Math.min(1, tw.t / tw.dur);
      tw.step(k);
      if (k >= 1) tw.done?.();
      else keep.push(tw);
    }
    this.list = keep;
  }
  get busy(): boolean {
    return this.list.length > 0;
  }
  clear(): void {
    this.list = [];
  }
}

const DROPS = 700;
const SHARDS = 420;

export class Fx {
  readonly group: any;
  private readonly T: Three;
  private readonly drops: any;
  private readonly shards: any;
  private readonly dPos = new Float32Array(DROPS * 3);
  private readonly dVel = new Float32Array(DROPS * 3);
  private readonly dLife = new Float32Array(DROPS);
  private readonly dMax = new Float32Array(DROPS);
  private readonly dSize = new Float32Array(DROPS);
  private dNext = 0;
  private readonly sPos = new Float32Array(SHARDS * 3);
  private readonly sVel = new Float32Array(SHARDS * 3);
  private readonly sRot = new Float32Array(SHARDS * 4); // axis xyz + angular speed
  private readonly sLife = new Float32Array(SHARDS);
  private readonly sMax = new Float32Array(SHARDS);
  private readonly sSize = new Float32Array(SHARDS);
  private sNext = 0;
  private readonly splats: any[];
  private readonly ringTex: any;
  private sprites: { s: any; life: number; max: number; grow: number; from: number; fade: number; spin: number }[] = [];
  private readonly m = { mat: null as any, q: null as any, v: null as any, s: null as any, c: null as any, axis: null as any };
  /** Particle budget multiplier, lowered on slow phones. */
  budget = 1;

  constructor(T: Three, dropMat: any) {
    this.T = T;
    this.group = new T.Group();
    this.drops = new T.InstancedMesh(new T.IcosahedronGeometry(1, 1), dropMat, DROPS);
    this.shards = new T.InstancedMesh(new T.BoxGeometry(1, 1, 0.18), dropMat, SHARDS);
    for (const im of [this.drops, this.shards]) {
      im.instanceMatrix.setUsage(T.DynamicDrawUsage);
      im.frustumCulled = false;
      im.count = 0;
      im.setColorAt(0, new T.Color());
      im.layers.set(1);
      this.group.add(im);
    }
    this.splats = [0, 1, 2, 3].map((i) => splatTexture(T, i * 7 + 3));
    this.ringTex = ringTexture(T);
    this.m.mat = new T.Matrix4();
    this.m.q = new T.Quaternion();
    this.m.v = new T.Vector3();
    this.m.s = new T.Vector3();
    this.m.c = new T.Color();
    this.m.axis = new T.Vector3();
  }

  /** A burst of paint droplets from `pos`, mostly along `dir` (a unit vector) when given. */
  burst(pos: any, color: string, count: number, speed: number, size: number, dir?: any, spread = 1, life = 1): void {
    const n = Math.round(count * this.budget);
    const c = this.m.c.set(color);
    for (let k = 0; k < n; k++) {
      const i = this.dNext;
      this.dNext = (this.dNext + 1) % DROPS;
      let x = Math.random() * 2 - 1;
      let y = Math.random() * 2 - 1;
      let z = Math.random() * 2 - 1;
      const l = Math.hypot(x, y, z) || 1;
      x /= l;
      y /= l;
      z /= l;
      if (dir) {
        x = dir.x + x * spread;
        y = dir.y + y * spread;
        z = dir.z + z * spread;
      }
      const sp = speed * (0.35 + Math.random() * 0.9);
      this.dPos.set([pos.x, pos.y, pos.z], i * 3);
      this.dVel.set([x * sp, y * sp + speed * 0.25, z * sp], i * 3);
      this.dMax[i] = this.dLife[i] = (0.45 + Math.random() * 0.5) * life;
      this.dSize[i] = size * (0.4 + Math.random() * 0.9);
      this.drops.setColorAt(i, c);
    }
    this.drops.instanceColor.needsUpdate = true;
  }

  /** Fine spray mist: many tiny, fast specks with a short life. */
  mist(pos: any, color: string, count: number, speed: number, dir?: any): void {
    this.burst(pos, color, count, speed, 0.018, dir, 0.7, 0.55);
  }

  /** Dry paint flaking off: flat shards that tumble and fall. */
  flakes(pos: any, color: string, count: number, size: number): void {
    const n = Math.round(count * this.budget);
    const c = this.m.c.set(color);
    for (let k = 0; k < n; k++) {
      const i = this.sNext;
      this.sNext = (this.sNext + 1) % SHARDS;
      this.sPos.set([pos.x + (Math.random() - 0.5) * size * 4, pos.y + (Math.random() - 0.5) * size * 4, pos.z + (Math.random() - 0.5) * size * 4], i * 3);
      this.sVel.set([(Math.random() - 0.5) * 2.2, 0.6 + Math.random() * 1.6, (Math.random() - 0.5) * 2.2], i * 3);
      const a = this.m.axis.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      this.sRot.set([a.x, a.y, a.z, 4 + Math.random() * 10], i * 4);
      this.sMax[i] = this.sLife[i] = 0.9 + Math.random() * 0.6;
      this.sSize[i] = size * (0.6 + Math.random() * 0.8);
      this.shards.setColorAt(i, c);
    }
    this.shards.instanceColor.needsUpdate = true;
  }

  /** Confetti: paper flakes shot from `pos` along `dir` (a unit vector), in these colours. */
  confetti(pos: any, dir: any, colors: readonly string[], count: number, speed = 7): void {
    const n = Math.round(count * this.budget);
    for (let k = 0; k < n; k++) {
      const i = this.sNext;
      this.sNext = (this.sNext + 1) % SHARDS;
      const c = this.m.c.set(colors[k % colors.length]);
      const sp = speed * (0.55 + Math.random() * 0.6);
      this.sPos.set([pos.x, pos.y, pos.z], i * 3);
      this.sVel.set([(dir.x + (Math.random() - 0.5) * 0.7) * sp, (dir.y + (Math.random() - 0.5) * 0.5) * sp, (dir.z + (Math.random() - 0.5) * 0.7) * sp], i * 3);
      const a = this.m.axis.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      this.sRot.set([a.x, a.y, a.z, 8 + Math.random() * 14], i * 4);
      this.sMax[i] = this.sLife[i] = 1.6 + Math.random() * 0.9;
      this.sSize[i] = 0.07 + Math.random() * 0.06;
      this.shards.setColorAt(i, c);
    }
    this.shards.instanceColor.needsUpdate = true;
  }

  /** A paint splat sprite that bursts open and fades. */
  splat(pos: any, color: string, size: number, life = 0.6): void {
    const T = this.T;
    const mat = new T.SpriteMaterial({ map: this.splats[Math.floor(Math.random() * 4)], color, transparent: true, depthWrite: false, rotation: Math.random() * Math.PI * 2 });
    const s = new T.Sprite(mat);
    s.position.copy(pos);
    s.layers.set(1);
    s.renderOrder = 5;
    this.group.add(s);
    this.sprites.push({ s, life, max: life, grow: size, from: size * 0.3, fade: 0.55, spin: (Math.random() - 0.5) * 0.6 });
  }

  /** An expanding glow ring (bright enough to bloom). */
  ring(pos: any, color: string, size: number, life = 0.45): void {
    const T = this.T;
    const mat = new T.SpriteMaterial({ map: this.ringTex, color: new T.Color(color).multiplyScalar(1.6), transparent: true, depthWrite: false, blending: T.AdditiveBlending });
    const s = new T.Sprite(mat);
    s.position.copy(pos);
    s.layers.set(1);
    s.renderOrder = 6;
    this.group.add(s);
    this.sprites.push({ s, life, max: life, grow: size, from: size * 0.15, fade: 0.0, spin: 0 });
  }

  update(dt: number): void {
    const { mat, q, v, s, axis } = this.m;
    let dn = 0;
    for (let i = 0; i < DROPS; i++) {
      if (this.dLife[i] <= 0) continue;
      this.dLife[i] -= dt;
      const j = i * 3;
      this.dVel[j + 1] -= 9.5 * dt;
      const drag = Math.exp(-1.6 * dt);
      this.dVel[j] *= drag;
      this.dVel[j + 2] *= drag;
      this.dPos[j] += this.dVel[j] * dt;
      this.dPos[j + 1] += this.dVel[j + 1] * dt;
      this.dPos[j + 2] += this.dVel[j + 2] * dt;
      const k = Math.max(0, this.dLife[i] / this.dMax[i]);
      const sz = this.dSize[i] * Math.min(1, k * 2.2);
      // Stretch droplets along their velocity for a liquid streak.
      const sp = Math.hypot(this.dVel[j], this.dVel[j + 1], this.dVel[j + 2]);
      v.set(this.dVel[j], this.dVel[j + 1], this.dVel[j + 2]).normalize();
      q.setFromUnitVectors(axis.set(0, 1, 0), v);
      s.set(sz, sz * (1 + Math.min(2.2, sp * 0.18)), sz);
      mat.compose(v.set(this.dPos[j], this.dPos[j + 1], this.dPos[j + 2]), q, s);
      this.drops.setMatrixAt(i, mat);
      dn = i + 1;
    }
    this.drops.count = dn;
    this.drops.instanceMatrix.needsUpdate = true;

    let sn = 0;
    for (let i = 0; i < SHARDS; i++) {
      if (this.sLife[i] <= 0) continue;
      this.sLife[i] -= dt;
      const j = i * 3;
      this.sVel[j + 1] -= 6 * dt;
      const drag = Math.exp(-0.9 * dt);
      this.sVel[j] *= drag;
      this.sVel[j + 2] *= drag;
      this.sPos[j] += this.sVel[j] * dt;
      this.sPos[j + 1] += this.sVel[j + 1] * dt;
      this.sPos[j + 2] += this.sVel[j + 2] * dt;
      const k = Math.max(0, this.sLife[i] / this.sMax[i]);
      const a = i * 4;
      q.setFromAxisAngle(axis.set(this.sRot[a], this.sRot[a + 1], this.sRot[a + 2]), (1 - k) * this.sRot[a + 3]);
      const sz = this.sSize[i] * Math.min(1, k * 3);
      mat.compose(v.set(this.sPos[j], this.sPos[j + 1], this.sPos[j + 2]), q, s.set(sz, sz, sz));
      this.shards.setMatrixAt(i, mat);
      sn = i + 1;
    }
    this.shards.count = sn;
    this.shards.instanceMatrix.needsUpdate = true;

    this.sprites = this.sprites.filter((p) => {
      p.life -= dt;
      const k = 1 - Math.max(0, p.life / p.max);
      const g = p.from + (p.grow - p.from) * ease.outCubic(Math.min(1, k * 2.2));
      p.s.scale.set(g, g, 1);
      p.s.material.rotation += p.spin * dt;
      p.s.material.opacity = k < p.fade ? 1 : Math.max(0, 1 - (k - p.fade) / (1 - p.fade));
      if (p.life > 0) return true;
      this.group.remove(p.s);
      p.s.material.dispose();
      return false;
    });
  }

  clear(): void {
    this.dLife.fill(0);
    this.sLife.fill(0);
    for (const p of this.sprites) {
      this.group.remove(p.s);
      p.s.material.dispose();
    }
    this.sprites = [];
  }
}

/** Camera shake: trauma that decays; offsets grow with its square. */
export class Shake {
  trauma = 0;
  private t = 0;
  add(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }
  /** Offsets (x, y, roll) for this frame. */
  update(dt: number): [number, number, number] {
    this.t += dt;
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    const s = this.trauma * this.trauma;
    const n = (f: number, o: number) => Math.sin(this.t * f + o) * Math.sin(this.t * f * 0.63 + o * 2.1);
    return [n(47, 1) * 0.16 * s, n(53, 4) * 0.16 * s, n(31, 7) * 0.05 * s];
  }
}
