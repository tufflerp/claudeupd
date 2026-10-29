const fs = require('fs');
const path = require('path');
const js = require('@eslint/js');
const globals = require('globals');

// Third-party skills (see config/imported-skills.json) keep their upstream code
// style; they are safety-scanned by scripts/ci/scan-skills.js instead of linted.
const importedSkillIgnores = (() => {
    try {
        const file = path.join(__dirname, 'config', 'imported-skills.json');
        return JSON.parse(fs.readFileSync(file, 'utf8')).skills.map(s => `skills/${s.name}/**`);
    } catch {
        return [];
    }
})();

module.exports = [
    {
        ignores: ['.opencode/dist/**', '.cursor/**', 'node_modules/**', '.venv/**', 'venv/**', 'coverage/**', 'workflows/**/*.workflow.*', '.claude/workflows/**', 'apps/skill-connector/data/**', ...importedSkillIgnores]
    },
    js.configs.recommended,
    {
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'commonjs',
            globals: {
                ...globals.node,
                ...globals.es2022
            }
        },
        rules: {
            'no-unused-vars': ['error', {
                argsIgnorePattern: '^_',
                varsIgnorePattern: '^_',
                caughtErrorsIgnorePattern: '^_'
            }],
            'no-undef': 'error',
            'eqeqeq': 'warn'
        }
    },
    {
        files: ['apps/skill-connector/**/*.js'],
        languageOptions: {
            sourceType: 'script',
            globals: {
                ...globals.browser
            }
        }
    },
    {
        files: ['**/*.mjs'],
        languageOptions: {
            sourceType: 'module'
        }
    }
];
