// The 3D game board: the street-art scene (graffiti wall, ground, lights, painterly
// post) with the cube in front, playing the rules engine's events as animations.
// It never decides anything: the game controller hands it events and it animates them.
// Taps on cells are reported back through `onTap`.

import { makeRenderer, RenderLoop, softEnv, disposeAll, type Three } from './three.ts';
import { Post } from './post.ts';
import { makeMaterials, roundedBox, PLAYER_COLORS, CORE_COLOR, type Materials } from './look.ts';
import { wallTexture, groundTexture, graffitiCaption } from './street.ts';
import { Fx, Tweens, Clock, Shake, ease } from './fx3d.ts';
import type { Sfx } from '../audio/sfx.ts';
import { CELLS, CENTER, coord, type Cell, type Line, type Player } from '../core/geometry.ts';
import { permutation, sameTwist, type Twist, type Axis, type Slice } from '../core/twist.ts';
import type { GameEvent } from '../core/events.ts';
import type { Mode } from '../core/match.ts';

const SPACING = 1.0;
const CELL = 0.8;

export interface Board {
  /** Called with a cell index when the player taps a cell. */
  onTap: ((cell: number) => void) | null;
  /** Swipe on the cube picked a twist: return false (and explain) to refuse it. */
  onTwistIntent: ((t: Twist) => boolean) | null;
  /** The swiped layer is held at a quarter turn, waiting for confirm or cancel. */
  onTwistReady: ((t: Twist) => void) | null;
  /** Whether swipes on the cube twist layers (rotating mode, player's turn). */
  twistEnabled: boolean;
  /** Animate a held preview back to where it was. */
  cancelTwist(): Promise<void>;
  /** Start a twist preview from a swipe (tests): cell, then a swipe in screen pixels. */
  swipe(cell: number, dx: number, dy: number): Twist | null;
  setMode(mode: Mode): void;
  /** Show these cells immediately, without animation. */
  sync(cells: readonly Cell[]): void;
  /** Animate the engine's events in order; resolves when the board is calm. */
  play(events: readonly GameEvent[]): Promise<void>;
  /** A small "no" shake for a refused tap. */
  refuse(cell: number): void;
  /** Idle presentation (slow sway) when no one is playing. */
  attract: boolean;
  /** Manual clock (tests): advance game time and optionally draw. */
  advance(sec: number, draw?: boolean): void;
  dispose(): void;
}

export function createBoard(T: Three, host: HTMLElement, sfx: Sfx, manual = false): Board {
  const view = makeRenderer(T, host);
  const r = view.r;
  r.toneMapping = T.NoToneMapping;
  r.shadowMap.enabled = true;
  r.shadowMap.type = T.PCFSoftShadowMap;
  let pixelRatio = Math.min(2, devicePixelRatio || 1);
  r.setPixelRatio(pixelRatio);
  const post = new Post(T, r);
  const clock = new Clock();
  const tweens = new Tweens();
  const shake = new Shake();

  const world = new T.Scene();
  world.background = new T.Color('#0b0816');
  const env = softEnv(T, r, '#9a8cff', '#0a0912');
  const M: Materials = makeMaterials(T, env);
  const camera = new T.PerspectiveCamera(38, 1, 0.5, 80);
  camera.layers.enable(1);
  camera.layers.enable(2);

  world.add(new T.HemisphereLight('#7c6cff', '#1a1020', 1.1));
  const lamp = new T.SpotLight('#ffd29a', 3.4, 0, 0.62, 0.75, 0);
  lamp.position.set(-4.5, 8, 7);
  lamp.target.position.set(0.5, -1, -2);
  lamp.castShadow = true;
  lamp.shadow.mapSize.set(1024, 1024);
  lamp.shadow.bias = -0.0006;
  lamp.shadow.radius = 4;
  world.add(lamp, lamp.target);
  const rim = new T.DirectionalLight('#ff4fa3', 1.4);
  rim.position.set(5, 3, -4);
  world.add(rim);
  const fill = new T.DirectionalLight('#38d6ff', 0.6);
  fill.position.set(-4, -2, 5);
  world.add(fill);

  const wallTex = wallTexture(T);
  const wall = new T.Mesh(new T.PlaneGeometry(12, 18), new T.MeshStandardMaterial({ map: wallTex, roughness: 0.95 }));
  wall.position.set(0, 3, -5);
  wall.receiveShadow = true;
  world.add(wall);
  const ground = new T.Mesh(new T.PlaneGeometry(40, 30), new T.MeshStandardMaterial({ map: groundTexture(T), roughness: 0.9 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, -2.6, 10);
  ground.receiveShadow = true;
  world.add(ground);

  const cube = new T.Group();
  world.add(cube);
  const fx = new Fx(T, M.drop);
  world.add(fx.group);

  const slot = (i: number) => {
    const [x, y, z] = coord(i);
    return new T.Vector3((x - 1) * SPACING, (z - 1) * SPACING, (y - 1) * SPACING);
  };
  const toWorld = (i: number) => {
    cube.updateMatrixWorld();
    return cube.localToWorld(slot(i));
  };
  const towardCamera = (pos: any) => camera.position.clone().sub(pos).normalize();

  // Casings: solid concrete blocks (rotating) or faint glass slots (stacking).
  const casingGeo = roundedBox(T, CELL, 0.14, 4);
  const glass = new T.MeshStandardMaterial({ color: '#cfc8ff', transparent: true, opacity: 0.13, roughness: 0.2, depthWrite: false });
  const casings: any[] = [];
  for (let i = 0; i < CELLS; i++) {
    const m = new T.Mesh(casingGeo, M.casing);
    m.castShadow = true;
    m.receiveShadow = true;
    m.position.copy(slot(i));
    m.userData.cell = i;
    cube.add(m);
    casings.push(m);
  }
  const core = new T.Mesh(new T.IcosahedronGeometry(0.27, 1), M.core);
  core.castShadow = true;
  cube.add(core);
  const coreLight = new T.PointLight(CORE_COLOR, 7, 3.2, 1.6);
  cube.add(coreLight);

  const shellGeo = roundedBox(T, 0.86, 0.22, 5);
  const dripGeo = new T.SphereGeometry(1, 14, 10);
  const dripRod = new T.CylinderGeometry(1, 1, 1, 8, 1);
  dripRod.translate(0, -0.5, 0);
  let shells: (any | null)[] = Array(CELLS).fill(null);
  let owners: (Player | null)[] = Array(CELLS).fill(null);
  let mode: Mode = 'rotating';

  function makeShell(p: Player, seed: number): any {
    const g = new T.Group();
    const body = new T.Mesh(shellGeo, M.paint[p]);
    body.castShadow = true;
    body.receiveShadow = true;
    body.userData.body = true;
    const hull = new T.Mesh(shellGeo, M.ink);
    hull.scale.setScalar(1.1);
    g.add(hull, body);
    let s = seed * 7919 + 13;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const dirs = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    for (let k = 0; k < 3; k++) {
      const d = dirs[Math.floor(rnd() * 6)];
      const pos = new T.Vector3(d[0], d[1], d[2]).multiplyScalar(0.44);
      const free = [0, 1, 2].filter((a) => d[a] === 0);
      pos.setComponent(free[0], (rnd() - 0.5) * 0.5);
      pos.setComponent(free[1], (rnd() - 0.5) * 0.5);
      const rad = 0.06 + rnd() * 0.05;
      const drip = new T.Mesh(dripGeo, M.drip[p]);
      drip.position.copy(pos);
      drip.scale.setScalar(rad);
      const dh = new T.Mesh(dripGeo, M.ink);
      dh.position.copy(pos);
      dh.scale.setScalar(rad * 1.3);
      g.add(dh, drip);
    }
    g.userData.player = p;
    return g;
  }

  function addDrips(shell: any, cell: number, p: Player): void {
    cube.updateMatrixWorld();
    const centre = slot(cell);
    const toCam = cube.worldToLocal(camera.position.clone()).sub(centre).normalize();
    const down = cube.worldToLocal(new T.Vector3(0, -1, 0).add(cube.getWorldPosition(new T.Vector3()))).normalize();
    const axes = [new T.Vector3(1, 0, 0), new T.Vector3(0, 1, 0), new T.Vector3(0, 0, 1)];
    const faces = axes.flatMap((a) => [a.clone(), a.clone().negate()]).filter((f) => Math.abs(f.dot(down)) < 0.7);
    faces.sort((a, b) => b.dot(toCam) - a.dot(toCam));
    const face = faces[0];
    if (!face) return;
    const run = down.clone().addScaledVector(face, -down.dot(face)).normalize();
    const across = new T.Vector3().crossVectors(face, run).normalize();
    const count = 1 + Math.floor(Math.random() * 2);
    for (let k = 0; k < count; k++) {
      const len = 0.3 + Math.random() * 0.35;
      const w = 0.035 + Math.random() * 0.025;
      const g = new T.Group();
      g.position.copy(face.clone().multiplyScalar(0.44).addScaledVector(across, (Math.random() - 0.5) * 0.5).addScaledVector(run, -0.05));
      g.quaternion.setFromUnitVectors(new T.Vector3(0, -1, 0), run);
      const rod = new T.Mesh(dripRod, M.drip[p]);
      const tip = new T.Mesh(dripGeo, M.drip[p]);
      rod.scale.set(w, 0.001, w);
      tip.scale.setScalar(w * 1.5);
      g.add(rod, tip);
      shell.add(g);
      void anim(1.3 + Math.random() * 0.6, (t) => {
        const l = len * ease.outCubic(t);
        rod.scale.y = Math.max(0.001, l);
        tip.position.y = -l;
      });
    }
  }

  const captionTex = new Map<string, any>();
  async function caption(text: string, fill: string, at: any, size: number): Promise<void> {
    const key = text + fill;
    if (!captionTex.has(key)) captionTex.set(key, graffitiCaption(T, text, fill));
    const s = new T.Sprite(new T.SpriteMaterial({ map: captionTex.get(key), transparent: true, depthTest: false, depthWrite: false }));
    s.layers.set(1);
    s.renderOrder = 20;
    s.position.copy(at);
    world.add(s);
    await anim(0.22, (k) => {
      const g = size * ease.outBack(k);
      s.scale.set(g * 2, g, 1);
      s.material.rotation = (1 - k) * 0.5;
    });
    await anim(0.55, (k) => (s.material.rotation = Math.sin(k * 9) * 0.03));
    await anim(0.25, (k) => {
      s.material.opacity = 1 - k;
      s.scale.set(size * 2 * (1 + k * 0.15), size * (1 + k * 0.15), 1);
    });
    world.remove(s);
    s.material.dispose();
  }

  const pulse = { bloom: 0, aberr: 0, flash: 0 };
  const hit = (s: { freeze?: number; shake?: number; bloom?: number; aberr?: number; flash?: number }) => {
    clock.freeze = Math.max(clock.freeze, s.freeze ?? 0);
    shake.add(s.shake ?? 0);
    pulse.bloom = Math.max(pulse.bloom, s.bloom ?? 0);
    pulse.aberr = Math.max(pulse.aberr, s.aberr ?? 0);
    pulse.flash = Math.max(pulse.flash, s.flash ?? 0);
  };
  const anim = (dur: number, step: (k: number) => void, delay = 0) => new Promise<void>((res) => tweens.add(dur, step, res, delay));
  const wait = (sec: number) => new Promise<void>((res) => tweens.wait(sec, res));

  function placeShell(cell: number, p: Player, popIn: boolean): any {
    const shell = makeShell(p, cell * 31 + Math.floor(Math.random() * 1000));
    shell.position.copy(slot(cell));
    cube.add(shell);
    shells[cell] = shell;
    owners[cell] = p;
    if (popIn) {
      shell.scale.setScalar(0.2);
      addDrips(shell, cell, p);
      void anim(0.5, (k) => shell.scale.setScalar(0.2 + 0.8 * ease.outElastic(k)));
    }
    return shell;
  }

  function removeShell(cell: number): void {
    const s = shells[cell];
    if (s) cube.remove(s);
    shells[cell] = null;
    owners[cell] = null;
  }

  function impact(cell: number, p: Player): void {
    const color = PLAYER_COLORS[p];
    const target = toWorld(cell);
    const n = towardCamera(target);
    hit({ freeze: 0.06, shake: 0.32, bloom: 0.9, aberr: 0.006 });
    sfx.splat(0.9 + Math.random() * 0.2);
    fx.burst(target.clone().addScaledVector(n, 0.4), color, 18, 4.0, 0.06, n, 0.95);
    fx.mist(target.clone().addScaledVector(n, 0.45), color, 60, 5.5, n);
    fx.splat(target.clone().addScaledVector(n, 0.5), color, 1.7, 0.5);
    fx.ring(target.clone().addScaledVector(n, 0.45), color, 1.9, 0.32);
  }

  /** A paintball thrown from the player's side of the screen onto the cell. */
  async function throwPaint(cell: number, p: Player): Promise<void> {
    const target = toWorld(cell);
    const start = camera.position.clone().add(new T.Vector3(p === 0 ? -1.4 : 1.4, -1.8, -1.2));
    const mid = start.clone().lerp(target, 0.5).add(new T.Vector3(0, 1.3, 0));
    await flyBall(p, (k) => {
      const a = start.clone().lerp(mid, k);
      return a.lerp(mid.clone().lerp(target, k), k);
    }, 0.26);
    impact(cell, p);
    placeShell(cell, p, true);
    await wait(0.35);
  }

  /** A paintball dropped down a column onto its landing cell. */
  async function dropPaint(cell: number, p: Player): Promise<void> {
    cube.updateMatrixWorld();
    const top = cube.localToWorld(slot(cell).setY(2.6));
    const target = toWorld(cell);
    await flyBall(p, (k) => top.clone().lerp(target, ease.inCubic(k)), 0.3);
    impact(cell, p);
    placeShell(cell, p, true);
    await wait(0.3);
  }

  async function flyBall(p: Player, path: (k: number) => any, dur: number): Promise<void> {
    const color = PLAYER_COLORS[p];
    const orb = new T.Group();
    const ballInk = new T.Mesh(dripGeo, M.ink);
    ballInk.scale.setScalar(1.18);
    orb.add(ballInk, new T.Mesh(dripGeo, M.drip[p]));
    orb.scale.setScalar(0.14);
    world.add(orb);
    const prev = path(0);
    await anim(dur, (k) => {
      const pos = path(k);
      orb.position.copy(pos);
      const v = pos.clone().sub(prev);
      if (v.lengthSq() > 1e-6) {
        orb.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), v.clone().normalize());
        orb.scale.set(0.13, 0.13 * (1 + Math.min(1.4, v.length() * 9)), 0.13);
        fx.burst(pos, color, 1, 0.25, 0.035, undefined, 1, 0.3);
      }
      prev.copy(pos);
    });
    world.remove(orb);
  }

  /** Lines flash white along a glowing beam, then burst into paint. */
  async function burstLines(lines: readonly Line[], players: readonly Player[], wave: number, shatter: boolean): Promise<void> {
    const beams: any[] = [];
    const flashMat = new T.MeshBasicMaterial({ color: new T.Color('#ffffff').multiplyScalar(2.6) });
    const cells = [...new Set(lines.flat())];
    lines.forEach((line, k) => {
      const a = slot(line[0]);
      const c = slot(line[2]);
      const beam = new T.Mesh(
        new T.CylinderGeometry(0.09, 0.09, a.distanceTo(c) + 0.5, 12, 1, true),
        new T.MeshBasicMaterial({ color: new T.Color(PLAYER_COLORS[players[k]]).multiplyScalar(3), transparent: true, opacity: 0.9, depthTest: false, blending: T.AdditiveBlending }),
      );
      beam.renderOrder = 10;
      beam.layers.set(1);
      beam.position.copy(a).lerp(c, 0.5);
      beam.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), c.clone().sub(a).normalize());
      beam.scale.set(0.01, 1, 0.01);
      cube.add(beam);
      beams.push(beam);
    });
    const bodies = cells.flatMap((i) => (shells[i]?.children ?? []).filter((m: any) => m.userData.body));
    const saved = bodies.map((m: any) => m.material);
    sfx.whoosh();
    await anim(0.2, (k) => {
      beams.forEach((b) => b.scale.set(0.2 + k * 1.2, 1, 0.2 + k * 1.2));
      cells.forEach((i) => shells[i]?.scale.setScalar(1 + 0.2 * ease.outCubic(k)));
      if (k > 0.4) bodies.forEach((m: any) => (m.material = flashMat));
    });
    hit({ freeze: 0.09, shake: 0.6 + 0.15 * wave, bloom: 1.4 + 0.3 * wave, aberr: 0.014 + 0.006 * wave, flash: 0.16 });
    sfx.burst(wave);
    bodies.forEach((m: any, k: number) => (m.material = saved[k]));
    if (shatter) {
      for (const i of cells) {
        const pos = toWorld(i);
        const color = PLAYER_COLORS[owners[i] ?? players[0]];
        fx.burst(pos, color, 40, 6.5, 0.08);
        fx.mist(pos, color, 90, 8);
        fx.splat(pos.clone().addScaledVector(towardCamera(pos), 0.6), color, 2.6, 0.7);
        fx.ring(pos, color, 2.4, 0.45);
        removeShell(i);
      }
    } else cells.forEach((i) => shells[i]?.scale.setScalar(1));
    const mid = toWorld(lines[0][1]);
    const word = wave > 1 ? `COMBO x${wave}` : 'LINE!';
    void caption(word, PLAYER_COLORS[players[0]], mid.clone().addScaledVector(towardCamera(mid), 2.2), wave > 1 ? 2.4 : 2.7);
    await anim(0.25, (k) => beams.forEach((b) => b.scale.set(1.4 * (1 - k), 1, 1.4 * (1 - k))));
    for (const b of beams) {
      cube.remove(b);
      b.geometry.dispose();
      b.material.dispose();
    }
    flashMat.dispose();
  }

  const AXES = [new T.Vector3(1, 0, 0), new T.Vector3(0, 0, 1), new T.Vector3(0, 1, 0)];
  interface TwistCtx {
    t: Twist;
    perm: readonly number[];
    axisVec: any;
    sign: number;
    moving: number[];
    pivot: any;
    objs: any[];
    /** 0..1 of a quarter turn. */
    f: number;
  }
  let preview: TwistCtx | null = null;

  /** The board's turn direction (about the three.js axis) that carries cells where the rules say. */
  function twistSign(t: Twist): number {
    const perm = permutation(t);
    const moving = Array.from({ length: CELLS }, (_, i) => i).filter((i) => coord(i)[t.axis] === t.slice && i !== CENTER);
    const probe = moving.find((i) => perm[i] !== i)!;
    return slot(probe).applyAxisAngle(AXES[t.axis], Math.PI / 2).distanceTo(slot(perm[probe])) < 0.01 ? 1 : -1;
  }

  function beginTwist(t: Twist): TwistCtx {
    const moving = Array.from({ length: CELLS }, (_, i) => i).filter((i) => coord(i)[t.axis] === t.slice && i !== CENTER);
    const pivot = new T.Group();
    cube.add(pivot);
    const objs = moving.flatMap((i) => [casings[i], shells[i]].filter(Boolean));
    objs.forEach((o) => pivot.attach(o));
    return { t, perm: permutation(t), axisVec: AXES[t.axis], sign: twistSign(t), moving, pivot, objs, f: 0 };
  }

  function turnTo(ctx: TwistCtx, f: number): void {
    ctx.f = f;
    ctx.pivot.quaternion.setFromAxisAngle(ctx.axisVec, ctx.sign * (Math.PI / 2) * f);
  }

  /** Put the layer back without turning it (a cancelled preview). */
  function abandonTwist(ctx: TwistCtx): void {
    ctx.objs.forEach((o) => cube.attach(o));
    cube.remove(ctx.pivot);
    for (const i of ctx.moving) {
      casings[i].position.copy(slot(i));
      casings[i].quaternion.identity();
      if (shells[i]) shells[i].position.copy(slot(i));
    }
  }

  async function twist(t: Twist): Promise<void> {
    let ctx: TwistCtx;
    if (preview && sameTwist(preview.t, t)) {
      ctx = preview;
      preview = null;
      const from = ctx.f;
      await anim(0.12, (k) => turnTo(ctx, from + (1 - from) * k));
    } else {
      if (preview) abandonTwist(preview);
      preview = null;
      ctx = beginTwist(t);
      sfx.whoosh();
      await anim(0.46, (k) => {
        turnTo(ctx, ease.outBack(k));
        if (k < 0.85)
          for (const i of ctx.moving) {
            const s = shells[i];
            if (s) fx.mist(s.getWorldPosition(new T.Vector3()), PLAYER_COLORS[owners[i]!], 2, 0.7);
          }
      });
    }
    const { perm, moving, objs, pivot } = ctx;
    objs.forEach((o) => cube.attach(o));
    cube.remove(pivot);
    for (const i of moving) {
      casings[i].position.copy(slot(i));
      casings[i].quaternion.identity();
    }
    const nShells = shells.slice();
    const nOwners = owners.slice();
    for (const i of moving) {
      nShells[i] = null;
      nOwners[i] = null;
    }
    for (const i of moving) {
      nShells[perm[i]] = shells[i];
      nOwners[perm[i]] = owners[i];
      if (shells[i]) shells[i].position.copy(slot(perm[i]));
    }
    shells = nShells;
    owners = nOwners;
    hit({ shake: 0.18 });
  }

  /** The oldest mark starts to dry out: duller paint and a nervous wobble. */
  function crack(cell: number): void {
    const s = shells[cell];
    const p = owners[cell];
    if (!s || p === null || s.userData.cracking) return;
    s.userData.cracking = true;
    const dry = M.paint[p].clone();
    dry.color.set('#9d97a6');
    s.children.forEach((m: any) => m.userData.body && (m.material = dry));
    s.userData.dry = dry;
  }

  async function fade(cell: number): Promise<void> {
    const s = shells[cell];
    const p = owners[cell];
    if (!s || p === null) return;
    const dry = s.userData.dry ?? M.paint[p].clone();
    s.children.forEach((m: any) => m.userData.body && (m.material = dry));
    const from = dry.color.clone();
    const to = new T.Color('#4a4452');
    sfx.crackle();
    await anim(0.4, (k) => {
      dry.color.copy(from).lerp(to, k);
      dry.emissiveIntensity = 0.04 * (1 - k);
      s.position.copy(slot(cell)).add(new T.Vector3((Math.random() - 0.5) * 0.03 * k, (Math.random() - 0.5) * 0.03 * k, 0));
    });
    const pos = toWorld(cell);
    fx.flakes(pos, '#6b6475', 26, 0.09);
    fx.burst(pos, '#5c5566', 10, 1.4, 0.04);
    hit({ shake: 0.12 });
    removeShell(cell);
    dry.dispose();
  }

  async function fall(moves: { from: number; to: number; player: Player }[]): Promise<void> {
    const moved = moves.map((m) => ({ ...m, s: shells[m.from] }));
    for (const m of moved) {
      shells[m.from] = null;
      owners[m.from] = null;
    }
    for (const m of moved) {
      shells[m.to] = m.s;
      owners[m.to] = m.player;
    }
    await anim(0.32, (k) => {
      for (const m of moved) m.s?.position.copy(slot(m.from).lerp(slot(m.to), ease.inCubic(k)));
    });
    hit({ shake: 0.15 });
    sfx.splat(0.7);
    await anim(0.18, (k) => {
      for (const m of moved) m.s?.scale.set(1 + 0.12 * Math.sin(k * Math.PI), 1 - 0.12 * Math.sin(k * Math.PI), 1 + 0.12 * Math.sin(k * Math.PI));
    });
  }

  async function drench(p: Player | null): Promise<void> {
    if (p === null) {
      void caption('DRAW', '#d9d4e4', toWorld(CENTER).addScaledVector(towardCamera(toWorld(CENTER)), 3), 2.2);
      await wait(0.6);
      await clearAll();
      return;
    }
    const color = PLAYER_COLORS[p];
    const origin = Math.floor(Math.random() * CELLS);
    clock.scale = 0.35;
    hit({ bloom: 1.4, flash: 0.22, shake: 0.6, aberr: 0.015 });
    sfx.win();
    fx.ring(toWorld(CENTER), color, 4.2, 0.8);
    void caption('WIN!', color, toWorld(CENTER).addScaledVector(towardCamera(toWorld(CENTER)), 3), 2.2);
    const jobs: Promise<void>[] = [];
    for (let i = 0; i < CELLS; i++) {
      if (i === CENTER && mode === 'rotating') continue;
      const d = slot(i).distanceTo(slot(origin));
      jobs.push(
        wait(d * 0.09).then(async () => {
          if (shells[i]) removeShell(i);
          const sh = placeShell(i, p, false);
          const w = toWorld(i);
          fx.burst(w, color, 10, 3, 0.06);
          if (i % 3 === 0) fx.splat(w.clone().addScaledVector(towardCamera(w), 0.5), color, 1.8, 0.6);
          await anim(0.4, (k) => sh.scale.setScalar(0.3 + 0.7 * ease.outElastic(k)));
        }),
      );
    }
    await Promise.all(jobs);
    clock.scale = 1;
    await wait(0.9);
  }

  async function clearAll(): Promise<void> {
    const cells = owners.flatMap((o, i) => (o !== null ? [i] : []));
    await Promise.all(
      cells.map((i, n) =>
        anim(0.25, (k) => shells[i]?.scale.setScalar(1 - ease.inCubic(k)), n * 0.012).then(() => {
          fx.burst(toWorld(i), PLAYER_COLORS[owners[i] ?? 0], 4, 1.5, 0.04);
          removeShell(i);
        }),
      ),
    );
  }

  async function play(events: readonly GameEvent[]): Promise<void> {
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      switch (e.type) {
        case 'faded':
          await fade(e.cell);
          break;
        case 'placed':
          if (e.column !== undefined) await dropPaint(e.cell, e.player);
          else await throwPaint(e.cell, e.player);
          break;
        case 'cracking':
          crack(e.cell);
          break;
        case 'twisted':
          await twist(e.twist);
          break;
        case 'lineCompleted': {
          const lines: Line[] = [];
          const players: Player[] = [];
          let j = i;
          for (; j < events.length; j++) {
            const x = events[j];
            if (x.type !== 'lineCompleted' || x.wave !== e.wave) break;
            lines.push(x.cells);
            players.push(x.player);
          }
          i = j - 1;
          await burstLines(lines, players, e.wave, true);
          break;
        }
        case 'shattered':
          e.cells.forEach((c) => shells[c] && removeShell(c));
          break;
        case 'fell':
          await fall(e.moves);
          break;
        case 'roundOver':
          if (e.winner !== null && e.line && mode === 'rotating') await burstLines([e.line], [e.winner], 1, false);
          await drench(e.winner);
          break;
        default:
          break;
      }
    }
  }

  function sync(cells: readonly Cell[]): void {
    for (let i = 0; i < CELLS; i++) {
      if (shells[i]) removeShell(i);
      const p = cells[i];
      if (p !== null) placeShell(i, p, false);
    }
  }

  function setMode(m: Mode): void {
    mode = m;
    const stacking = m === 'cascade';
    for (let i = 0; i < CELLS; i++) {
      const c = casings[i];
      c.material = stacking ? glass : M.casing;
      c.castShadow = !stacking;
      // Glass slots stay out of the outline pass so only the paint gets inked.
      c.layers.set(stacking ? 2 : 0);
      c.visible = !(i === CENTER && !stacking);
    }
    core.visible = !stacking;
    coreLight.visible = !stacking;
    if (stacking) pitch = 0.42;
  }

  // Input: drag spins (yaw only in stacking, so "down" stays down); a tap picks a cell.
  let yaw = 0.78;
  let pitch = 0.5;
  let vyaw = 0;
  let dragging = false;
  let moved = 0;
  let lastX = 0;
  let lastY = 0;
  let lastInput = -10;
  let now = 0;
  const ray = new T.Raycaster();
  ray.layers.enableAll();
  /** The cell (and the hit point in cube space) under a screen point, if any. */
  function pick(clientX: number, clientY: number): { cell: number; local: any } | null {
    const rect = host.getBoundingClientRect();
    ray.setFromCamera(new T.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1), camera);
    const targets = [...casings.filter((c) => c.visible), ...shells.filter(Boolean)];
    const hitObj = ray.intersectObjects(targets, true)[0];
    if (!hitObj) return null;
    let o = hitObj.object;
    while (o && o.userData.cell === undefined && !shells.includes(o)) o = o.parent;
    const cell = o?.userData.cell ?? shells.indexOf(o);
    if (cell < 0) return null;
    cube.updateMatrixWorld();
    return { cell, local: cube.worldToLocal(hitObj.point.clone()) };
  }

  /** Screen-space direction (pixels) of moving from a cell along a cube-space axis. */
  function screenDir(cell: number, axis: any): [number, number] {
    cube.updateMatrixWorld();
    const a = cube.localToWorld(slot(cell)).project(camera);
    const b = cube.localToWorld(slot(cell).addScaledVector(axis, 0.5)).project(camera);
    const rect = host.getBoundingClientRect();
    return [((b.x - a.x) * rect.width) / 2, (-(b.y - a.y) * rect.height) / 2];
  }

  /**
   * Work out the twist a swipe means: the face touched, the face axis the swipe runs
   * along, and so the layer that turns and which way. Returns the rules' Twist plus how
   * many pixels of swipe make a quarter turn along the swipe's screen direction.
   */
  function twistFromSwipe(cell: number, local: any, dx: number, dy: number): { t: Twist; dir: [number, number] } | null {
    const rel = local.clone().sub(slot(cell));
    const ax = [Math.abs(rel.x), Math.abs(rel.y), Math.abs(rel.z)];
    const ni = ax.indexOf(Math.max(...ax));
    const normal = new T.Vector3().setComponent(ni, Math.sign(rel.getComponent(ni)) || 1);
    let best: { along: any; s: number; dot: number; dir: [number, number] } | null = null;
    for (let i = 0; i < 3; i++) {
      if (i === ni) continue;
      const along = new T.Vector3().setComponent(i, 1);
      const [sx, sy] = screenDir(cell, along);
      const len = Math.hypot(sx, sy) || 1;
      const dot = (sx * dx + sy * dy) / len;
      if (!best || Math.abs(dot) > Math.abs(best.dot)) best = { along, s: Math.sign(dot) || 1, dot, dir: [sx / len, sy / len] };
    }
    if (!best) return null;
    // Positive rotation about (normal x along) moves the touched face along +along.
    const rot = new T.Vector3().crossVectors(normal, best.along);
    let sigma = best.s;
    const ri = [Math.abs(rot.x), Math.abs(rot.y), Math.abs(rot.z)].indexOf(1);
    if (rot.getComponent(ri) < 0) sigma = -sigma;
    const axis = ([0, 2, 1] as const)[ri] as Axis; // three x -> rules x, three y -> rules z (height), three z -> rules y
    const slice = coord(cell)[axis] as Slice;
    let t: Twist = { axis, slice, dir: 1 };
    if (twistSign(t) !== sigma) t = { axis, slice, dir: -1 };
    return { t, dir: [best.dir[0] * best.s, best.dir[1] * best.s] };
  }

  let grab: { cell: number; local: any; x0: number; y0: number; twist: { t: Twist; dir: [number, number] } | null; ctx: TwistCtx | null } | null = null;
  const QUARTER_PX = 150;

  const onDown = (e: PointerEvent) => {
    sfx.unlock();
    dragging = true;
    moved = 0;
    lastX = e.clientX;
    lastY = e.clientY;
    host.setPointerCapture?.(e.pointerId);
    grab = null;
    if (board.twistEnabled && mode === 'rotating' && !preview) {
      const p = pick(e.clientX, e.clientY);
      if (p) grab = { ...p, x0: e.clientX, y0: e.clientY, twist: null, ctx: null };
    }
  };
  const onMove = (e: PointerEvent) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    moved += Math.abs(dx) + Math.abs(dy);
    lastInput = now;
    if (grab) {
      const tx = e.clientX - grab.x0;
      const ty = e.clientY - grab.y0;
      if (!grab.twist && Math.hypot(tx, ty) > 14) {
        const tw = twistFromSwipe(grab.cell, grab.local, tx, ty);
        if (tw && board.onTwistIntent?.(tw.t) !== false) {
          grab.twist = tw;
          grab.ctx = beginTwist(tw.t);
          sfx.whoosh();
        } else {
          grab = null;
          return;
        }
      }
      if (grab?.ctx && grab.twist) {
        const along = tx * grab.twist.dir[0] + ty * grab.twist.dir[1];
        turnTo(grab.ctx, Math.max(0, Math.min(1, along / QUARTER_PX)));
      }
      return;
    }
    yaw += dx * 0.009;
    vyaw = dx * 0.009 * 60;
    if (mode === 'rotating') pitch = Math.max(-1.1, Math.min(1.1, pitch + dy * 0.007));
  };
  const onUp = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    if (grab?.ctx) {
      const ctx = grab.ctx;
      grab = null;
      if (ctx.f > 0.28) {
        preview = ctx;
        const from = ctx.f;
        void anim(0.15, (k) => turnTo(ctx, from + (1 - from) * ease.outCubic(k)));
        board.onTwistReady?.(ctx.t);
      } else {
        const from = ctx.f;
        void anim(0.15, (k) => turnTo(ctx, from * (1 - k))).then(() => abandonTwist(ctx));
      }
      return;
    }
    grab = null;
    if (moved > 8) return;
    vyaw = 0;
    lastInput = now;
    const p = pick(e.clientX, e.clientY);
    if (p && !preview) board.onTap?.(p.cell);
  };
  host.addEventListener('pointerdown', onDown);
  host.addEventListener('pointermove', onMove);
  host.addEventListener('pointerup', onUp);
  const onCancel = () => (dragging = false);
  host.addEventListener('pointercancel', onCancel);

  let shakeOff: [number, number, number] = [0, 0, 0];
  const size = new T.Vector2();
  function update(real: number): void {
    const dt = clock.advance(real);
    tweens.update(dt);
    fx.update(dt);
    if (!dragging) {
      vyaw *= Math.exp(-3 * real);
      yaw += vyaw * real;
      if (board.attract || now - lastInput > 6) {
        const home = Math.round((yaw - 0.785) / (Math.PI / 2)) * (Math.PI / 2) + 0.785 + Math.sin(now * 0.35) * 0.32;
        yaw += (home - yaw) * Math.min(1, real * 0.8);
        if (mode === 'rotating') pitch += (0.5 - pitch) * Math.min(1, real * 0.8);
      }
    }
    cube.rotation.set(pitch, yaw, 0, 'XYZ');
    core.scale.setScalar(1 + Math.sin(now * 3) * 0.06);
    core.rotation.y += real * 0.8;
    core.rotation.x += real * 0.5;
    M.core.emissiveIntensity = 2.2 + Math.sin(now * 3) * 0.5;
    coreLight.intensity = 6 + Math.sin(now * 3) * 1.5;
    for (const s of shells) {
      if (s?.userData.cracking) s.rotation.z = Math.sin(now * 40) * 0.015;
    }
    pulse.bloom *= Math.exp(-5 * real);
    pulse.aberr *= Math.exp(-5 * real);
    pulse.flash *= Math.exp(-9 * real);
    shakeOff = shake.update(real);
  }

  function render(): void {
    view.resize();
    const aspect = view.w / view.h;
    const v = (camera.fov * Math.PI) / 180;
    const hfov = 2 * Math.atan(Math.tan(v / 2) * aspect);
    const dist = 2.65 / Math.sin(Math.min(v, hfov) / 2);
    camera.position.set(shakeOff[0], 0.9 + shakeOff[1], dist);
    camera.lookAt(0, 0.1, 0);
    camera.rotateZ(shakeOff[2]);
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    const wallW = Math.max(12, 2 * Math.tan(hfov / 2) * (dist + 5) * 1.15);
    wall.scale.x = wallW / 12;
    wallTex.repeat.x = wallW / 12;
    wallTex.offset.x = -(wallW / 12 - 1) / 2;
    r.getDrawingBufferSize(size);
    post.setSize(size.x, size.y);
    post.strength = 0.55 + pulse.bloom;
    post.aberration = pulse.aberr;
    post.flash = pulse.flash;
    post.render(world, camera, now);
  }

  let last = 0;
  let frames = 0;
  let fpsT = 0;
  let slowFor = 0;
  const loop = manual
    ? null
    : new RenderLoop(host, (t) => {
        const real = Math.min(0.05, Math.max(0, t - last));
        last = t;
        now = t;
        update(real);
        render();
        frames++;
        fpsT += real;
        if (fpsT >= 0.5) {
          const fps = frames / fpsT;
          // Slow phone: trade resolution, then the oil-paint filter, then particles, for frame rate.
          slowFor = fps < 40 ? slowFor + fpsT : 0;
          if (slowFor > 2) {
            if (pixelRatio > 1) {
              pixelRatio = Math.max(1, pixelRatio - 0.25);
              r.setPixelRatio(pixelRatio);
            } else if (post.painterly > 0) post.painterly = 0;
            else fx.budget = 0.5;
            slowFor = 0;
          }
          frames = 0;
          fpsT = 0;
        }
      });

  const board: Board = {
    onTap: null,
    onTwistIntent: null,
    onTwistReady: null,
    twistEnabled: false,
    async cancelTwist() {
      const ctx = preview;
      if (!ctx) return;
      preview = null;
      const from = ctx.f;
      await anim(0.2, (k) => turnTo(ctx, from * (1 - ease.outCubic(k))));
      abandonTwist(ctx);
    },
    swipe(cell, dx, dy) {
      const tw = twistFromSwipe(cell, slot(cell).multiplyScalar(1.5), dx, dy);
      if (!tw || board.onTwistIntent?.(tw.t) === false) return null;
      const ctx = beginTwist(tw.t);
      turnTo(ctx, 1);
      preview = ctx;
      board.onTwistReady?.(tw.t);
      return tw.t;
    },
    attract: false,
    setMode,
    sync,
    play,
    refuse(cell) {
      hit({ shake: 0.12 });
      const s = shells[cell] ?? casings[cell];
      const base = s.position.clone();
      void anim(0.25, (k) => s.position.copy(base).add(new T.Vector3(Math.sin(k * 30) * 0.05 * (1 - k), 0, 0)));
    },
    advance(sec, draw = true) {
      const steps = Math.max(1, Math.round(sec / (1 / 60)));
      for (let i = 0; i < steps; i++) {
        now += sec / steps;
        update(sec / steps);
      }
      if (draw) render();
    },
    dispose() {
      loop?.stop();
      host.removeEventListener('pointerdown', onDown);
      host.removeEventListener('pointermove', onMove);
      host.removeEventListener('pointerup', onUp);
      host.removeEventListener('pointercancel', onCancel);
      tweens.clear();
      fx.clear();
      post.dispose();
      disposeAll(world);
      r.dispose();
      r.domElement.remove();
    },
  };
  if (manual) render();
  return board;
}
