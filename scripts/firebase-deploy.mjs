// Publishes site/ to Firebase Hosting through the Hosting REST API (no firebase-tools,
// so no extra project roles are needed beyond "Firebase Hosting Admin").
//
//   FIREBASE_SERVICE_ACCOUNT='<json key>' node scripts/firebase-deploy.mjs [siteId]
//
// Steps: sign a JWT with the service account key → access token → new version →
// list file hashes → upload the files Hosting doesn't have → finalize → release.
import { createHash, createSign } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const siteDir = join(root, 'site');
const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT ?? 'null');
if (!sa?.private_key || !sa?.client_email) throw new Error('FIREBASE_SERVICE_ACCOUNT is missing or not a service account key');
const site = process.argv[2] ?? sa.project_id;
const API = 'https://firebasehosting.googleapis.com/v1beta1';

const b64 = (x) => Buffer.from(x).toString('base64url');
async function accessToken() {
  const now = Math.floor(Date.now() / 1000);
  const head = b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.hosting https://www.googleapis.com/auth/cloud-platform', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const sig = createSign('RSA-SHA256').update(`${head}.${claims}`).sign(sa.private_key, 'base64url');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${head}.${claims}.${sig}`,
  });
  if (!r.ok) throw new Error(`token: ${r.status} ${await r.text()}`);
  return (await r.json()).access_token;
}

const token = await accessToken();
async function call(method, url, body, type = 'application/json') {
  const r = await fetch(url, { method, headers: { authorization: `Bearer ${token}`, 'content-type': type }, body: body === undefined ? undefined : type === 'application/json' ? JSON.stringify(body) : body });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${url}: ${r.status} ${text}`);
  return text ? JSON.parse(text) : {};
}

// Files: gzip each and hash the gzipped bytes (what Hosting stores).
const files = {};
const walk = (d) => readdirSync(d).forEach((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : (files['/' + relative(siteDir, join(d, f)).split('\\').join('/')] = gzipSync(readFileSync(join(d, f)), { level: 9 }))));
walk(siteDir);
const hashes = Object.fromEntries(Object.entries(files).map(([p, gz]) => [p, createHash('sha256').update(gz).digest('hex')]));
console.log('files', Object.keys(files));

const version = await call('POST', `${API}/sites/${site}/versions`, {
  config: { headers: [{ glob: '**', headers: { 'Cache-Control': 'no-cache' } }] },
});
console.log('version', version.name);
const pop = await call('POST', `${API}/${version.name}:populateFiles`, { files: hashes });
for (const h of pop.uploadRequiredHashes ?? []) {
  const path = Object.keys(hashes).find((p) => hashes[p] === h);
  await call('POST', `${pop.uploadUrl}/${h}`, files[path], 'application/octet-stream');
  console.log('uploaded', path);
}
await call('PATCH', `${API}/${version.name}?update_mask=status`, { status: 'FINALIZED' });
const rel = await call('POST', `${API}/sites/${site}/releases?versionName=${encodeURIComponent(version.name)}`, {});
console.log('released', rel.name, `→ https://${site}.web.app`);
