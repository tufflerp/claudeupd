#!/usr/bin/env node
/**
 * Package the Skill Connector app as a ready-to-use zip for Windows users.
 *
 * Usage:
 *   node scripts/skill-connector-package.js [output-dir]
 *
 * Builds the app data (which also runs the safety scan), then writes
 * <output-dir>/Prabhs-CSC.zip containing:
 *
 *   Prabhs-CSC/
 *     Open Prabh's CSC.bat   double-click: opens the app in Microsoft Edge
 *     Prabh's CSC.html       the app (works in any browser)
 *     app.js, data/          app code, skills and per-skill files
 *     README.txt
 */

'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');
const { createZip } = require('./lib/zip-store');

const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'apps', 'skill-connector');
const FOLDER = 'Prabhs-CSC';
const PAGE = "Prabh's CSC.html";

// Windows batch files need CRLF line endings.
const LAUNCHER = [
  '@echo off',
  'rem Opens Prabh\'s CSC in Microsoft Edge, which supports one-click install into Claude.',
  `start "" msedge "%~dp0${PAGE}"`,
  `if errorlevel 1 start "" "%~dp0${PAGE}"`,
  '',
].join('\r\n');

const README = [
  "Prabh's CSC (Claude Skill Connector)",
  '====================================',
  '',
  'Open it',
  "  Double-click \"Open Prabh's CSC.bat\". It opens the app in Microsoft Edge.",
  `  (You can also double-click "${PAGE}" to open it in your default browser.)`,
  '',
  'Install skills into Claude Code',
  '  1. Tick the skills you want (search, or use the chips like "roblox" or "game").',
  '  2. Click "Install ... to Claude Code".',
  '  3. The first time, choose your skills folder:',
  '       C:\\Users\\<your name>\\.claude\\skills',
  '     (create the "skills" folder if it is not there). The app remembers it.',
  '  4. Start a new Claude Code session.',
  '',
  '  Using Firefox or Safari? Click "Download as .zip" instead and unzip it',
  '  into the same .claude\\skills folder.',
  '',
  'Add skills from GitHub',
  '  Click "Add from GitHub", paste a repository or folder link, and click Scan.',
  '  Every skill is safety-scanned first:',
  '    Passed safety scan     - no problems found',
  '    Passed with notes      - fine, with minor notes you can read in Preview',
  "    Couldn't fully check   - parts could not be inspected; install only if you",
  '                             trust the source (you will be asked to confirm)',
  '    Blocked                - looks dangerous; cannot be installed',
  '  Public repositories only. GitHub allows about 60 lookups an hour without',
  '  signing in, so wait a while if you see a limit message.',
  '',
  'Safety',
  '  Every bundled skill passed the safety scan before this package was built.',
  '  The scan looks for things like downloading and running remote scripts,',
  '  reading passwords or keys, hidden text aimed at Claude, and executables.',
  '  No scanner is perfect: only install skills from sources you trust.',
  '',
].join('\r\n');

function listFiles(dir, base, acc) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listFiles(full, base, acc);
    else if (entry.isFile()) acc.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return acc;
}

function main() {
  const outDir = path.resolve(process.argv[2] || path.join(ROOT, 'dist'));
  execFileSync(process.execPath, [path.join(__dirname, 'skill-connector-build.js')], { stdio: 'inherit' });

  const entries = [
    { path: `${FOLDER}/Open Prabh's CSC.bat`, data: Buffer.from(LAUNCHER) },
    { path: `${FOLDER}/README.txt`, data: Buffer.from(README) },
    { path: `${FOLDER}/${PAGE}`, data: fs.readFileSync(path.join(APP, 'index.html')) },
    { path: `${FOLDER}/app.js`, data: fs.readFileSync(path.join(APP, 'app.js')) },
  ];
  for (const rel of listFiles(path.join(APP, 'data'), APP, [])) {
    entries.push({ path: `${FOLDER}/${rel}`, data: fs.readFileSync(path.join(APP, rel)) });
  }

  fs.mkdirSync(outDir, { recursive: true });
  const zipPath = path.join(outDir, `${FOLDER}.zip`);
  fs.writeFileSync(zipPath, createZip(entries, { deflateRaw: (data) => zlib.deflateRawSync(data, { level: 9 }) }));
  const mb = (fs.statSync(zipPath).size / 1024 / 1024).toFixed(1);
  console.log(`[skill-connector] Packaged ${entries.length} files into ${zipPath} (${mb} MB)`);
}

if (require.main === module) {
  main();
}
