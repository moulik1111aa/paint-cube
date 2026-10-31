// Generates the app icon (legacy + adaptive), the splash image and the web favicon
// from one SVG drawing: a graffiti isometric cube, sprayed orange and blue, with ink
// outlines, drips and a white shine. Run by hand when the icon changes; the PNGs are
// committed under native/android/res and copied into the Android project by
// scripts/android.mjs.
//
//   npm run icons        (needs `sharp`, e.g. installed globally)
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let sharp;
try {
  sharp = createRequire(import.meta.url)('sharp');
} catch {
  sharp = createRequire(join(execSync('npm root -g').toString().trim(), 'noop.js'))('sharp');
}

const BG = '#1a0f38';

/** The cube, drawn in a 512 box. */
const cube = `
  <defs>
    <linearGradient id="top" x1="0" y1="0" x2="0.3" y2="1"><stop offset="0" stop-color="#ffc23d"/><stop offset="0.7" stop-color="#ff6a13"/></linearGradient>
    <linearGradient id="left" x1="0" y1="0" x2="0.3" y2="1"><stop offset="0" stop-color="#7ff0ff"/><stop offset="0.7" stop-color="#1aa0ff"/></linearGradient>
    <linearGradient id="right" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d9d4e4"/><stop offset="1" stop-color="#a59fb8"/></linearGradient>
  </defs>
  <g stroke="#0d0a14" stroke-linejoin="round" stroke-linecap="round">
    <path d="M256 92 L420 186 L256 280 L92 186 Z" fill="url(#top)" stroke-width="16"/>
    <path d="M92 186 L256 280 L256 456 L92 362 Z" fill="url(#left)" stroke-width="16"/>
    <path d="M256 280 L420 186 L420 362 L256 456 Z" fill="url(#right)" stroke-width="16"/>
    <g stroke-width="6" fill="none" opacity="0.8">
      <path d="M201 123 L365 217 M147 155 L311 249"/>
      <path d="M311 123 L147 217 M365 155 L201 249"/>
      <path d="M92 248 L256 342 M92 300 L256 394"/>
      <path d="M147 218 L147 393 M201 249 L201 425"/>
      <path d="M256 342 L420 248 M256 394 L420 300"/>
      <path d="M311 249 L311 425 M365 218 L365 393"/>
    </g>
    <path d="M300 330 q24 -18 44 4 q16 18 -6 34 q-22 14 -40 -6 q-12 -16 2 -32 Z" fill="#ff6a13" stroke-width="7"/>
  </g>
  <g stroke-linecap="round" fill="none">
    <path d="M128 371 L128 420" stroke="#0d0a14" stroke-width="22"/><path d="M128 371 L128 420" stroke="#1aa0ff" stroke-width="10"/>
    <path d="M190 407 L190 470" stroke="#0d0a14" stroke-width="22"/><path d="M190 407 L190 470" stroke="#1aa0ff" stroke-width="10"/>
    <path d="M330 412 L330 446" stroke="#0d0a14" stroke-width="20"/><path d="M330 412 L330 446" stroke="#a59fb8" stroke-width="9"/>
    <path d="M200 150 L250 122" stroke="#fff" stroke-width="14"/>
    <path d="M186 172 L204 162" stroke="#fff" stroke-width="8"/>
  </g>
  <path d="M318 118 l6 14 l14 6 l-14 6 l-6 14 l-6 -14 l-14 -6 l14 -6 Z" fill="#fff"/>`;

const svg = (size, { background = true, scale = 1 } = {}) => {
  const s = 512 * scale;
  const off = (512 - s) / 2;
  const bg = background
    ? `<radialGradient id="bg" cx="0.5" cy="0.4" r="0.7"><stop offset="0" stop-color="#3a1d7a"/><stop offset="1" stop-color="${BG}"/></radialGradient><rect width="512" height="512" fill="url(#bg)"/>` +
      Array.from({ length: 70 }, (_, i) => {
        const x = (i * 97) % 512;
        const y = (i * 61 + 37) % 512;
        const c = ['#ff3d8b', '#38d6ff', '#f5e663'][i % 3];
        return `<circle cx="${x}" cy="${y}" r="${1.5 + (i % 4)}" fill="${c}" opacity="0.35"/>`;
      }).join('')
    : '';
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">${bg}<g transform="translate(${off} ${off}) scale(${scale})">${cube}</g></svg>`);
};

const res = join(root, 'native/android/res');
const legacy = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
for (const [d, px] of Object.entries(legacy)) {
  const dir = join(res, `mipmap-${d}`);
  mkdirSync(dir, { recursive: true });
  await sharp(svg(px, { scale: 0.92 })).png().toFile(join(dir, 'ic_launcher.png'));
  const round = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}"><circle cx="${px / 2}" cy="${px / 2}" r="${px / 2}" fill="#fff"/></svg>`);
  await sharp(svg(px, { scale: 0.85 })).composite([{ input: round, blend: 'dest-in' }]).png().toFile(join(dir, 'ic_launcher_round.png'));
  // Adaptive foreground: 108dp canvas, the cube inside the 66dp safe zone.
  await sharp(svg(Math.round((px * 108) / 48), { background: false, scale: 0.6 })).png().toFile(join(dir, 'ic_launcher_foreground.png'));
}
mkdirSync(join(res, 'values'), { recursive: true });
writeFileSync(join(res, 'values/ic_launcher_background.xml'), `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${BG}</color>\n</resources>\n`);

// Splash (pre-Android 12): the icon on the app's dark background.
mkdirSync(join(res, 'drawable'), { recursive: true });
const splashIcon = await sharp(svg(560, { background: false, scale: 0.9 })).png().toBuffer();
await sharp({ create: { width: 1080, height: 1920, channels: 4, background: '#0b0816' } })
  .composite([{ input: splashIcon, gravity: 'center' }])
  .png()
  .toFile(join(res, 'drawable/splash.png'));

// Web favicon, inlined into src/index.html.
const fav = (await sharp(svg(64)).png().toBuffer()).toString('base64');
const indexPath = join(root, 'src/index.html');
const html = readFileSync(indexPath, 'utf8').replace(/<link rel="icon"[^>]*>\n?/, '');
writeFileSync(indexPath, html.replace('<title>', `<link rel="icon" href="data:image/png;base64,${fav}">\n<title>`));
await sharp(svg(512)).png().toFile(join(root, 'assets/icon-512.png'));
console.log('icons, splash and favicon written');
