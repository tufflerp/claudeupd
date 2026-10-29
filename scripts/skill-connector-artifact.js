#!/usr/bin/env node
/**
 * Prepare the Skill Connector app for hosting as a claude.ai Artifact (the
 * link that also opens on iPhone and iPad).
 *
 * Usage:
 *   node scripts/skill-connector-artifact.js [output-dir]
 *
 * Builds the app data, then writes <output-dir>/index.html: the app page
 * without its document wrapper (the Artifact host adds doctype, head and body),
 * and prints the list of supporting files to publish alongside it. The app
 * detects the hosted frame and saves zips through the `downloads` capability.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'apps', 'skill-connector');

function toArtifactPage(html) {
  return html
    .replace(/<!doctype html>\s*/i, '')
    .replace(/<html[^>]*>\s*/i, '')
    .replace(/<head>\s*/i, '')
    .replace(/<meta charset="utf-8">\s*/i, '')
    .replace(/<meta name="viewport"[^>]*>\s*/i, '')
    .replace(/<\/head>\s*/i, '')
    .replace(/<body>\s*/i, '')
    .replace(/<\/body>\s*/i, '')
    .replace(/<\/html>\s*/i, '');
}

function supportingFiles() {
  const files = ['app.js', 'boot.js'];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(path.join(APP, dir), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(rel);
      else files.push(rel);
    }
  };
  walk('data');
  return files;
}

function main() {
  const outDir = path.resolve(process.argv[2] || path.join(ROOT, 'dist', 'artifact'));
  execFileSync(process.execPath, [path.join(__dirname, 'skill-connector-build.js')], { stdio: 'inherit' });
  fs.mkdirSync(outDir, { recursive: true });
  const page = toArtifactPage(fs.readFileSync(path.join(APP, 'index.html'), 'utf8'));
  fs.writeFileSync(path.join(outDir, 'index.html'), page);
  const files = supportingFiles();
  fs.writeFileSync(path.join(outDir, 'files.json'), `${JSON.stringify(files, null, 2)}\n`);
  console.log(`[skill-connector] Artifact page: ${path.join(outDir, 'index.html')} (${files.length} supporting files listed in files.json)`);
}

if (require.main === module) {
  main();
}

module.exports = { toArtifactPage, supportingFiles };
