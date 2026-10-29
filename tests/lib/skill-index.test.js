'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseFrontmatter, buildSkillIndex } = require('../../scripts/lib/skill-index');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}\n    ${err.message}`);
  }
}

console.log('\nskill-index.js');

test('parses name and description from frontmatter', () => {
  const { attributes, body } = parseFrontmatter('---\nname: demo\ndescription: "Does things"\n---\n\n# Demo\n');
  assert.strictEqual(attributes.name, 'demo');
  assert.strictEqual(attributes.description, 'Does things');
  assert.strictEqual(body, '# Demo');
});

test('returns full text as body when there is no frontmatter', () => {
  const { attributes, body } = parseFrontmatter('# Plain\n');
  assert.deepStrictEqual(attributes, {});
  assert.strictEqual(body, '# Plain');
});

test('handles CRLF line endings', () => {
  const { attributes } = parseFrontmatter('---\r\nname: crlf\r\n---\r\nbody');
  assert.strictEqual(attributes.name, 'crlf');
});

test('buildSkillIndex reads skill folders, skips non-skills, and sorts by name', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-index-'));
  try {
    fs.mkdirSync(path.join(dir, 'zeta'));
    fs.writeFileSync(path.join(dir, 'zeta', 'SKILL.md'), '---\nname: zeta\ndescription: last\n---\nZ');
    fs.mkdirSync(path.join(dir, 'alpha'));
    fs.writeFileSync(path.join(dir, 'alpha', 'SKILL.md'), '---\ndescription: first\n---\nA');
    fs.mkdirSync(path.join(dir, 'empty'));
    fs.writeFileSync(path.join(dir, 'loose.md'), 'not a skill');

    const skills = buildSkillIndex(dir);
    assert.deepStrictEqual(skills.map((s) => s.name), ['alpha', 'zeta']);
    assert.strictEqual(skills[0].description, 'first');
    assert.strictEqual(skills[1].body, 'Z');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
