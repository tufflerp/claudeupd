#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { buildSkillIndex } = require('./lib/skill-index');

const root = path.join(__dirname, '..');
const skillsDir = path.join(root, 'skills');
const outFile = path.join(root, 'apps', 'skill-connector', 'skills-data.js');

const skills = buildSkillIndex(skillsDir);
const payload = `window.SKILLS = ${JSON.stringify(skills)};\n`;

fs.writeFileSync(outFile, payload, 'utf8');
console.log(`[skill-connector] Wrote ${skills.length} skills to ${path.relative(root, outFile)}`);
