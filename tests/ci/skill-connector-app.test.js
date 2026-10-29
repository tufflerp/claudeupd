'use strict';

/**
 * Checks that the Skill Connector app (apps/skill-connector) is intact and
 * ships exactly the skills in skills/. A browser-level check lives in
 * scripts/skill-connector-check.js.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { buildSkillIndex } = require('../../scripts/lib/skill-index');

const ROOT = path.join(__dirname, '../..');
const APP = path.join(ROOT, 'apps', 'skill-connector');

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

function loadData() {
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(APP, 'data', 'skills-data.js'), 'utf8'), sandbox);
  // Copy out of the sandbox realm so deepStrictEqual compares plain objects.
  return JSON.parse(JSON.stringify(sandbox.window.SKILLS));
}

console.log('\nskill-connector app');

const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(APP, 'app.js'), 'utf8');

test('page loads the loading screen, its data, the shared scanner, the zip writer and the app, in order', () => {
  const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
  assert.deepStrictEqual(scripts, ['boot.js', 'data/skills-data.js', 'data/scan-core.js', 'data/scan-allowlist.js', 'data/zip-store.js', 'app.js']);
});

test('page has no inline scripts', () => {
  assert.strictEqual([...html.matchAll(/<script>/g)].length, 0);
});

test('app script is valid JavaScript', () => {
  assert.doesNotThrow(() => new vm.Script(appJs));
});

test('every element id the app looks up exists in the page', () => {
  const ids = [...appJs.matchAll(/\$\('([a-z-]+)'\)/g)].map((m) => m[1]);
  const created = [...appJs.matchAll(/\.id = '([a-z-]+)'/g)].map((m) => m[1]);
  const missing = [...new Set(ids)].filter((id) => !html.includes(`id="${id}"`) && !created.includes(id));
  assert.deepStrictEqual(missing, []);
});

test('browser copies of the scanner and zip writer match their sources', () => {
  for (const [copy, source] of [['scan-core.js', 'skill-scan-core.js'], ['zip-store.js', 'zip-store.js']]) {
    assert.strictEqual(
      fs.readFileSync(path.join(APP, 'data', copy), 'utf8'),
      fs.readFileSync(path.join(ROOT, 'scripts', 'lib', source), 'utf8'),
      `${copy} is stale (run node scripts/skill-connector-build.js)`
    );
  }
});

test('browser allowlist matches config/skill-scan-allowlist.json', () => {
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(APP, 'data', 'scan-allowlist.js'), 'utf8'), sandbox);
  const shipped = JSON.parse(JSON.stringify(sandbox.window.SKILL_SCAN_ALLOWLIST));
  const source = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'skill-scan-allowlist.json'), 'utf8')).entries
    .map(({ skill, file, rule, sha256 }) => ({ skill, file, rule, sha256 }));
  assert.deepStrictEqual(shipped, source);
});

test('skills data is up to date (run node scripts/skill-connector-build.js)', () => {
  const shipped = loadData();
  const expected = buildSkillIndex(path.join(ROOT, 'skills'));
  assert.strictEqual(shipped.length, expected.length, 'skill count differs');
  assert.deepStrictEqual(shipped, expected);
});

test('every shipped skill has a valid folder, a description and a body', () => {
  const bad = loadData().filter((s) =>
    !/^[a-z0-9][a-z0-9-]*$/.test(s.dir) || !fs.existsSync(path.join(ROOT, 'skills', s.dir, 'SKILL.md')) || !s.description || /^[|>][+-]?$/.test(s.description) || !s.body);
  assert.deepStrictEqual(bad.map((s) => s.name), []);
});

test('skill folders are unique', () => {
  const dirs = loadData().map((s) => s.dir);
  assert.strictEqual(new Set(dirs).size, dirs.length);
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
