#!/usr/bin/env node
/**
 * Build the Windows installer (Prabhs-CSC-Setup.exe) for the Skill Connector app.
 *
 * Usage:
 *   node scripts/skill-connector-installer.js [output-dir]
 *
 * Builds the app data (which runs the safety scan), stages the app with its
 * icon, and runs NSIS (makensis) on apps/skill-connector/installer/prabhs-csc.nsi.
 * Needs makensis (Linux: apt install nsis; Windows: nsis.sourceforge.io).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { appFiles } = require('./skill-connector-package');

const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'apps', 'skill-connector');
const NSI = path.join(APP, 'installer', 'prabhs-csc.nsi');
const VERSION = '1.0.0';

function main() {
  const outDir = path.resolve(process.argv[2] || path.join(ROOT, 'dist'));
  if (spawnSync('makensis', ['-VERSION'], { encoding: 'utf8' }).status !== 0) {
    console.error('[skill-connector] makensis not found. Install NSIS (Linux: apt install nsis).');
    process.exit(2);
  }
  execFileSync(process.execPath, [path.join(__dirname, 'skill-connector-build.js')], { stdio: 'inherit' });

  const stage = path.join(ROOT, 'dist', 'installer-stage');
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true });
  const copy = (rel, to) => {
    const dest = path.join(stage, to || rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(APP, rel), dest);
  };
  copy('index.html');
  for (const rel of appFiles()) copy(rel);
  copy(path.join('installer', 'app.ico'), 'app.ico');

  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'Prabhs-CSC-Setup.exe');
  execFileSync('makensis', ['-V2', `-DSTAGE=${stage}`, `-DOUTFILE=${outFile}`, `-DVERSION=${VERSION}`, NSI], { stdio: 'inherit' });
  const mb = (fs.statSync(outFile).size / 1024 / 1024).toFixed(1);
  console.log(`[skill-connector] Installer: ${outFile} (${mb} MB)`);
}

if (require.main === module) {
  main();
}
