'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Parse the YAML frontmatter of a SKILL.md file.
 * Only flat `key: value` pairs are supported, which is all skills use for name/description.
 *
 * @param {string} text - Full file contents
 * @returns {{ attributes: Record<string, string>, body: string }}
 */
function parseFrontmatter(text) {
  const normalized = text.replace(/\r\n/g, '\n');
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) {
    return { attributes: {}, body: normalized.trim() };
  }

  const attributes = {};
  for (const line of match[1].split('\n')) {
    const pair = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!pair) continue;
    attributes[pair[1]] = pair[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  }

  return { attributes, body: normalized.slice(match[0].length).trim() };
}

/**
 * Read every `<skillsDir>/<name>/SKILL.md` and return a sorted list of skills.
 * Directories without a SKILL.md, or without a name, are skipped.
 *
 * @param {string} skillsDir - Directory containing one folder per skill
 * @returns {Array<{ name: string, description: string, body: string }>}
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
      description: attributes.description || '',
      body,
    });
  }

  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

module.exports = { parseFrontmatter, buildSkillIndex };
