'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');
const { createZip, crc32 } = require('../../scripts/lib/zip-store');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}\n    ${err.message}`);
  }
}

/** Read entries back with a small central-directory parser. */
function readZip(buf) {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  const out = {};
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(at + 10);
    const csize = buf.readUInt32LE(at + 20);
    const nameLen = buf.readUInt16LE(at + 28);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.toString('utf8', at + 46, at + 46 + nameLen);
    const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const body = buf.subarray(dataStart, dataStart + csize);
    out[name] = method === 8 ? zlib.inflateRawSync(body) : Buffer.from(body);
    at += 46 + nameLen;
  }
  return out;
}

console.log('\nzip-store.js');

test('crc32 matches the standard check value', () => {
  assert.strictEqual(crc32(Buffer.from('123456789')), 0xcbf43926);
});

const entries = [
  { path: 'demo/SKILL.md', data: Buffer.from('---\nname: demo\n---\n# Demo\n'.repeat(20)) },
  { path: 'demo/scripts/run.sh', data: Buffer.from('echo hi\n') },
  { path: 'demo/assets/ünicode.bin', data: Buffer.from([0, 1, 2, 255]) },
];

test('round-trips stored entries', () => {
  const files = readZip(Buffer.from(createZip(entries)));
  for (const e of entries) assert.deepStrictEqual(files[e.path], Buffer.from(e.data));
});

test('round-trips deflated entries', () => {
  const zip = Buffer.from(createZip(entries, { deflateRaw: (d) => zlib.deflateRawSync(d) }));
  const files = readZip(zip);
  for (const e of entries) assert.deepStrictEqual(files[e.path], Buffer.from(e.data));
  assert.ok(zip.length < Buffer.from(createZip(entries)).length, 'deflate should shrink repetitive text');
});

test('rejects unsafe paths', () => {
  for (const bad of ['../evil', '/abs/path', 'a/../../b', '']) {
    assert.throws(() => createZip([{ path: bad, data: Buffer.from('x') }]), /Unsafe zip path/);
  }
});

test('is readable by the system unzip tool when available', () => {
  let hasUnzip = true;
  try {
    execFileSync('unzip', ['-v'], { stdio: 'ignore' });
  } catch {
    hasUnzip = false;
  }
  if (!hasUnzip) return;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-store-'));
  try {
    const file = path.join(dir, 'x.zip');
    fs.writeFileSync(file, createZip(entries, { deflateRaw: (d) => zlib.deflateRawSync(d) }));
    execFileSync('unzip', ['-tq', file], { stdio: 'pipe' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
