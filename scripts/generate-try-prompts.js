#!/usr/bin/env node
/**
 * Generate one "try it" example prompt per skill with the Claude Code CLI.
 *
 * Usage:
 *   node scripts/generate-try-prompts.js [--all]
 *
 * Writes config/try-prompts.json ({ "<skill dir>": "<prompt>" }). Only skills
 * without a prompt are generated unless --all is given, so it is cheap to run
 * again after adding skills. Every prompt is safety-scanned and length-checked;
 * anything that fails is dropped (the app falls back to a generic prompt).
 * Requires a signed-in `claude` CLI.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { buildSkillIndex } = require('./lib/skill-index');
const { scanText } = require('./lib/skill-scan-core');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'config', 'try-prompts.json');
const BATCH = 30;

function ask(batch) {
  const list = batch.map((s) => `- ${s.dir}: ${s.description.replace(/\s+/g, ' ').slice(0, 400)}`).join('\n');
  const prompt = [
    'For each skill below, write ONE short example request a user could type to Claude that would make Claude use that skill.',
    'Rules: 8 to 25 words; concrete and realistic; plain English; no skill names; no secrets, URLs, or personal data;',
    'do not ask Claude to ignore instructions or hide anything.',
    'Answer with ONLY a JSON object mapping each skill id (exactly as given before the colon) to its request. No markdown fences.',
    '',
    list,
  ].join('\n');
  const result = spawnSync('claude', ['-p', prompt, '--max-turns', '1'], { encoding: 'utf8', timeout: 300000 });
  const text = `${result.stdout || ''}`.trim();
  const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  return JSON.parse(json);
}

function acceptable(prompt) {
  if (typeof prompt !== 'string') return false;
  const words = prompt.trim().split(/\s+/).length;
  if (words < 5 || words > 40 || prompt.length > 300) return false;
  return !scanText('prompt.txt', prompt).some((f) => f.severity === 'block');
}

function main() {
  const all = process.argv.includes('--all');
  const existing = !all && fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
  const skills = buildSkillIndex(path.join(ROOT, 'skills')).filter((s) => !existing[s.dir]);
  console.log(`[try-prompts] ${skills.length} skills need a prompt`);
  const prompts = { ...existing };

  for (let i = 0; i < skills.length; i += BATCH) {
    const batch = skills.slice(i, i + BATCH);
    let answer = {};
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        answer = ask(batch);
        break;
      } catch (err) {
        console.error(`[try-prompts] batch ${i / BATCH + 1} attempt ${attempt} failed: ${err.message}`);
      }
    }
    let kept = 0;
    for (const s of batch) {
      if (acceptable(answer[s.dir])) {
        prompts[s.dir] = answer[s.dir].trim();
        kept++;
      }
    }
    console.log(`[try-prompts] batch ${i / BATCH + 1}: kept ${kept}/${batch.length}`);
    const sorted = Object.fromEntries(Object.entries(prompts).sort(([a], [b]) => a.localeCompare(b)));
    fs.writeFileSync(OUT, `${JSON.stringify(sorted, null, 2)}\n`);
  }
  console.log(`[try-prompts] ${Object.keys(prompts).length} prompts in ${path.relative(ROOT, OUT)}`);
}

if (require.main === module) {
  main();
}

module.exports = { acceptable };
