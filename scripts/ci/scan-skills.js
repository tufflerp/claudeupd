#!/usr/bin/env node
/**
 * Safety-scan every skill folder for malware-like content.
 *
 * Usage:
 *   node scripts/ci/scan-skills.js [--dir <skills-dir>] [--verbose] [--json]
 *
 * Exits 1 when any skill has a `block` finding that is not covered by a
 * reviewed exception in config/skill-scan-allowlist.json. Warnings are
 * printed with --verbose but never fail the run.
 */

'use strict';

const path = require('path');
const { scanSkillsDir, loadAllowlist, applyAllowlist } = require('../lib/skill-scan');

const ROOT = path.join(__dirname, '../..');
const ALLOWLIST = path.join(ROOT, 'config', 'skill-scan-allowlist.json');

function parseArgs(argv) {
  const options = { dir: path.join(ROOT, 'skills'), verbose: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dir') options.dir = path.resolve(argv[++i]);
    else if (argv[i] === '--verbose') options.verbose = true;
    else if (argv[i] === '--json') options.json = true;
  }
  return options;
}

function scanWithAllowlist(skillsDir) {
  const allowlist = loadAllowlist(ALLOWLIST);
  // Repo working tree: git-ignored interpreter caches are not shipped, so skip them.
  return scanSkillsDir(skillsDir, { ignoreCaches: true }).map((result) =>
    applyAllowlist(result, path.join(skillsDir, result.name), allowlist));
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const results = scanWithAllowlist(options.dir);

  if (options.json) {
    console.log(JSON.stringify(results, null, 2));
    process.exit(results.some((r) => r.blocked) ? 1 : 0);
  }

  let blocked = 0;
  let warnings = 0;
  let allowed = 0;

  for (const result of results) {
    for (const f of result.findings) {
      const where = `${result.name}/${f.file}${f.line ? `:${f.line}` : ''}`;
      if (f.severity === 'block') {
        blocked++;
        console.error(`BLOCK: ${where} [${f.rule}] ${f.message}`);
      } else if (f.severity === 'allowed') {
        allowed++;
        if (options.verbose) console.log(`ALLOWED: ${where} [${f.rule}] ${f.reason}`);
      } else {
        warnings++;
        if (options.verbose) console.log(`WARN: ${where} [${f.rule}] ${f.message}`);
      }
    }
  }

  const failing = results.filter((r) => r.blocked).length;
  console.log(
    `Scanned ${results.length} skills: ${failing} blocked, ` +
    `${warnings} warnings, ${allowed} reviewed exceptions` +
    (options.verbose ? '' : ' (use --verbose for details)')
  );
  if (blocked) {
    console.error('Remove the flagged content, or review it and add a pinned entry to config/skill-scan-allowlist.json.');
  }
  process.exit(failing ? 1 : 0);
}

if (require.main === module) {
  main();
}

module.exports = { scanWithAllowlist };
