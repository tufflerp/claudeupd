/**
 * Skill safety scan rules, shared by Node (scripts/lib/skill-scan.js) and the
 * Skill Connector browser app (copied to apps/skill-connector/data/scan-core.js
 * by scripts/skill-connector-build.js). No Node or DOM dependencies.
 *
 * Findings are `block` (must not be installed), `warn` (allowed, reported), or
 * `unverified` (the content could not be inspected, so safety is unknown).
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
   * Decide how to treat a file before reading its text.
   *
   * @param {string} relPath
   * @param {number} size - Size in bytes
   * @returns {{ action: 'text'|'skip'|'finding', finding?: object }}
   */
  function classifyFile(relPath, size) {
    const ext = extname(relPath);
    const finding = (severity, rule, message) => ({
      action: 'finding',
      finding: { severity, rule, file: relPath, line: 0, message },
    });
    if (EXECUTABLE_EXTENSIONS.has(ext)) return finding('block', 'executable-binary', `Compiled executable or package (${ext})`);
    if (ARCHIVE_EXTENSIONS.has(ext)) return finding('block', 'archive', 'Bundled archive cannot be inspected');
    if (size > MAX_FILE_BYTES) return finding('block', 'oversized-file', `File is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB`);
    if (SAFE_BINARY_EXTENSIONS.has(ext)) return { action: 'skip' };
    if (!TEXT_EXTENSIONS.has(ext) && ext !== '') return finding('warn', 'unknown-file-type', `Unrecognised file type (${ext})`);
    return { action: 'text' };
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

  return {
    MAX_FILE_BYTES,
    MAX_SKILL_BYTES,
    RULES,
    classifyFile,
    hasBinaryMagic,
    scanText,
  };
});
