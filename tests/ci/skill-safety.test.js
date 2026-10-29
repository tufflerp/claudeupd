'use strict';

/**
 * Repository-wide skill safety gate.
 *
 * Runs on every `node tests/run-all.js`, so any skill added in the future is
 * scanned automatically, and any imported skill that changes after review is
 * caught by its pinned hash.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { scanWithAllowlist } = require('../../scripts/ci/scan-skills');
const { treeHash } = require('../../scripts/import-skills');

const ROOT = path.join(__dirname, '../..');
const SKILLS_DIR = path.join(ROOT, 'skills');
const PROVENANCE = path.join(ROOT, 'config', 'imported-skills.json');
const ALLOWLIST = path.join(ROOT, 'config', 'skill-scan-allowlist.json');

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

console.log('\nskill safety');

test('every skill passes the safety scan', () => {
  const blocked = scanWithAllowlist(SKILLS_DIR)
    .filter((r) => r.blocked)
    .map((r) => `${r.name}: ${r.findings.filter((f) => f.severity === 'block').map((f) => `${f.rule}@${f.file}`).join(', ')}`);
  assert.deepStrictEqual(blocked, [], `Blocked skills:\n${blocked.join('\n')}`);
});

const provenance = JSON.parse(fs.readFileSync(PROVENANCE, 'utf8'));

test('every imported skill still exists', () => {
  const missing = provenance.skills.filter((s) => !fs.existsSync(path.join(SKILLS_DIR, s.name, 'SKILL.md'))).map((s) => s.name);
  assert.deepStrictEqual(missing, []);
});

test('imported skills are unchanged since review (run --rehash after a reviewed edit)', () => {
  const changed = provenance.skills
    .filter((s) => fs.existsSync(path.join(SKILLS_DIR, s.name)))
    .filter((s) => treeHash(path.join(SKILLS_DIR, s.name)) !== s.sha256)
    .map((s) => s.name);
  assert.deepStrictEqual(changed, [], `Changed without review: ${changed.join(', ')}`);
});

test('imported skills carry a license and full source details', () => {
  const problems = [];
  for (const s of provenance.skills) {
    const dir = path.join(SKILLS_DIR, s.name);
    if (!fs.existsSync(dir)) continue;
    if (!fs.readdirSync(dir).some((n) => /^licen[cs]e/i.test(n))) problems.push(`${s.name}: no license file`);
    for (const key of ['repo', 'commit', 'path', 'license', 'sourceSha256', 'sha256']) {
      if (!s[key]) problems.push(`${s.name}: missing ${key}`);
    }
    if (!/^[0-9a-f]{40}$/.test(s.commit || '')) problems.push(`${s.name}: commit is not a full sha`);
  }
  assert.deepStrictEqual(problems, []);
});

test('reviewed exceptions are complete, and point at existing files for bundled skills', () => {
  // Entries for skills that are not bundled (e.g. claude-api) still apply when the
  // app scans them from GitHub, so only bundled skills must have the file locally.
  const { entries } = JSON.parse(fs.readFileSync(ALLOWLIST, 'utf8'));
  const problems = entries
    .filter((e) => !e.reason || !/^[0-9a-f]{64}$/.test(e.sha256 || '') ||
      (fs.existsSync(path.join(SKILLS_DIR, e.skill)) && !fs.existsSync(path.join(SKILLS_DIR, e.skill, e.file))))
    .map((e) => `${e.skill}/${e.file}`);
  assert.deepStrictEqual(problems, [], 'Stale or incomplete allowlist entries');
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
