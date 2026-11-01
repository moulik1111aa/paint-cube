// The build makes one self-contained page: everything inlined, three.js carried as inert text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// @ts-expect-error: plain JS build script without type declarations
import { build } from '../scripts/build.mjs';

test('build writes a single self-contained dist/index.html', () => {
  const { bytes } = build();
  assert.ok(bytes > 100_000, 'page should carry the fonts and three.js');
  const html = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
  assert.match(html, /<title>Tic Tac Three by Moulik<\/title>/);
  assert.match(html, /<script type="text\/plain" id="three-src">/);
  assert.match(html, /window\.__BUILD__=\{"version":"\d+\.\d+\.\d+"/);
  assert.doesNotMatch(html, /<script[^>]+\bsrc=/, 'no external scripts');
  assert.doesNotMatch(html, /<link[^>]+stylesheet/, 'no external stylesheets');
  assert.ok(!html.includes('/*__JS__*/') && !html.includes('/*__CSS__*/'), 'all placeholders filled');
});
