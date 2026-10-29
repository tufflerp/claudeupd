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
 *     app.js, boot.js, data/ app code, loading screen, skills and per-skill files
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

// Windows batch files need CRLF line endings. Edge is looked up on disk first so a
// missing Edge never pops a "cannot find msedge" error; goto avoids parenthesised
// blocks, which break on paths like "Program Files (x86)".
const LAUNCHER = [
  '@echo off',
  'setlocal',
  `set "APP=%~dp0${PAGE}"`,
  'if exist "%APP%" goto findedge',
  `echo Could not find "${PAGE}" next to this file.`,
  'echo Right-click Prabhs-CSC.zip, choose Extract All, open the extracted folder,',
  'echo and double-click this file again.',
  'pause',
  'exit /b 1',
  ':findedge',
  'set "EDGE="',
  'if exist "%ProgramFiles(x86)%\\Microsoft\\Edge\\Application\\msedge.exe" set "EDGE=%ProgramFiles(x86)%\\Microsoft\\Edge\\Application\\msedge.exe"',
  'if exist "%ProgramFiles%\\Microsoft\\Edge\\Application\\msedge.exe" set "EDGE=%ProgramFiles%\\Microsoft\\Edge\\Application\\msedge.exe"',
  'if exist "%LocalAppData%\\Microsoft\\Edge\\Application\\msedge.exe" set "EDGE=%LocalAppData%\\Microsoft\\Edge\\Application\\msedge.exe"',
  'if defined EDGE goto edge',
  'start "" "%APP%"',
  'exit /b 0',
  ':edge',
  'start "" "%EDGE%" "%APP%"',
  '',
].join('\r\n');

const README = [
  "Prabh's CSC (Claude Skill Connector)",
  '====================================',
  '',
  'Open it',
  '  1. Right-click Prabhs-CSC.zip and choose "Extract All", then open the',
  '     extracted folder. (Opening files straight from inside the zip does not work.)',
  `  2. Double-click "Open Prabh's CSC.bat". It opens the app in Microsoft Edge.`,
  '     If Windows says "Windows protected your PC", click "More info", then',
  '     "Run anyway". If it asks "Do you want to run this file?", click "Run".',
  `  You can also double-click "${PAGE}" to open it in your default browser,`,
  '  but one-click install needs Edge or Chrome.',
  '',
  'Connect to Claude Code (once)',
  '  Click "Connect" at the bottom of the sidebar (or in the Installed view) and',
  '  choose your skills folder:',
  '    C:\\Users\\<your name>\\.claude\\skills',
  '  Create the "skills" folder if it is not there. The app remembers it and',
  '  shows what is installed under "Installed". If the sidebar later says',
  '  "allow access again", click "Reconnect" and allow access.',
  '',
  'Install skills into Claude Code',
  '  1. Tick the skills you want (search, or use chips like "roblox" or "original").',
  '  2. Click "Install ... in Claude Code".',
  '  3. The app writes each skill, reads its SKILL.md back, and checks that',
  '     Claude Code can load it.',
  '  4. Claude Code picks new skills up automatically. If these are your very',
  '     first skills, run /reload-skills once in any open session. Type /skills',
  '     in Claude Code to see them.',
  '  Installed skills show "Installed in Claude", or "Update available" when the',
  '  library has a newer version. To remove one, click its "Preview" button,',
  '  then "Remove from Claude".',
  '',
  'Using the Claude desktop or web app instead?',
  '  1. Select skills and click "Claude app (.zip)" (one zip per skill).',
  '  2. In Claude, turn on code execution in Settings > Capabilities.',
  '  3. Go to Customize > Skills, click +, "Upload a skill", and pick a zip.',
  '  Descriptions over 200 characters are shortened automatically to fit, and',
  '  extra fields are moved under "metadata" as the Claude app expects.',
  '',
  'Using Firefox or Safari? Click "Claude Code (.zip)" and unzip it into the',
  '  .claude\\skills folder.',
  '',
  'Add skills from GitHub',
  '  1. Click "Add from GitHub", paste a repository or folder link, click Scan.',
  '  2. Tick the skills you want and click "Add ... to library".',
  '  3. They appear under "From GitHub", already selected. Click Install.',
  '  Every skill is safety-scanned first:',
  '    Passed safety scan     - no problems found',
  '    Passed with notes      - fine, with minor notes you can read in Preview',
  "    Couldn't be checked    - some files could not be inspected, so the scan",
  '                             cannot say they are safe. You are warned and asked',
  '                             to confirm; install only if you trust the source.',
  '    Blocked: unsafe        - dangerous content was found; cannot be installed',
  "    Claude can't load this - not a valid skill; cannot be installed",
  '  Public repositories only. GitHub allows about 60 lookups an hour without',
  '  signing in, so wait a while if you see a limit message.',
  '',
  'Safety',
  '  Every bundled skill passed the safety scan before this package was built,',
  '  with nothing left unchecked. The scan looks for downloading and running',
  '  remote scripts, reading passwords or keys, hidden text aimed at Claude,',
  '  and disguised programs. No scanner is perfect: only install skills from',
  '  sources you trust.',
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

/**
 * Every local file the page references (scripts, icons, images), plus the
 * per-skill bundles app.js loads on demand. Throws if a reference is missing,
 * so a new file can never be left out of the package.
 */
function appFiles() {
  const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
  const refs = new Set();
  for (const m of html.matchAll(/\b(?:src|href)="([^"#?]+)"/g)) {
    if (!/^(?:[a-z]+:|\/\/)/i.test(m[1])) refs.add(m[1]);
  }
  for (const ref of refs) {
    if (!fs.existsSync(path.join(APP, ref))) throw new Error(`index.html references ${ref}, which does not exist`);
  }
  return [...refs].concat(listFiles(path.join(APP, 'data', 'skill-files'), APP, [])).sort();
}

function main() {
  const outDir = path.resolve(process.argv[2] || path.join(ROOT, 'dist'));
  execFileSync(process.execPath, [path.join(__dirname, 'skill-connector-build.js')], { stdio: 'inherit' });

  // Files sit at the top of the zip, so Windows "Extract All" makes one Prabhs-CSC folder.
  const entries = [
    { path: "Open Prabh's CSC.bat", data: Buffer.from(LAUNCHER) },
    { path: 'README.txt', data: Buffer.from(README) },
    { path: PAGE, data: fs.readFileSync(path.join(APP, 'index.html')) },
  ];
  for (const rel of appFiles()) {
    entries.push({ path: rel, data: fs.readFileSync(path.join(APP, rel)) });
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

module.exports = { appFiles, LAUNCHER };
