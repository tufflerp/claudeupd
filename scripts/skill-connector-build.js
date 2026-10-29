#!/usr/bin/env node
/**
 * Build the Skill Connector app's data folder (apps/skill-connector/data):
 *
 *   skills-data.js      skill names, descriptions and SKILL.md bodies (committed)
 *   scan-core.js        copy of scripts/lib/skill-scan-core.js (committed)
 *   zip-store.js        copy of scripts/lib/zip-store.js (committed)
 *   scan-allowlist.js   hash-pinned reviewed exceptions from config/ (committed)
 *   skill-files/*.js    every file of each skill, loaded on install (generated, git-ignored)
 *
 * Refuses to build if any skill is unsafe or could not be fully checked.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { buildSkillIndex, listSkillFiles } = require('./lib/skill-index');
const { scanWithAllowlist } = require('./ci/scan-skills');
const { loadAllowlist } = require('./lib/skill-scan');

const ROOT = path.join(__dirname, '..');
const SKILLS_DIR = path.join(ROOT, 'skills');
const DATA_DIR = path.join(ROOT, 'apps', 'skill-connector', 'data');
const FILES_DIR = path.join(DATA_DIR, 'skill-files');

/**
 * List a skill's files as { path, text } or { path, base64 } records.
 */
function collectFiles(skillDir) {
  return listSkillFiles(skillDir).map((f) => {
    const data = fs.readFileSync(f.full);
    const text = data.toString('utf8');
    // Keep valid UTF-8 as text (smaller, readable); everything else as base64.
    return Buffer.from(text, 'utf8').equals(data) ? { path: f.path, text } : { path: f.path, base64: data.toString('base64') };
  });
}

function main() {
  // Never ship a skill that is unsafe or that could not be fully checked.
  const blocked = scanWithAllowlist(SKILLS_DIR).filter((r) => r.blocked || r.unverified);
  if (blocked.length) {
    for (const result of blocked) {
      for (const f of result.findings.filter((x) => x.severity === 'block' || x.severity === 'unverified')) {
        console.error(`[skill-connector] BLOCK ${result.name}/${f.file}: ${f.message}`);
      }
    }
    console.error('[skill-connector] Build aborted: fix or review the flagged skills (node scripts/ci/scan-skills.js).');
    process.exit(1);
  }

  const skills = buildSkillIndex(SKILLS_DIR);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, 'skills-data.js'), `window.SKILLS = ${JSON.stringify(skills)};\n`, 'utf8');
  fs.copyFileSync(path.join(__dirname, 'lib', 'skill-scan-core.js'), path.join(DATA_DIR, 'scan-core.js'));
  fs.copyFileSync(path.join(__dirname, 'lib', 'zip-store.js'), path.join(DATA_DIR, 'zip-store.js'));
  const allowlist = loadAllowlist(path.join(ROOT, 'config', 'skill-scan-allowlist.json'))
    .map(({ skill, file, rule, sha256 }) => ({ skill, file, rule, sha256 }));
  fs.writeFileSync(path.join(DATA_DIR, 'scan-allowlist.js'), `window.SKILL_SCAN_ALLOWLIST = ${JSON.stringify(allowlist, null, 2)};\n`, 'utf8');

  fs.rmSync(FILES_DIR, { recursive: true, force: true });
  fs.mkdirSync(FILES_DIR, { recursive: true });
  let bytes = 0;
  for (const skill of skills) {
    const files = collectFiles(path.join(SKILLS_DIR, skill.dir));
    const payload = `(window.SKILL_FILES = window.SKILL_FILES || {})[${JSON.stringify(skill.dir)}] = ${JSON.stringify(files)};\n`;
    fs.writeFileSync(path.join(FILES_DIR, `${skill.dir}.js`), payload, 'utf8');
    bytes += payload.length;
  }

  console.log(`[skill-connector] Wrote ${skills.length} skills to ${path.relative(ROOT, DATA_DIR)} (${(bytes / 1024 / 1024).toFixed(1)} MB of skill files)`);
}

if (require.main === module) {
  main();
}

module.exports = { collectFiles };
