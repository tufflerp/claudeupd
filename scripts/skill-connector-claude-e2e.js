#!/usr/bin/env node
/**
 * End-to-end proof that a skill installed by the Skill Connector app is
 * recognised and used by a real Claude Code session.
 *
 * Usage:
 *   node scripts/skill-connector-claude-e2e.js [path/to/page.html]
 *
 * 1. Serves a test skill (with a random secret code) through a fake GitHub repo.
 * 2. Uses the app UI to scan it, add it, and install it into an in-memory
 *    skills folder (the same code path as a real install).
 * 3. Writes those exact bytes to <tmp>/project/.claude/skills.
 * 4. Runs `claude -p` in that project: Claude must list the skill and, when
 *    asked to run it, reply with the secret code only the skill contains.
 *
 * Needs Playwright and a signed-in `claude` CLI. Exits 2 when either is missing
 * or the CLI reports it is signed out.
 */

'use strict';

/* global window -- used inside page.evaluate callbacks, which run in the browser */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { pathToFileURL } = require('url');

const SKILL = 'csc-install-check';

function requireOrExit(name, hint) {
  try {
    return require(name);
  } catch {
    console.error(`[claude-e2e] ${hint}`);
    process.exit(2);
  }
}

function claude(cwd, prompt, extra) {
  const result = spawnSync('claude', ['-p', prompt, '--max-turns', '4', ...(extra || [])], {
    cwd,
    encoding: 'utf8',
    timeout: 240000,
  });
  if (result.error) throw result.error;
  return `${result.stdout || ''}${result.stderr || ''}`;
}

async function main() {
  const page = path.resolve(process.argv[2] || path.join(__dirname, '..', 'apps', 'skill-connector', 'index.html'));
  if (spawnSync('claude', ['--version'], { encoding: 'utf8' }).status !== 0) {
    console.error('[claude-e2e] The claude CLI is not installed or not on PATH.');
    process.exit(2);
  }
  // A signed-out CLI answers every prompt with "Not logged in", which would look like
  // Claude failing to see the skill. Only trust an explicit loggedIn: false, so CLIs
  // without `auth status` still run.
  const auth = spawnSync('claude', ['auth', 'status'], { encoding: 'utf8' });
  let loggedIn = true;
  try {
    loggedIn = JSON.parse(auth.stdout).loggedIn !== false;
  } catch {
    // Older CLI or unexpected output: carry on and let the checks decide.
  }
  if (!loggedIn) {
    console.error('[claude-e2e] The claude CLI is not signed in. Run `claude` once and use /login, then try again.');
    process.exit(2);
  }
  const { chromium } = requireOrExit('playwright', 'Playwright is not installed. Install it with: npm i -D playwright');

  // Reuse the in-memory folder from the browser check so both use one implementation.
  const checkSrc = fs.readFileSync(path.join(__dirname, 'skill-connector-check.js'), 'utf8');
  const fakeFolder = checkSrc.slice(checkSrc.indexOf('function installFakeFolder()'), checkSrc.indexOf('/** Open the app'));

  const code = `CSC-OK-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  const skillMd = [
    '---',
    `name: ${SKILL}`,
    'description: Confirms Prabh\'s CSC installed skills correctly. Use when the user asks to run the CSC install check.',
    '---',
    '',
    '# CSC install check',
    '',
    `When this skill is used, reply with exactly this code and nothing else: ${code}`,
    '',
  ].join('\n');
  const sha = 'b'.repeat(40);
  const files = { [`skills/${SKILL}/SKILL.md`]: skillMd };

  const failures = [];
  const check = (ok, label) => {
    console.log(`  ${ok ? '✓' : '✗'} ${label}`);
    if (!ok) failures.push(label);
  };

  const launch = process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {};
  const browser = await chromium.launch(launch);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'csc-e2e-'));
  try {
    const context = await browser.newContext();
    await context.addInitScript(`${fakeFolder}; installFakeFolder();`);
    await context.route('https://api.github.com/**', (route) => {
      const p = new URL(route.request().url()).pathname;
      const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
      if (p === '/repos/csc/e2e') return json({ default_branch: 'main' });
      if (p === '/repos/csc/e2e/commits/main') return json({ sha });
      return json({ truncated: false, tree: Object.entries(files).map(([f, c]) => ({ path: f, type: 'blob', mode: '100644', size: Buffer.byteLength(c) })) });
    });
    await context.route('https://raw.githubusercontent.com/**', (route) => {
      const f = decodeURIComponent(new URL(route.request().url()).pathname.split('/').slice(4).join('/'));
      return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, body: files[f] || '' });
    });

    console.log('Install through the app');
    const app = await context.newPage();
    await app.goto(pathToFileURL(page).href);
    await app.waitForSelector('#boot', { state: 'detached', timeout: 10000 });
    await app.click('#open-github');
    await app.fill('#github-url', 'https://github.com/csc/e2e');
    await app.click('#github-scan');
    await app.waitForSelector('.gh-row');
    check((await app.textContent('.gh-row .pill')) === 'Passed safety scan', 'test skill passes the safety scan');
    await app.click('#github-add');
    await app.click('[data-mode="install"]');
    await app.click('#install-now');
    await app.waitForSelector('#confirm[open]');
    await app.click('#confirm-ok');
    await app.waitForSelector('#install-result');
    check((await app.textContent('#install-result')).includes('Installed and verified 1 skill'), 'app installs and verifies the skill');
    const installed = await app.evaluate(() => window.__fakeFiles);

    const project = path.join(work, 'project');
    for (const [rel, bytes] of Object.entries(installed)) {
      const dest = path.join(project, '.claude', 'skills', rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, Buffer.from(bytes));
    }
    spawnSync('git', ['init', '-q'], { cwd: project });
    check(fs.readFileSync(path.join(project, '.claude', 'skills', SKILL, 'SKILL.md'), 'utf8') === skillMd, 'files on disk match what was scanned');

    console.log('Confirm with Claude Code');
    const listing = claude(project, 'Without using any tools, list the names of every skill available to you, one per line, and nothing else.');
    check(listing.split(/\s+/).includes(SKILL), `Claude lists ${SKILL} among its skills`);
    const answer = claude(project, 'Run the CSC install check.', ['--allowedTools', 'Skill']);
    check(answer.includes(code), `Claude used the skill and replied with its secret code (${code})`);
    if (!answer.includes(code)) console.log(`    Claude said: ${answer.trim().slice(0, 400)}`);
  } finally {
    await browser.close();
    fs.rmSync(work, { recursive: true, force: true });
  }

  console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nClaude recognised and used the installed skill');
  process.exit(failures.length ? 1 : 0);
}

main().catch((err) => {
  console.error(`[claude-e2e] ${err.message}`);
  process.exit(1);
});
