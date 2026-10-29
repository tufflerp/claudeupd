/**
 * Skill safety scan rules, shared by Node (scripts/lib/skill-scan.js) and the
 * Skill Connector browser app (copied to apps/skill-connector/data/scan-core.js
 * by scripts/skill-connector-build.js). No Node or DOM dependencies.
 *
 * Findings are `block` (detected as dangerous: must not be installed), `warn`
 * (allowed, reported), or `unverified` (could not be inspected, so safety is
 * unknown: the app warns and asks; the repository refuses to bundle it).
 *
 * Also holds the SKILL.md frontmatter parser and the "will Claude recognise
 * this skill?" check, so the app and CI agree on both.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SkillScanCore = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MAX_FILE_BYTES = 2 * 1024 * 1024;
  const MAX_SKILL_BYTES = 20 * 1024 * 1024;

  const SCRIPT_EXTENSIONS = new Set([
    '.sh', '.bash', '.zsh', '.ps1', '.psm1', '.bat', '.cmd', '.vbs',
    '.py', '.js', '.cjs', '.mjs', '.ts', '.rb', '.pl', '.php', '.go',
    '.swift', '.kt', '.java', '.rs', '.c', '.cc', '.cpp', '.h', '.cs', '.lua', '.r',
  ]);

  const TEXT_EXTENSIONS = new Set([
    ...SCRIPT_EXTENSIONS,
    '.md', '.mdx', '.txt', '.json', '.yaml', '.yml', '.toml', '.xml',
    '.html', '.htm', '.css', '.csv', '.svg', '.ini', '.cfg', '.tsx', '.jsx',
    '.jsonl', '.sql', '.lock', '.env.example', '.gitignore', '.xsd', '.tmpl',
  ]);

  // Binary assets that are expected in skills (fonts, images) and cannot execute.
  const SAFE_BINARY_EXTENSIONS = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp',
    '.ttf', '.otf', '.woff', '.woff2', '.pdf',
  ]);

  const EXECUTABLE_EXTENSIONS = new Set([
    '.exe', '.dll', '.so', '.dylib', '.scr', '.msi', '.com', '.jar',
    '.apk', '.app', '.deb', '.rpm', '.bin', '.elf', '.pyc', '.class',
  ]);

  const ARCHIVE_EXTENSIONS = new Set(['.zip', '.tar', '.gz', '.tgz', '.7z', '.rar', '.xz', '.bz2']);

  /**
   * Pattern rules. `scope` decides which files a rule applies to:
   *   all     - every text file (blocks everywhere)
   *   code    - blocks in scripts; warns in markdown/docs
   */
  const RULES = [
    {
      id: 'remote-pipe-to-shell',
      scope: 'code',
      message: 'Downloads a remote script and pipes it straight into a shell',
      pattern: /\b(?:curl|wget|iwr|Invoke-WebRequest)\b[^\n|]*\|\s*(?:sudo\s+)?(?:ba|z|da)?sh\b|\b(?:curl|wget)\b[^\n|]*\|\s*(?:python3?|node|perl|ruby)\b/i,
    },
    {
      id: 'powershell-download-exec',
      scope: 'code',
      message: 'PowerShell download-and-execute pattern',
      pattern: /\b(?:iex|Invoke-Expression)\b[^\n]*(?:DownloadString|Invoke-WebRequest|iwr|irm|Invoke-RestMethod)|DownloadString\([^)]*\)\s*\|\s*iex/i,
    },
    {
      id: 'encoded-exec',
      scope: 'code',
      message: 'Decodes an encoded payload and executes it',
      pattern: /(?:exec|eval)\s*\(\s*(?:base64\.b64decode|codecs\.decode|bytes\.fromhex|zlib\.decompress|marshal\.loads)|eval\s*\(\s*(?:atob|Buffer\.from)\s*\(|base64\s+(?:-d|--decode)[^\n]*\|\s*(?:ba)?sh\b|-EncodedCommand\b|powershell[^\n]*\s-enc\s/i,
    },
    {
      id: 'reverse-shell',
      scope: 'all',
      message: 'Reverse shell or raw network shell',
      pattern: /\/dev\/tcp\/\d|\bnc(?:at)?\s+(?:-\w+\s+)*-e\s+\/bin\/(?:ba)?sh|\bsocat\b[^\n]*exec:|bash\s+-i\s+>&\s*\/dev\/tcp/i,
    },
    {
      id: 'credential-access',
      scope: 'code',
      message: 'Reads credential stores (SSH keys, cloud credentials, browser or keychain data)',
      pattern: /(?:~|\$HOME|HOME\)|homedir\(\)|expanduser\([^)]*)[^\n]{0,20}\/?\.(?:ssh\/id_|aws\/credentials|config\/gcloud|docker\/config\.json|netrc|npmrc|pypirc|kube\/config)|cookies\.sqlite|security\s+find-generic-password|login\.keychain/i,
    },
    {
      id: 'browser-credential-access',
      scope: 'code',
      message: 'Reads browser password or cookie stores',
      // Case-sensitive on purpose: "local state" is common prose in UI docs.
      pattern: /(?:Chrome|Chromium|Edge|Brave|Firefox|Opera)[^\n]{0,80}(?:Login Data|Local State|Cookies|logins\.json|key4\.db)/,
    },
    {
      id: 'secret-exfiltration',
      scope: 'code',
      message: 'Sends environment variables or secrets to a remote host',
      pattern: /(?:curl|wget|requests\.post|fetch|axios\.post|http\.request)[^\n]{0,120}(?:process\.env|os\.environ|\$\(env\)|printenv|ANTHROPIC_API_KEY|AWS_SECRET|GITHUB_TOKEN)/i,
    },
    {
      id: 'exfil-webhook',
      scope: 'code',
      message: 'Posts data to a known exfiltration or paste endpoint',
      pattern: /\b(?:webhook\.site|requestbin|pipedream\.net|ngrok\.io|burpcollaborator|interact\.sh|oast\.(?:fun|me|pro)|pastebin\.com\/api|transfer\.sh|discord(?:app)?\.com\/api\/webhooks)\b/i,
    },
    {
      id: 'destructive-command',
      scope: 'code',
      message: 'Destructive filesystem or disk command',
      pattern: /\brm\s+-[a-z]*r[a-z]*f?[a-z]*\s+(?:--no-preserve-root\s+)?(?:\/|~|\$HOME)(?:\s|\*|$)|\bmkfs\.|\bdd\s+if=[^\n]*of=\/dev\/(?:sd|nvme|disk)|:\(\)\s*\{\s*:\|:&\s*\};:|\bformat\s+[a-z]:\s*\/q|Remove-Item\s+[^\n]*-Recurse[^\n]*(?:C:\\|\$env:USERPROFILE)\s/i,
    },
    {
      id: 'persistence',
      scope: 'code',
      message: 'Installs persistence (cron, startup, launch agents, shell profiles, registry Run keys)',
      pattern: /crontab\s+-[^l\s]|>>?\s*~?\/?(?:\$HOME\/)?\.(?:bashrc|zshrc|bash_profile|profile)\b|LaunchAgents\/|CurrentVersion\\Run\b|schtasks\s+\/create|systemctl\s+enable/i,
    },
    {
      id: 'security-tampering',
      scope: 'code',
      message: 'Disables security tools or hides activity',
      pattern: /Set-MpPreference\s+[^\n]*-Disable|Add-MpPreference\s+-ExclusionPath|setenforce\s+0|spctl\s+--master-disable|history\s+-c\b|unset\s+HISTFILE|chmod\s+(?:-R\s+)?777\s+\//i,
    },
    {
      id: 'crypto-miner',
      scope: 'all',
      message: 'Crypto-mining software or pool reference',
      pattern: /\b(?:xmrig|minerd|cpuminer|stratum\+tcp|nicehash|coinhive|cryptonight)\b/i,
    },
    {
      id: 'prompt-injection',
      scope: 'all',
      message: 'Prompt-injection phrasing aimed at overriding the model or hiding actions from the user',
      pattern: /\b(?:ignore|disregard|forget)\s+(?:all\s+)?(?:previous|prior|above|earlier)\s+(?:instructions|prompts|rules)\b|\bdo\s+not\s+(?:tell|inform|show|mention\s+(?:this|it)\s+to)\s+the\s+user\b|\bwithout\s+(?:telling|informing|notifying)\s+the\s+user\b|\byou\s+are\s+now\s+(?:in\s+)?(?:developer|DAN|jailbreak)\s+mode\b/i,
    },
  ];

  // Zero-width, bidi-override and tag characters used to hide instructions.
  const HIDDEN_UNICODE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]|[\u{E0000}-\u{E007F}]/u;

  // A long unbroken base64-looking run usually means an embedded payload.
  const LONG_BASE64 = /[A-Za-z0-9+/]{400,}={0,2}/;

  function extname(relPath) {
    const base = relPath.split(/[\\/]/).pop() || '';
    const dot = base.lastIndexOf('.');
    return dot > 0 ? base.slice(dot).toLowerCase() : '';
  }

  function lineOf(text, index) {
    let line = 1;
    for (let i = 0; i < index && i < text.length; i++) {
      if (text.charCodeAt(i) === 10) line++;
    }
    return line;
  }

  function isMarkdownLike(ext) {
    return ext === '.md' || ext === '.mdx' || ext === '.txt';
  }

  /**
   * True when the bytes start with a native executable header.
   * @param {Uint8Array} bytes
   */
  function hasBinaryMagic(bytes) {
    if (!bytes || bytes.length < 4) return false;
    // Windows PE (MZ), ELF, Mach-O (32/64, both endians), Java class
    if (bytes[0] === 0x4d && bytes[1] === 0x5a) return true;
    if (bytes[0] === 0x7f && bytes[1] === 0x45 && bytes[2] === 0x4c && bytes[3] === 0x46) return true;
    const magic = ((bytes[0] << 24) >>> 0) + (bytes[1] << 16) + (bytes[2] << 8) + bytes[3];
    return [0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe].includes(magic);
  }

  /**
   * True when bytes look like UTF-8 text (no NUL bytes, decodes cleanly).
   * @param {Uint8Array} bytes
   */
  function looksLikeText(bytes) {
    const head = bytes.subarray(0, 8192);
    for (let i = 0; i < head.length; i++) if (head[i] === 0) return false;
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Decide, from the name and size alone, whether a file is worth downloading
   * to inspect. Used by the browser before fetching from GitHub.
   *
   * @param {string} relPath
   * @param {number} size - Size in bytes
   * @returns {{ action: 'inspect'|'finding', finding?: object }}
   */
  function classifyFile(relPath, size) {
    if (size > MAX_FILE_BYTES) {
      return {
        action: 'finding',
        finding: { severity: 'unverified', rule: 'oversized-file', file: relPath, line: 0, message: `Too large to check (over ${MAX_FILE_BYTES / 1024 / 1024} MB)` },
      };
    }
    return { action: 'inspect' };
  }

  /**
   * Inspect one file's bytes and return its findings.
   *
   * @param {string} relPath - Path shown in findings
   * @param {Uint8Array} bytes - File contents
   * @returns {Array<{ severity: string, rule: string, file: string, line: number, message: string }>}
   */
  function inspectFile(relPath, bytes) {
    const ext = extname(relPath);
    const one = (severity, rule, message) => [{ severity, rule, file: relPath, line: 0, message }];

    if (hasBinaryMagic(bytes)) {
      // A program is only expected where the name says so; anything else is disguised.
      return EXECUTABLE_EXTENSIONS.has(ext)
        ? one('unverified', 'executable-binary', `Contains a program file (${ext}) that can't be checked`)
        : one('block', 'disguised-executable', 'A program disguised as a different kind of file');
    }
    if (EXECUTABLE_EXTENSIONS.has(ext)) return one('unverified', 'executable-binary', `Contains a program file (${ext}) that can't be checked`);
    if (ARCHIVE_EXTENSIONS.has(ext)) return one('unverified', 'archive', `Contains an archive (${ext}) that can't be opened to check`);
    if (bytes.length > MAX_FILE_BYTES) return one('unverified', 'oversized-file', `Too large to check (over ${MAX_FILE_BYTES / 1024 / 1024} MB)`);
    if (SAFE_BINARY_EXTENSIONS.has(ext)) return [];
    if (TEXT_EXTENSIONS.has(ext) || ext === '' || looksLikeText(bytes)) {
      return scanText(relPath, new TextDecoder('utf-8').decode(bytes));
    }
    return one('unverified', 'binary-file', "Binary file that can't be inspected");
  }

  /**
   * Scan one file's text content.
   *
   * @param {string} relPath - Path shown in findings
   * @param {string} text - File contents
   * @returns {Array<{ severity: string, rule: string, file: string, line: number, message: string }>}
   */
  function scanText(relPath, text) {
    const ext = extname(relPath);
    const docs = isMarkdownLike(ext);
    const findings = [];

    for (const rule of RULES) {
      const match = rule.pattern.exec(text);
      if (!match) continue;
      findings.push({
        severity: rule.scope === 'code' && docs ? 'warn' : 'block',
        rule: rule.id,
        file: relPath,
        line: lineOf(text, match.index),
        message: rule.message,
      });
    }

    const hidden = HIDDEN_UNICODE.exec(text);
    // A single leading BOM is harmless encoding noise.
    if (hidden && !(hidden.index === 0 && text.charCodeAt(0) === 0xfeff && !HIDDEN_UNICODE.test(text.slice(1)))) {
      findings.push({
        severity: 'block',
        rule: 'hidden-unicode',
        file: relPath,
        line: lineOf(text, hidden.index),
        message: 'Invisible or bidirectional-override Unicode that can hide instructions',
      });
    }

    const blob = LONG_BASE64.exec(text);
    if (blob && ext !== '.svg' && ext !== '.json' && ext !== '.csv') {
      findings.push({
        severity: docs ? 'warn' : 'block',
        rule: 'embedded-payload',
        file: relPath,
        line: lineOf(text, blob.index),
        message: 'Long encoded blob that may hide a payload',
      });
    }

    return findings;
  }

  /**
   * Parse SKILL.md frontmatter: top-level `key: value` pairs, including literal
   * (`|`) and folded (`>`) block scalars.
   *
   * @param {string} text
   * @returns {{ present: boolean, attributes: Record<string, string>, body: string }}
   */
  function parseFrontmatter(text) {
    const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
    const match = normalized.match(/^---\n([\s\S]*?)\n---\n?/);
    if (!match) return { present: false, attributes: {}, body: normalized.trim() };

    const attributes = {};
    const lines = match[1].split('\n');
    for (let i = 0; i < lines.length; i++) {
      const pair = lines[i].match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
      if (!pair) continue;
      const value = pair[2].trim();
      if (/^[|>][+-]?\d*$/.test(value)) {
        const block = [];
        while (i + 1 < lines.length && (lines[i + 1].trim() === '' || /^\s/.test(lines[i + 1]))) block.push(lines[++i].trim());
        attributes[pair[1]] = value[0] === '>' ? block.filter(Boolean).join(' ') : block.join('\n').trim();
        continue;
      }
      // Plain or quoted values may continue on indented lines (YAML folds them with spaces).
      let joined = value;
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) joined += ` ${lines[++i].trim()}`;
      attributes[pair[1]] = joined.replace(/^(['"])([\s\S]*)\1$/, '$2');
    }
    return { present: true, attributes, body: normalized.slice(match[0].length).trim() };
  }

  // Folder names the app installs into: safe on every OS and valid for the Claude app.
  const INSTALL_DIR_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
  // Characters Claude Code refuses in skill names (docs: code.claude.com/docs/en/skills).
  // eslint-disable-next-line no-control-regex -- control characters are exactly what this rejects
  const REFUSED_NAME_RE = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF\uE000-\uF8FF<>]|\s{2}|^\s|\s$/;
  const DESCRIPTION_LISTING_LIMIT = 1536;
  const APP_NAME_LIMIT = 64;
  const APP_DESCRIPTION_LIMIT = 200;

  /**
   * Will Claude recognise this skill once installed?
   *
   * `code` is Claude Code (~/.claude/skills); `app` is uploading a zip to the
   * Claude desktop/web app. Each is 'ready', 'warn' (works, with caveats) or
   * 'error' (will not load or will be rejected).
   *
   * @param {string|null} skillMd - SKILL.md text, or null when missing
   * @param {string} folder - The folder the skill came from
   */
  function checkClaudeCompat(skillMd, folder) {
    const issues = [];
    const issue = (target, level, message) => issues.push({ target, level, message });

    if (skillMd === null || skillMd === undefined) {
      issue('code', 'error', 'No SKILL.md file, so Claude will not find this skill');
      issue('app', 'error', 'No SKILL.md file');
      return { name: folder, installDir: folder, description: '', code: 'error', app: 'error', issues };
    }

    const parsed = parseFrontmatter(skillMd);
    const name = parsed.attributes.name || '';
    const description = parsed.attributes.description || '';
    const installDir = INSTALL_DIR_RE.test(name) ? name : folder;

    if (/^\uFEFF/.test(skillMd)) issue('code', 'info', 'Invisible byte-order mark before the frontmatter; removed when installing');
    if (!parsed.present) {
      issue('code', 'warn', 'No frontmatter: Claude Code will use the folder name and the first line as the description');
      issue('app', 'error', 'No frontmatter with a name and description');
    }
    if (name && REFUSED_NAME_RE.test(name)) issue('code', 'error', 'The name contains characters Claude Code refuses');
    if (name && !INSTALL_DIR_RE.test(name)) issue('app', 'error', 'The name must be lowercase letters, numbers and hyphens (max 64)');
    if (name.length > APP_NAME_LIMIT) issue('app', 'error', `The name is longer than ${APP_NAME_LIMIT} characters`);
    if (!INSTALL_DIR_RE.test(installDir)) issue('code', 'error', 'No usable folder name for this skill');
    if (/^synced$/i.test(installDir) || /^anthropic-skills(:|$)/.test(name)) issue('code', 'error', 'Uses a name Claude reserves');
    if (!description) {
      issue('code', 'warn', 'No description, so Claude has less to go on when deciding to use it');
      issue('app', 'error', 'No description');
    } else {
      if (description.length > DESCRIPTION_LISTING_LIMIT) issue('code', 'info', `Description is cut to ${DESCRIPTION_LISTING_LIMIT} characters in Claude Code's skill list`);
      if (description.length > APP_DESCRIPTION_LIMIT) issue('app', 'warn', `Description is ${description.length} characters; the Claude app may reject descriptions over ${APP_DESCRIPTION_LIMIT}`);
    }

    const level = (target) => {
      const mine = issues.filter((i) => i.target === target);
      if (mine.some((i) => i.level === 'error')) return 'error';
      if (mine.some((i) => i.level === 'warn')) return 'warn';
      return 'ready';
    };
    return { name: name || installDir, installDir, description, code: level('code'), app: level('app'), issues };
  }

  return {
    MAX_FILE_BYTES,
    MAX_SKILL_BYTES,
    RULES,
    checkClaudeCompat,
    classifyFile,
    hasBinaryMagic,
    inspectFile,
    looksLikeText,
    parseFrontmatter,
    scanText,
  };
});
