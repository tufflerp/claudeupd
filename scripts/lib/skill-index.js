'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Parse the YAML frontmatter of a SKILL.md file.
 * Supports top-level `key: value` pairs, including literal (`|`) and folded (`>`)
 * block scalars, which is what skills use for name/description.
 *
 * @param {string} text - Full file contents
 * @returns {{ attributes: Record<string, string>, body: string }}
 */
function parseFrontmatter(text) {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) {
    return { attributes: {}, body: normalized.trim() };
  }

  const attributes = {};
  const lines = match[1].split('\n');
  for (let i = 0; i < lines.length; i++) {
    const pair = lines[i].match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!pair) continue;

    const value = pair[2].trim();
    if (/^[|>][+-]?\d*$/.test(value)) {
      const block = [];
      while (i + 1 < lines.length && (lines[i + 1].trim() === '' || /^\s/.test(lines[i + 1]))) {
        block.push(lines[++i].trim());
      }
      attributes[pair[1]] = value[0] === '>'
        ? block.filter(Boolean).join(' ')
        : block.join('\n').trim();
      continue;
    }
    attributes[pair[1]] = value.replace(/^(['"])(.*)\1$/, '$2');
  }

  return { attributes, body: normalized.slice(match[0].length).trim() };
}

/**
 * Read every `<skillsDir>/<name>/SKILL.md` and return a sorted list of skills.
 * Directories without a SKILL.md, or without a name, are skipped.
 *
 * @param {string} skillsDir - Directory containing one folder per skill
 * `dir` is the folder name, which is what gets installed; `name` is the
 * frontmatter name Claude shows (usually, but not always, the same).
 *
 * @returns {Array<{ name: string, dir: string, description: string, body: string }>}
 */
function buildSkillIndex(skillsDir) {
  const skills = [];

  for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;

    const file = path.join(skillsDir, entry.name, 'SKILL.md');
    if (!fs.existsSync(file)) continue;

    const { attributes, body } = parseFrontmatter(fs.readFileSync(file, 'utf8'));
    const name = attributes.name || entry.name;
    skills.push({
      name,
      dir: entry.name,
      description: attributes.description || '',
      body,
    });
  }

  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

module.exports = { parseFrontmatter, buildSkillIndex };
