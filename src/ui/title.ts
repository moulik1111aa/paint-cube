// Placeholder title screen (M0): the name and a slowly turning 3x3x3 cube, to prove the
// whole pipeline end to end, three.js included, on the phone and on the website.

import { loadThree, makeRenderer, RenderLoop, disposeAll, type Three } from '../render/three.ts';

declare global {
  interface Window {
    __BUILD__?: { version: string; builtAt: string };
  }
}

export function showTitle(app: HTMLElement): () => void {
  const root = document.createElement('div');
  root.className = 'title-screen';
  root.dataset.threeD = 'loading';
  root.innerHTML =
    '<div class="stage"></div>' +
    '<h1><span class="p1">Paint</span> <span class="p2">Cube</span></h1>' +
    `<p class="note">Build ${window.__BUILD__?.version ?? 'dev'} · game coming soon</p>`;
  app.appendChild(root);
  const stage = root.querySelector('.stage') as HTMLElement;

  let stopScene: (() => void) | null = null;
  let gone = false;
  loadThree()
    .then((T) => {
      if (gone) return;
      stopScene = previewCube(T, stage);
      root.dataset.threeD = 'ok';
    })
    .catch(() => {
      if (gone) return;
      root.dataset.threeD = 'off';
      stage.insertAdjacentHTML('beforeend', '<div class="no3d">3D is not available on this device</div>');
    });

  return () => {
    gone = true;
    stopScene?.();
    root.remove();
  };
}

/** Bounding-sphere radius of the 3x3x3 cube (plus a little air). */
const CUBE_RADIUS = 1.5 * Math.sqrt(3) * 1.08;

/** Place the camera so the whole cube fits, whatever the screen's shape. */
function fit(T: Three, camera: Three, aspect: number): void {
  const v = (camera.fov * Math.PI) / 180;
  const h = 2 * Math.atan(Math.tan(v / 2) * aspect);
  const dist = CUBE_RADIUS / Math.sin(Math.min(v, h) / 2);
  camera.aspect = aspect;
  camera.position.copy(new T.Vector3(6, 5, 8).normalize().multiplyScalar(dist));
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
}

/** A 3x3x3 cube of cells with a few paint marks and the glowing Core, turning slowly. */
function previewCube(T: Three, host: HTMLElement): () => void {
  const view = makeRenderer(T, host);
  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(35, 1, 0.1, 100);
  camera.position.set(6, 5, 8);
  camera.lookAt(0, 0, 0);

  scene.add(new T.AmbientLight('#ffffff', 0.55));
  const key = new T.DirectionalLight('#ffffff', 1.6);
  key.position.set(4, 8, 6);
  scene.add(key);

  const cube = new T.Group();
  scene.add(cube);
  const geo = new T.BoxGeometry(0.86, 0.86, 0.86);
  const matte = new T.MeshStandardMaterial({ color: '#2a2936', roughness: 0.85, metalness: 0 });
  const orange = new T.MeshStandardMaterial({ color: '#ff7a1a', roughness: 0.55 });
  const blue = new T.MeshStandardMaterial({ color: '#1aa3ff', roughness: 0.55 });
  const core = new T.MeshStandardMaterial({ color: '#f5e663', emissive: '#f5e663', emissiveIntensity: 1.2 });
  const painted: Record<string, unknown> = { '0,2,2': orange, '2,0,2': orange, '2,2,0': blue, '0,0,0': blue, '2,1,2': orange };
  for (let x = 0; x < 3; x++)
    for (let y = 0; y < 3; y++)
      for (let z = 0; z < 3; z++) {
        const k = `${x},${y},${z}`;
        const mat = k === '1,1,1' ? core : (painted[k] ?? matte);
        const m = new T.Mesh(k === '1,1,1' ? new T.BoxGeometry(0.5, 0.5, 0.5) : geo, mat);
        m.position.set(x - 1, y - 1, z - 1);
        cube.add(m);
      }

  const loop = new RenderLoop(host, (t) => {
    view.resize();
    fit(T, camera, view.w / view.h);
    cube.rotation.y = t * 0.35;
    cube.rotation.x = Math.sin(t * 0.4) * 0.15;
    view.r.render(scene, camera);
  });

  return () => {
    loop.stop();
    geo.dispose();
    disposeAll(scene);
    view.r.dispose();
    view.r.domElement.remove();
  };
}
