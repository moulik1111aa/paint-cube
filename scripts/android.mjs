// Generates the Android project for the APK build (run in CI after `npm run build`).
// The android/ folder is not committed: Capacitor creates it fresh from its template,
// then this script patches the manifest and Gradle file. Every patch checks its anchor,
// so a template change fails the build loudly instead of shipping a broken app.
// Adapted from Study Hard's scripts/android.mjs.
//
//   node scripts/android.mjs
//
// Env: PAINTCUBE_VERSION_CODE (default: GITHUB_RUN_NUMBER, or 1 locally).
import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const run = (cmd) => execSync(cmd, { cwd: root, stdio: 'inherit' });
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const config = JSON.parse(readFileSync(join(root, 'capacitor.config.json'), 'utf8'));

const versionCode = Number(
  process.env.PAINTCUBE_VERSION_CODE ?? (process.env.GITHUB_RUN_NUMBER ? Number(process.env.GITHUB_RUN_NUMBER) : 1),
);
if (!Number.isInteger(versionCode) || versionCode < 1) throw new Error(`bad version code: ${versionCode}`);
const versionName = `${pkg.version} (${versionCode})`;

// 1. Web assets: the single-file app.
const dist = join(root, 'dist/index.html');
if (!existsSync(dist)) throw new Error('dist/index.html is missing: run `npm run build` first');
rmSync(join(root, 'www'), { recursive: true, force: true });
mkdirSync(join(root, 'www'));
cpSync(dist, join(root, 'www/index.html'));

// 2. A fresh Android project from Capacitor's template.
const android = join(root, 'android');
rmSync(android, { recursive: true, force: true });
run('npx cap add android');

// 3. Manifest: portrait only, and vibration for haptics.
const manifestPath = join(android, 'app/src/main/AndroidManifest.xml');
let manifest = readFileSync(manifestPath, 'utf8');
manifest = patch(manifest, 'android:name=".MainActivity"', 'android:name=".MainActivity"\n            android:screenOrientation="portrait"');
manifest = patch(
  manifest,
  '<uses-permission android:name="android.permission.INTERNET" />',
  '<uses-permission android:name="android.permission.INTERNET" />\n    <uses-permission android:name="android.permission.VIBRATE" />',
);
writeFileSync(manifestPath, manifest);

// 4. Gradle: version and release signing (from CI secrets).
const gradlePath = join(android, 'app/build.gradle');
const gradle = readFileSync(gradlePath, 'utf8');
if (!gradle.includes(`applicationId "${config.appId}"`)) throw new Error('app/build.gradle: applicationId not set by the template');
writeFileSync(
  gradlePath,
  `${gradle}

// ── Paint Cube release settings (added by scripts/android.mjs) ──
android {
    defaultConfig {
        versionCode ${versionCode}
        versionName "${versionName}"
    }
    signingConfigs {
        release {
            def ks = System.getenv("PAINTCUBE_KEYSTORE")
            if (ks) {
                storeFile file(ks)
                storePassword System.getenv("PAINTCUBE_KEYSTORE_PASSWORD")
                keyAlias System.getenv("PAINTCUBE_KEY_ALIAS")
                keyPassword System.getenv("PAINTCUBE_KEY_PASSWORD")
            }
        }
    }
    buildTypes {
        release {
            // Without the keystore (e.g. a fork), fall back to the debug key so the APK still installs.
            signingConfig System.getenv("PAINTCUBE_KEYSTORE") ? signingConfigs.release : signingConfigs.debug
        }
    }
}
`,
);

// 5. Copy the web assets and config into the native project.
run('npx cap sync android');
console.log(`android/ ready: ${config.appId} ${versionName}`);

function patch(text, anchor, replacement) {
  if (!text.includes(anchor)) throw new Error(`patch anchor not found: ${anchor}`);
  return text.replace(anchor, replacement);
}
