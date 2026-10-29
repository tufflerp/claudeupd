#!/usr/bin/env node
/**
 * Import third-party skills into skills/ after a safety scan.
 *
 * Usage:
 *   node scripts/import-skills.js --repo <owner/name> --commit <sha> \
 *     [--license <file>] [--license-name <spdx>] <skill-dir> [<skill-dir> ...]
 *
 * Each skill is refused (and nothing is copied) when it:
 *   - fails the safety scan (scripts/lib/skill-scan.js) without a reviewed exception
 *   - has a name that already exists in skills/
 *   - has no license file and no --license fallback
 *   - is a canonical upstream skill the repo deliberately does not bundle
 *
 * Imported skills are recorded in config/imported-skills.json with their source
 * repository, commit, path and content hashes, so they can be audited later.
 * `sourceSha256` is the skill as imported; `sha256` is the reviewed current
 * content. After a reviewed local edit (for example repo lint fixes), run:
 *
 *   node scripts/import-skills.js --rehash <skill-name> [<skill-name> ...]
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parseFrontmatter } = require('./lib/skill-index');
const { scanSkill, loadAllowlist, applyAllowlist } = require('./lib/skill-scan');

const ROOT = path.join(__dirname, '..');
const SKILLS_DIR = path.join(ROOT, 'skills');
const ALLOWLIST = path.join(ROOT, 'config', 'skill-scan-allowlist.json');
const PROVENANCE = path.join(ROOT, 'config', 'imported-skills.json');
const MODULES = path.join(ROOT, 'manifests', 'install-modules.json');
const THIRD_PARTY_MODULE = 'third-party-skills';
const MARKDOWNLINT_IGNORE = path.join(ROOT, '.markdownlintignore');
const PACKAGE_JSON = path.join(ROOT, 'package.json');
// Installed straight from anthropics/skills instead (tests/ci/agent-yaml-surface.test.js).
const CANONICAL_UPSTREAM = new Set(['claude-api', 'frontend-design']);

function parseArgs(argv) {
  const options = { repo: null, commit: null, license: null, licenseName: null, rehash: false, dirs: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--rehash') options.rehash = true;
    else if (arg === '--repo') options.repo = argv[++i];
    else if (arg === '--commit') options.commit = argv[++i];
    else if (arg === '--license') options.license = path.resolve(argv[++i]);
    else if (arg === '--license-name') options.licenseName = argv[++i];
    else options.dirs.push(path.resolve(arg));
  }
  return options;
}

function findLicense(dir) {
  return fs.readdirSync(dir).find((name) => /^licen[cs]e(\.(txt|md))?$/i.test(name)) || null;
}

function treeHash(dir) {
  const hash = crypto.createHash('sha256');
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        visit(full);
      } else {
        hash.update(path.relative(dir, full).split(path.sep).join('/'));
        hash.update('\0');
        hash.update(fs.readFileSync(full));
        hash.update('\0');
      }
    }
  };
  visit(dir);
  return hash.digest('hex');
}

function repoRelativePath(dir) {
  let current = dir;
  while (current !== path.dirname(current)) {
    if (fs.existsSync(path.join(current, '.git'))) {
      return path.relative(current, dir).split(path.sep).join('/');
    }
    current = path.dirname(current);
  }
  return path.basename(dir);
}

/**
 * Register imported skills in the opt-in third-party install module so the
 * installer and manifest validation know about them.
 */
function registerInModule(names) {
  const manifest = JSON.parse(fs.readFileSync(MODULES, 'utf8'));
  const mod = manifest.modules.find((m) => m.id === THIRD_PARTY_MODULE);
  if (!mod) {
    console.error(`WARNING: install module ${THIRD_PARTY_MODULE} not found; add the imported skills to a module by hand`);
    return;
  }
  const paths = new Set(mod.paths);
  for (const name of names) paths.add(`skills/${name}`);
  mod.paths = [...paths].sort();
  fs.writeFileSync(MODULES, `${JSON.stringify(manifest, null, 2)}\n`);
}

/** Keep imported skills' upstream markdown out of the repo's markdownlint run. */
function ignoreForMarkdownlint(names) {
  const existing = fs.existsSync(MARKDOWNLINT_IGNORE) ? fs.readFileSync(MARKDOWNLINT_IGNORE, 'utf8') : '';
  const lines = new Set(existing.split('\n').filter(Boolean));
  for (const name of names) lines.add(`skills/${name}/`);
  const comments = [...lines].filter((l) => l.startsWith('#'));
  const paths = [...lines].filter((l) => !l.startsWith('#')).sort();
  fs.writeFileSync(MARKDOWNLINT_IGNORE, `${comments.concat(paths).join('\n')}\n`);
}

/** Publish imported skills with the npm package (package.json "files"). */
function addToPackageFiles(names) {
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8'));
  const files = new Set(pkg.files);
  const missing = names.map((n) => `skills/${n}/`).filter((p) => !files.has(p));
  if (!missing.length) return;
  const skillIdx = pkg.files.map((f, i) => (f.startsWith('skills/') ? i : -1)).filter((i) => i >= 0);
  if (!skillIdx.length) {
    pkg.files.push(...missing);
  } else {
    const first = skillIdx[0];
    const last = skillIdx[skillIdx.length - 1];
    const block = pkg.files.slice(first, last + 1).concat(missing).sort();
    pkg.files = pkg.files.slice(0, first).concat(block, pkg.files.slice(last + 1));
  }
  fs.writeFileSync(PACKAGE_JSON, `${JSON.stringify(pkg, null, 2)}\n`);
}

function loadProvenance() {
  if (!fs.existsSync(PROVENANCE)) return { skills: [] };
  return JSON.parse(fs.readFileSync(PROVENANCE, 'utf8'));
}

/**
 * Check one skill folder and decide whether it may be imported.
 *
 * @returns {{ ok: boolean, name: string, reason?: string, scan?: object }}
 */
function checkSkill(dir, options, allowlist) {
  const skillMd = path.join(dir, 'SKILL.md');
  if (!fs.existsSync(skillMd)) {
    return { ok: false, name: path.basename(dir), reason: 'no SKILL.md' };
  }

  const { attributes } = parseFrontmatter(fs.readFileSync(skillMd, 'utf8'));
  const name = attributes.name || path.basename(dir);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
    return { ok: false, name, reason: 'skill name must be lowercase letters, digits and hyphens' };
  }
  if (!attributes.description) {
    return { ok: false, name, reason: 'SKILL.md frontmatter has no description' };
  }
  if (CANONICAL_UPSTREAM.has(name)) {
    return { ok: false, name, reason: 'canonical Anthropic skill; install it from anthropics/skills instead of bundling it' };
  }
  if (fs.existsSync(path.join(SKILLS_DIR, name))) {
    return { ok: false, name, reason: `skills/${name} already exists` };
  }
  if (!findLicense(dir) && !options.license) {
    return { ok: false, name, reason: 'no license file in the skill and no --license given' };
  }

  // Scan under the target name so allowlist entries match the imported skill.
  const raw = { ...scanSkill(dir), name };
  const scan = applyAllowlist(raw, dir, allowlist);
  if (scan.blocked) {
    const first = scan.findings.find((f) => f.severity === 'block');
    return { ok: false, name, reason: `safety scan: ${first.rule} in ${first.file}`, scan };
  }
  return { ok: true, name, scan };
}

function rehash(names) {
  const provenance = loadProvenance();
  let missing = 0;
  for (const name of names) {
    const entry = provenance.skills.find((s) => s.name === name);
    if (!entry) {
      missing++;
      console.error(`NOT IMPORTED ${name}: no provenance entry`);
      continue;
    }
    entry.sha256 = treeHash(path.join(SKILLS_DIR, name));
    entry.locallyModified = entry.sha256 !== entry.sourceSha256;
    console.log(`REHASHED ${name}${entry.locallyModified ? ' (differs from source)' : ''}`);
  }
  fs.writeFileSync(PROVENANCE, `${JSON.stringify(provenance, null, 2)}\n`);
  process.exit(missing ? 1 : 0);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.rehash) {
    rehash(options.dirs.map((d) => path.basename(d)));
    return;
  }
  if (!options.repo || !options.commit || !options.dirs.length) {
    console.error('Usage: node scripts/import-skills.js --repo <owner/name> --commit <sha> [--license <file>] [--license-name <spdx>] <skill-dir>...');
    process.exit(2);
  }

  const allowlist = loadAllowlist(ALLOWLIST);
  const provenance = loadProvenance();
  const imported = [];
  let refused = 0;

  for (const dir of options.dirs) {
    const result = checkSkill(dir, options, allowlist);
    if (!result.ok) {
      refused++;
      console.error(`REFUSED ${result.name}: ${result.reason}`);
      continue;
    }

    const target = path.join(SKILLS_DIR, result.name);
    fs.cpSync(dir, target, { recursive: true, verbatimSymlinks: true });
    if (!findLicense(target)) {
      fs.copyFileSync(options.license, path.join(target, 'LICENSE.txt'));
    }

    const warnings = result.scan.findings.filter((f) => f.severity === 'warn').length;
    const hash = treeHash(target);
    provenance.skills = provenance.skills.filter((s) => s.name !== result.name);
    provenance.skills.push({
      name: result.name,
      repo: options.repo,
      commit: options.commit,
      path: repoRelativePath(dir),
      license: options.licenseName || 'see LICENSE.txt',
      sourceSha256: hash,
      sha256: hash,
      locallyModified: false,
      scan: { warnings, reviewedExceptions: result.scan.findings.filter((f) => f.severity === 'allowed').length },
    });
    imported.push(result.name);
    console.log(`IMPORTED ${result.name} from ${options.repo}${warnings ? ` (${warnings} scan warnings)` : ''}`);
  }

  provenance.skills.sort((a, b) => a.name.localeCompare(b.name));
  fs.writeFileSync(PROVENANCE, `${JSON.stringify(provenance, null, 2)}\n`);
  if (imported.length) {
    registerInModule(imported);
    ignoreForMarkdownlint(imported);
    addToPackageFiles(imported);
    console.log('Next: node scripts/skill-connector-build.js && npm run catalog:sync && npm test');
  }
  process.exit(refused ? 1 : 0);
}

if (require.main === module) {
  main();
}

module.exports = { checkSkill, treeHash };
