import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../../', import.meta.url));
const jsDir = path.join(root, 'js');
const dispatchDir = path.join(jsDir, 'dispatch');
let passed = 0;
let failed = 0;

async function files(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map(entry => {
    const name = path.join(dir, entry.name);
    return entry.isDirectory() ? files(name) : entry.isFile() ? [name] : [];
  }));
  return nested.flat();
}

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log('PASS', name);
  } catch (e) {
    failed++;
    console.log('FAIL', name, '→', e.message);
  }
}

await test('js：仅 timer.js 有一处 setInterval', async () => {
  const matches = [];
  for (const file of await files(jsDir)) {
    const text = await readFile(file, 'utf8');
    for (const match of text.matchAll(/\bsetInterval\s*\(/g)) matches.push(file);
  }
  assert.deepEqual(matches, [path.join(jsDir, 'timer.js')]);
});

await test('dispatch：无 setInterval 或 while 循环', async () => {
  for (const file of await files(dispatchDir)) {
    const text = await readFile(file, 'utf8');
    assert.ok(!/\b(?:window\s*\.\s*)?setInterval\s*\(|\bwhile\s*\(/.test(text), path.relative(root, file));
  }
});

await test('today.html：无 setInterval', async () => {
  const text = await readFile(path.join(root, 'today.html'), 'utf8');
  assert.ok(!/\bsetInterval\s*\(/.test(text));
});

console.log(`SUMMARY pass=${passed} fail=${failed}`);
if (failed) process.exitCode = 1;
