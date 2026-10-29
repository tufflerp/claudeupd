'use strict';

const fs = require('fs');
const path = require('path');
const { parseFrontmatter, checkClaudeCompat } = require('./skill-scan-core');

/**
 * Read every `<skillsDir>/<name>/SKILL.md` and return a sorted list of skills.
 * Directories without a SKILL.md, or without a name, are skipped.
 *
 * @param {string} skillsDir - Directory containing one folder per skill
 * `dir` is the folder in this repo; `installDir` is the folder to install into
 * (the frontmatter name when it is a valid folder name, so it matches what
 * Claude shows); `name` is the frontmatter name; `original` marks skills
 * written from scratch for this app (config/original-skills.json).
 *
 * @returns {Array<{ name: string, dir: string, installDir: string, original: boolean, description: string, body: string }>}
 */
function loadOriginals(skillsDir) {
  const file = path.join(skillsDir, '..', 'config', 'original-skills.json');
  try {
    return new Set(JSON.parse(fs.readFileSync(file, 'utf8')).skills);
  } catch {
    return new Set();
  }
}

function buildSkillIndex(skillsDir) {
  const skills = [];
  const originals = loadOriginals(skillsDir);

  for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;

    const file = path.join(skillsDir, entry.name, 'SKILL.md');
    if (!fs.existsSync(file)) continue;

    const text = fs.readFileSync(file, 'utf8');
    const { attributes, body } = parseFrontmatter(text);
    const name = attributes.name || entry.name;
    skills.push({
      name,
      dir: entry.name,
      installDir: checkClaudeCompat(text, entry.name).installDir,
      original: originals.has(entry.name),
      description: attributes.description || '',
      body,
    });
  }

  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

module.exports = { parseFrontmatter, buildSkillIndex };
