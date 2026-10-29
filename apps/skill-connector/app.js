/* Prabh's CSC (Claude Skill Connector) - browser app logic.
 *
 * Data comes from data/skills-data.js (window.SKILLS). Full skill files are
 * loaded on demand from data/skill-files/<dir>.js (window.SKILL_FILES).
 * Safety rules, the SKILL.md parser and the "will Claude recognise it" check
 * come from data/scan-core.js (window.SkillScanCore), shared with the
 * repository's CI. ZIP downloads use data/zip-store.js.
 *
 * Claude Code loads personal skills from ~/.claude/skills/<name>/SKILL.md and
 * picks up changes live (code.claude.com/docs/en/skills). The Claude desktop
 * and web app take one uploaded zip per skill instead.
 */
(function () {
  'use strict';

  const Scan = window.SkillScanCore;
  const ALLOWLIST = window.SKILL_SCAN_ALLOWLIST || [];
  const Zip = window.ZipStore;

  const bundled = (window.SKILLS || []).map((s) => Object.assign({}, s, { id: s.dir, source: 'bundled' }));
  let github = [];
  let custom = []; // skills made in the app (Skill maker)
  let local = []; // installed in Claude but not part of this library
  let byId = new Map();
  const selected = new Set();
  const state = { view: 'all', mode: 'install', query: '', open: { app: false, terminal: false }, showAllTags: false };

  const $ = (id) => document.getElementById(id);
  const grid = $('grid');
  const search = $('search');
  const connectBody = $('connect-body');
  const preview = $('preview');
  const toast = $('toast');
  let previewId = null;

  const CHIPS = ['original', 'roblox', 'game', 'animation', 'testing', 'security', 'react', 'python', 'api', 'agent', 'docs'];
  const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const ORIGINAL_LABEL = "Made for Prabh's CSC";
  // Hosted on claude.ai (an Artifact): a locked-down frame that can't reach GitHub or write
  // folders, but can offer files through the `downloads` capability.
  const HOSTED = Boolean(window.claude && typeof window.claude.use === 'function');
  const SUPPORTS_FOLDER_WRITE = !HOSTED && typeof window.showDirectoryPicker === 'function';
  let hostedDownloads = null;
  const APP_DESCRIPTION_LIMIT = 200;

  const STATUS = {
    passed: { label: 'Passed safety scan', cls: 'pill-passed' },
    warnings: { label: 'Passed with notes', cls: 'pill-warnings' },
    unverified: { label: "Couldn't be checked", cls: 'pill-unverified' },
    invalid: { label: "Claude can't load this", cls: 'pill-blocked' },
    blocked: { label: 'Blocked: unsafe', cls: 'pill-blocked' },
  };
  const NOT_INSTALLABLE = new Set(['blocked', 'invalid']);

  const ICONS = {
    check: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg>',
    x: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    copy: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
    eye: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    spark: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"/></svg>',
    install: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12m0 0-4-4m4 4 4-4M5 21h14"/></svg>',
    zip: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M10 12h2m-2 3h2m-2 3h2"/></svg>',
    warn: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4m0 4h.01"/></svg>',
    ok: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/></svg>',
    info: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 16v-4m0-4h.01"/></svg>',
  };

  // ---------------------------------------------------------------- helpers

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== null && text !== undefined) node.textContent = text;
    return node;
  }

  function withIcon(node, icon, label) {
    node.innerHTML = icon;
    node.appendChild(document.createTextNode(label));
    return node;
  }

  /** Remember which control had focus, re-render, then put focus back on its replacement. */
  function keepFocus(render) {
    const active = document.activeElement;
    const key = active && active.dataset ? active.dataset.focusKey : null;
    render();
    if (!key) return;
    const target = document.querySelector(`[data-focus-key="${CSS.escape(key)}"]`);
    if (target && !target.disabled && target.offsetParent !== null) target.focus({ preventScroll: true });
    else if (!document.activeElement || document.activeElement === document.body) $('results-title').focus({ preventScroll: true });
  }

  function library() {
    return bundled.concat(github, custom);
  }

  function reindex() {
    byId = new Map(library().concat(local).map((s) => [s.id, s]));
  }

  function chosen() {
    return library().filter((s) => selected.has(s.id));
  }

  function plural(n, word) {
    return `${n} ${word}${n === 1 ? '' : 's'}`;
  }

  function showToast(message, ms) {
    toast.textContent = message;
    // Re-show as a popover so the toast lands above any open dialog.
    if (toast.showPopover) {
      try {
        if (toast.matches(':popover-open')) toast.hidePopover();
        toast.showPopover();
      } catch {
        /* popover unsupported: fall back to the fixed-position toast */
      }
    }
    requestAnimationFrame(() => toast.classList.add('show'));
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => {
        if (toast.hidePopover && toast.matches(':popover-open') && !toast.classList.contains('show')) toast.hidePopover();
      }, 250);
    }, ms || 2200);
  }

  function statusOf(findings) {
    if (findings.some((f) => f.severity === 'block')) return 'blocked';
    if (findings.some((f) => f.severity === 'invalid')) return 'invalid';
    if (findings.some((f) => f.severity === 'unverified')) return 'unverified';
    if (findings.some((f) => f.severity === 'warn')) return 'warnings';
    return 'passed';
  }

  async function sha256Hex(bytes) {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Apply the repository's reviewed exceptions. An exception only applies when
   * the file is byte-for-byte the version that was reviewed (same SHA-256).
   */
  async function applyAllowlist(dir, files, findings) {
    for (const f of findings) {
      if (f.severity !== 'block' && f.severity !== 'unverified') continue;
      const entry = ALLOWLIST.find((e) => e.skill === dir && e.file === f.file && e.rule === f.rule);
      const file = entry && files.find((x) => x.path === f.file);
      if (file && (await sha256Hex(file.bytes)) === entry.sha256) f.severity = 'allowed';
    }
  }

  function firstReason(skill, severity) {
    const f = (skill.findings || []).find((x) => x.severity === severity);
    return f ? `${f.message}${f.file && f.file !== '.' ? ` (${f.file})` : ''}` : '';
  }

  const decoder = new TextDecoder('utf-8');
  const encoder = new TextEncoder();

  /** Normalise SKILL.md so Claude Code reads the frontmatter (no BOM before ---). */
  function normalizeSkillMd(text) {
    return text.replace(/^\uFEFF/, '');
  }

  const IS_WINDOWS = /Win/i.test(navigator.platform || navigator.userAgent);
  const SKILLS_PATH = IS_WINDOWS ? '.claude\\skills' : '.claude/skills';

  // ------------------------------------------------------------ confirm UI

  function confirmDialog(title, paragraphs, okLabel, items, danger) {
    const dialog = $('confirm');
    $('confirm-title').textContent = title;
    const body = $('confirm-body');
    body.textContent = '';
    paragraphs.forEach((p) => body.appendChild(el('p', null, p)));
    if (items && items.length) {
      const ul = el('ul');
      items.forEach((item) => ul.appendChild(el('li', null, item)));
      body.appendChild(ul);
    }
    const ok = $('confirm-ok');
    ok.textContent = okLabel;
    ok.classList.toggle('btn-danger', Boolean(danger));
    $('confirm-cancel').hidden = okLabel === 'OK';
    dialog.showModal();
    return new Promise((resolve) => {
      let settled = false;
      const done = (value) => {
        if (settled) return;
        settled = true;
        ok.onclick = null;
        $('confirm-cancel').onclick = null;
        dialog.removeEventListener('close', onClose);
        if (dialog.open) dialog.close();
        resolve(value);
      };
      // A close event queued by the previous dialog can arrive after this one opens; ignore it.
      const onClose = () => {
        if (!dialog.open) done(false);
      };
      ok.onclick = () => done(true);
      $('confirm-cancel').onclick = () => done(false);
      dialog.addEventListener('close', onClose);
    });
  }

  /** A one-button message in the confirm dialog. */
  function messageDialog(title, paragraphs, items) {
    return confirmDialog(title, paragraphs, 'OK', items);
  }

  // ------------------------------------------------------------ skill files

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = () => {
        script.remove();
        resolve();
      };
      script.onerror = () => {
        script.remove();
        reject(new Error(`Could not load ${src}`));
      };
      document.head.appendChild(script);
    });
  }

  function base64ToBytes(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  /** Every file of a skill as [{ path, bytes }], with SKILL.md normalised for Claude. */
  async function getFiles(skill) {
    let files;
    if (skill.source === 'github' || skill.source === 'custom') {
      files = skill.files;
    } else {
      window.SKILL_FILES = window.SKILL_FILES || {};
      if (!window.SKILL_FILES[skill.dir]) {
        await loadScript(`data/skill-files/${encodeURIComponent(skill.dir)}.js`).catch(() => {
          throw new Error(`The files for "${skill.name}" are missing. Re-download the app, or run node scripts/skill-connector-build.js.`);
        });
      }
      files = window.SKILL_FILES[skill.dir].map((f) => ({
        path: f.path,
        bytes: typeof f.text === 'string' ? encoder.encode(f.text) : base64ToBytes(f.base64),
      }));
      delete window.SKILL_FILES[skill.dir]; // decoded copy above is all we need; free the bundle
    }
    return files.map((f) => (f.path === 'SKILL.md'
      ? { path: f.path, bytes: encoder.encode(normalizeSkillMd(decoder.decode(f.bytes))) }
      : f));
  }

  function safeRelativePath(p) {
    const parts = p.split('/');
    return parts.length > 0 && parts.every((part) => part && part !== '.' && part !== '..' && !/[\\:*?"<>|]/.test(part));
  }

  /**
   * Rewrite SKILL.md frontmatter for the Claude app: the name must match the
   * folder, and descriptions are limited to 200 characters.
   */
  // Top-level SKILL.md keys the Claude app accepts; anything else moves under metadata.
  const APP_ALLOWED_KEYS = new Set(['license', 'allowed-tools', 'compatibility', 'metadata']);

  /**
   * Rewrite SKILL.md frontmatter for the Claude app: the name must match the
   * folder, descriptions are limited to 200 characters, and only a few
   * top-level keys are accepted (others are kept under `metadata`).
   */
  function prepareForClaudeApp(text, installDir) {
    const normalized = normalizeSkillMd(text).replace(/\r\n/g, '\n');
    const match = normalized.match(/^---\n([\s\S]*?)\n---\n?/);
    const parsed = Scan.parseFrontmatter(normalized);
    let description = parsed.attributes.description || '';
    let shortened = false;
    if (description.length > APP_DESCRIPTION_LIMIT) {
      const cut = description.slice(0, APP_DESCRIPTION_LIMIT - 3);
      description = `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 120)).replace(/[\s,;:.-]+$/, '')}...`;
      shortened = true;
    }

    // Split the frontmatter into top-level key blocks (key line + indented continuation).
    const blocks = [];
    if (match) {
      for (const line of match[1].split('\n')) {
        const key = (line.match(/^([A-Za-z0-9_-]+):/) || [])[1];
        if (key) blocks.push({ key, lines: [line] });
        else if (blocks.length) blocks[blocks.length - 1].lines.push(line);
      }
    }
    const kept = [];
    const extras = [];
    let metadata = null;
    for (const block of blocks) {
      if (block.key === 'name' || block.key === 'description') continue;
      if (block.key === 'metadata') metadata = block.lines.slice();
      else if (APP_ALLOWED_KEYS.has(block.key)) kept.push(...block.lines);
      else {
        const value = [block.lines[0].replace(/^[A-Za-z0-9_-]+:\s*/, '')]
          .concat(block.lines.slice(1).map((l) => l.trim().replace(/^-\s+/, '')))
          .filter((v) => v && !/^[|>][+-]?\d*$/.test(v))
          .join(' ')
          .replace(/^(['"])([\s\S]*)\1$/, '$2');
        extras.push({ key: block.key, value });
      }
    }

    let moved = 0;
    if (extras.length) {
      if (!metadata) metadata = ['metadata:'];
      const inline = metadata[0].replace(/^metadata:\s*/, '');
      if (/^\{.*\}$/.test(inline)) {
        // Flow mapping: add the keys inside the braces.
        let body = inline.slice(1, -1).trim();
        for (const x of extras) {
          if (new RegExp(`(^|,)\\s*${x.key}\\s*:`).test(body)) continue;
          body += `${body ? ', ' : ''}${x.key}: ${JSON.stringify(x.value)}`;
          moved++;
        }
        metadata = [`metadata: {${body}}`];
      } else if (!inline || inline.startsWith('#')) {
        // Block mapping: match the indentation of existing children, skip keys already there.
        const child = metadata.slice(1).find((l) => /^\s+\S/.test(l));
        const indent = child ? child.match(/^\s+/)[0] : '  ';
        const existing = new Set(metadata.slice(1).map((l) => (l.match(/^\s+([A-Za-z0-9_-]+):/) || [])[1]).filter(Boolean));
        for (const x of extras) {
          if (existing.has(x.key)) continue;
          metadata.push(`${indent}${x.key}: ${JSON.stringify(x.value)}`);
          moved++;
        }
      }
      // Any other metadata form (a plain scalar) is left as is; the extra keys are dropped.
    }
    if (metadata) kept.push(...metadata);

    const head = [`name: ${installDir}`, `description: ${JSON.stringify(description)}`].concat(kept).join('\n');
    const bodyText = match ? normalized.slice(match[0].length) : normalized;
    return { text: `---\n${head}\n---\n${bodyText}`, shortened, movedToMetadata: moved };
  }

  // ------------------------------------------------ Claude Code skills folder

  const DB_NAME = 'prabhs-csc';
  function idb(mode, fn) {
    return new Promise((resolve, reject) => {
      const open = indexedDB.open(DB_NAME, 1);
      open.onupgradeneeded = () => open.result.createObjectStore('handles');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        try {
          const tx = open.result.transaction('handles', mode);
          const req = fn(tx.objectStore('handles'));
          tx.oncomplete = () => resolve(req && req.result);
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        } catch (err) {
          // e.g. a handle the browser cannot store; the caller treats this as "not remembered"
          reject(err);
        }
      };
    });
  }
  const idbGet = (key) => idb('readonly', (store) => store.get(key)).catch(() => null);
  const idbPut = (key, value) => idb('readwrite', (store) => store.put(value, key)).catch(() => null);
  // Skills added from GitHub are kept (with their scanned files) so they survive a reload.
  const saveGithub = () => idbPut('github-skills', github);
  const loadGithub = () => idbGet('github-skills');
  const saveCustom = () => idbPut('custom-skills', custom);
  const loadCustom = () => idbGet('custom-skills');

  /** 'unsupported' | 'disconnected' | 'needs-permission' | 'connected' */
  let connection = SUPPORTS_FOLDER_WRITE ? 'disconnected' : 'unsupported';
  let installed = new Map(); // installDir -> { name, description, body, fp }
  let lastInstall = null;
  let duplicateNames = new Map(); // skill name -> folders, when installed more than once
  let busy = false; // an install or download is running

  // Where skills install: the personal folder (~/.claude/skills, every project) or a
  // project folder (<project>/.claude/skills, that project only).
  let targets = []; // { id, kind: 'personal'|'project', label, handle }
  let currentTargetId = null;
  const currentTarget = () => targets.find((t) => t.id === currentTargetId) || null;
  const saveTargets = () => idbPut('targets', { targets, current: currentTargetId });

  async function loadTargets() {
    const saved = await idbGet('targets');
    if (saved && Array.isArray(saved.targets)) {
      targets = saved.targets;
      currentTargetId = saved.current || (targets[0] && targets[0].id) || null;
      return;
    }
    const legacy = await idbGet('skills-dir'); // folder remembered by earlier versions
    if (legacy) {
      targets = [{ id: 'personal', kind: 'personal', label: 'Personal (all projects)', handle: legacy }];
      currentTargetId = 'personal';
      saveTargets();
    }
  }

  function useTarget(target) {
    targets = targets.filter((t) => t.id !== target.id).concat(target);
    targets.sort((a, b) => (a.kind === b.kind ? a.label.localeCompare(b.label) : a.kind === 'personal' ? -1 : 1));
    currentTargetId = target.id;
    saveTargets();
  }

  /** The skills folder inside a target; with `create`, makes .claude/skills in a project. */
  async function skillsDirOf(target, create) {
    if (target.kind === 'personal') return target.handle;
    try {
      const claudeDir = await target.handle.getDirectoryHandle('.claude', { create });
      return await claudeDir.getDirectoryHandle('skills', { create });
    } catch (err) {
      if (!create && err && (err.name === 'NotFoundError' || err.name === 'TypeMismatchError')) return null;
      throw err;
    }
  }

  async function pickSkillsFolder() {
    const ok = await confirmDialog(
      'Connect to Claude Code',
      [
        'In the next window, open your user folder, then .claude, then skills. Create the skills folder if it is not there yet.',
        `On Windows this is C:\\Users\\<your name>\\.claude\\skills. Skills here work in every project. You only need to do this once.`,
      ],
      'Choose folder'
    );
    if (!ok) return null;
    const handle = await window.showDirectoryPicker({ id: 'claude-skills', mode: 'readwrite' });
    if (handle.name !== 'skills') {
      const keep = await confirmDialog(
        'Use this folder?',
        [`This folder is called "${handle.name}". Claude Code only looks for skills in a folder called "skills" inside .claude, so skills installed here will not show up in Claude. Use "${handle.name}" anyway?`],
        'Use it anyway'
      );
      if (!keep) return null;
    }
    useTarget({ id: 'personal', kind: 'personal', label: 'Personal (all projects)', handle });
    connection = 'connected';
    return handle;
  }

  /** Add a project folder as an install target (skills go into <project>/.claude/skills). */
  async function addProjectTarget() {
    if (!SUPPORTS_FOLDER_WRITE) return;
    const ok = await confirmDialog(
      'Add a project folder',
      [
        'Choose the folder you open in Claude Code for that project (its main folder).',
        'Skills installed there go into .claude/skills inside it and only load in that project. The app creates the folder when you first install.',
      ],
      'Choose project folder'
    );
    if (!ok) return;
    try {
      const handle = await window.showDirectoryPicker({ id: 'claude-project', mode: 'readwrite' });
      if (handle.name === 'skills' || handle.name === '.claude') {
        const keep = await confirmDialog(
          'Is this the project folder?',
          [`You picked a folder called "${handle.name}". Choose the project's main folder instead (the one that contains .claude), so skills end up in the right place.`],
          `Use "${handle.name}" anyway`
        );
        if (!keep) return;
      }
      useTarget({ id: `project:${handle.name}:${Date.now()}`, kind: 'project', label: `Project: ${handle.name}`, handle });
      lastInstall = null;
      await refreshInstalled();
      renderAll();
      showToast(`Now installing into ${handle.name}/.claude/skills.`, 3500);
    } catch (err) {
      if (!(err && err.name === 'AbortError')) showToast(`Couldn't add the project: ${err.message}`, 5000);
    }
  }

  async function switchTarget(id) {
    if (id === currentTargetId) return;
    rescan = new Map();
    currentTargetId = id;
    saveTargets();
    lastInstall = null;
    await refreshInstalled();
    renderAll();
  }

  /** Make sure a target's folder can be written, asking for access if needed (run from a click). */
  async function ensureAccess(target) {
    let permission = await target.handle.queryPermission({ mode: 'readwrite' });
    if (permission !== 'granted') permission = await target.handle.requestPermission({ mode: 'readwrite' });
    return permission === 'granted';
  }

  /**
   * Get the current target's writable skills folder, prompting only when needed (must run
   * from a click). With `noPick`, never opens the folder picker (used by Remove and Undo).
   */
  async function getSkillsFolder(forcePick, noPick) {
    const target = currentTarget();
    if (!forcePick && target) {
      if (await ensureAccess(target)) {
        connection = 'connected';
        return skillsDirOf(target, true);
      }
      if (noPick) return null;
      if (target.kind === 'project') {
        showToast('Access to the project folder was not allowed.', 4000);
        return null;
      }
      showToast('Access to the skills folder was not allowed. Choose it again to reconnect.', 4000);
    } else if (!forcePick && noPick) {
      return null;
    }
    return pickSkillsFolder();
  }

  // ------------------------------------------------------------ skill maker

  const MAKER_TEMPLATE = [
    '# Skill title',
    '',
    '## When to Use',
    '',
    '- Describe the situations where Claude should use this skill.',
    '',
    '## How It Works',
    '',
    '1. Step one.',
    '2. Step two.',
    '',
    '## Examples',
    '',
    '**Request:** "An example of what the user might ask."',
    '**What Claude does:** How Claude should respond using this skill.',
    '',
  ].join('\n');
  let editingId = null;

  function makerSkillMd() {
    const name = $('maker-name').value.trim();
    const description = $('maker-description').value.replace(/\s+/g, ' ').trim();
    const body = $('maker-body').value.replace(/\r\n/g, '\n').trim();
    return `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n\n${body}\n`;
  }

  /** Live checks shown while writing a skill. Returns whether it can be saved. */
  function updateMaker() {
    const name = $('maker-name').value.trim();
    const description = $('maker-description').value.replace(/\s+/g, ' ').trim();
    const text = makerSkillMd();
    const compat = Scan.checkClaudeCompat(text, name || 'new-skill');
    const findings = Scan.scanText('SKILL.md', text);
    const safety = statusOf(findings);
    const clash = name && library().find((s) => s.installDir === name && s.id !== editingId);
    const validName = /^[a-z0-9][a-z0-9-]{0,63}$/.test(name);

    $('maker-desc-count').textContent = `${description.length}/200 for the Claude app`;
    $('maker-desc-count').classList.toggle('over', description.length > 200);

    const list = $('maker-checks');
    list.textContent = '';
    const row = (ok, label, detail) => {
      const li = el('li', ok === true ? 'ok' : ok === false ? 'bad' : 'warn');
      li.appendChild(el('strong', null, label));
      if (detail) li.appendChild(el('span', null, detail));
      list.appendChild(li);
    };
    row(validName, 'Name', validName ? `Installs as the folder "${name}"` : 'Use lowercase letters, numbers and hyphens, like "my-skill"');
    row(description.length > 0 ? (description.length > 200 ? null : true) : false, 'Description',
      !description ? 'Say what the skill does and when Claude should use it' : description.length > 200 ? 'Works in Claude Code; shortened to 200 characters for the Claude app' : 'Good length');
    const codeIssue = compat.issues.find((i) => i.target === 'code' && i.level !== 'info');
    row(compat.code === 'ready' ? true : compat.code === 'warn' ? null : false, 'Claude Code', codeIssue ? codeIssue.message : 'Claude Code will load it');
    const appIssue = compat.issues.find((i) => i.target === 'app' && i.level !== 'info');
    row(compat.app === 'ready' ? true : compat.app === 'warn' ? null : false, 'Claude app', appIssue ? appIssue.message : 'Ready to upload');
    row(safety === 'blocked' ? false : safety === 'warnings' ? null : true, 'Safety scan',
      safety === 'blocked' ? firstReason({ findings }, 'block') : safety === 'warnings' ? firstReason({ findings }, 'warn') : 'Passed');
    if (clash) row(null, 'Name in use', `"${name}" is already a skill in the library. Only one of them can be installed at a time.`);

    const canSave = validName && description && compat.code !== 'error' && safety !== 'blocked';
    $('maker-save').disabled = !canSave;
    return canSave;
  }

  function openMaker(skill) {
    editingId = skill ? skill.id : null;
    $('maker-title').textContent = skill ? `Edit ${skill.name}` : 'Create a skill';
    $('maker-name').value = skill ? skill.name : '';
    $('maker-description').value = skill ? skill.description : '';
    $('maker-body').value = skill ? skill.body : MAKER_TEMPLATE;
    updateMaker();
    if (preview.open) preview.close();
    $('maker').showModal();
    $('maker-name').focus();
  }

  function saveMaker() {
    if (!updateMaker()) return;
    const text = makerSkillMd();
    const parsed = Scan.parseFrontmatter(text);
    const name = parsed.attributes.name;
    const bytes = encoder.encode(text);
    const findings = Scan.scanText('SKILL.md', text);
    const skill = {
      id: `custom:${name}`,
      source: 'custom',
      name,
      dir: name,
      installDir: name,
      description: parsed.attributes.description,
      body: parsed.body,
      files: [{ path: 'SKILL.md', bytes }],
      fp: Scan.skillFingerprint(text, [{ path: 'SKILL.md', size: bytes.length }]),
      findings,
      status: statusOf(findings),
    };
    if (editingId) selected.delete(editingId);
    custom = custom.filter((s) => s.id !== editingId && s.id !== skill.id).concat(skill);
    selected.add(skill.id);
    saveCustom();
    reindex();
    $('maker').close();
    renderAll();
    showToast(`Saved ${name} to your library and selected it. Click Install to add it to Claude.`, 4500);
  }

  async function deleteCustom(skill) {
    const ok = await confirmDialog(`Delete ${skill.name}?`, ['This removes the skill you made from the library. If it is installed in Claude, it stays installed until you remove it there.'], 'Delete', null, true);
    if (!ok) return;
    custom = custom.filter((s) => s.id !== skill.id);
    selected.delete(skill.id);
    saveCustom();
    reindex();
    if (preview.open) preview.close();
    renderAll();
  }

  // -------------------------------------------------------- re-scan installed

  let rescan = new Map(); // installDir -> { status, findings }

  /** Run today's safety rules over every installed skill in the current folder. */
  async function rescanInstalled() {
    const target = currentTarget();
    if (!target || busy) return;
    busy = true;
    try {
      if (!(await ensureAccess(target))) {
        showToast('Access to the folder was not allowed, so nothing was checked.', 4000);
        return;
      }
      const dir = await skillsDirOf(target, false);
      const results = new Map();
      if (dir) {
        const dirs = [];
        for await (const [name, handle] of dir.entries()) {
          if (handle.kind === 'directory' && !name.startsWith('.') && installed.has(name)) dirs.push([name, handle]);
        }
        let n = 0;
        for (const [name, handle] of dirs) {
          showToast(`Checking ${name} (${++n} of ${dirs.length})...`, 60000);
          const files = [];
          const findings = [];
          for (const f of await listFolder(handle, '')) {
            const bytes = new Uint8Array(await (await f.handle.getFile()).arrayBuffer());
            files.push({ path: f.path, bytes });
            findings.push(...Scan.inspectPath(f.path).filter((x) => x.severity === 'block'));
            findings.push(...Scan.inspectFile(f.path, bytes));
          }
          await applyAllowlist(name, files, findings);
          results.set(name, { status: statusOf(findings), findings });
        }
      }
      rescan = results;
      renderAll();
      const count = (st) => [...results.values()].filter((r) => r.status === st).length;
      const problems = [...results.entries()].filter(([, r]) => r.status === 'blocked' || r.status === 'unverified');
      showToast(`Checked ${plural(results.size, 'installed skill')}.`, 2500);
      await messageDialog(
        problems.length ? 'Some installed skills need a look' : 'All installed skills passed',
        [`Checked ${plural(results.size, 'skill')} with today's safety rules: ${count('passed')} passed, ${count('warnings')} passed with notes, ${count('unverified')} couldn't be checked, ${count('blocked')} unsafe.`,
          problems.length ? 'Open a skill to see what was found. You can remove it from Claude there.' : 'Nothing unsafe was found.'],
        problems.map(([name, r]) => `${name}: ${r.status === 'blocked' ? 'unsafe' : "couldn't be checked"} (${firstReason(r, r.status === 'blocked' ? 'block' : 'unverified')})`)
      );
    } catch (err) {
      showToast(`Re-scan failed: ${err.message}`, 5000);
    } finally {
      busy = false;
    }
  }

  // ---------------------------------------------------------------- history

  // Every install, update and removal, with what was there before so it can be undone.
  let history = [];
  const UNDO_BATCHES_KEPT = 3;
  const saveHistory = () => idbPut('history', history);

  function recordHistory(entries) {
    if (!entries.length) return null;
    const batch = Date.now();
    const target = currentTarget();
    history = entries.map((e) => ({ ...e, batch, time: new Date().toISOString(), targetId: target && target.id, targetLabel: target ? target.label : '', undone: false }))
      .concat(history)
      .slice(0, 80);
    // Keep the backups only for the latest few changes; older ones are listed but not undoable.
    const recent = [...new Set(history.map((e) => e.batch))].slice(0, UNDO_BATCHES_KEPT);
    history = history.map((e) => (recent.includes(e.batch) ? e : { ...e, undo: null }));
    saveHistory();
    return batch;
  }

  function undoableBatch() {
    const latest = history.find((e) => e.action !== 'undo');
    if (!latest || latest.undone || !latest.undo) return null;
    return latest.batch;
  }

  async function undoBatch(batch) {
    const entries = history.filter((e) => e.batch === batch && e.undo && !e.undone);
    if (!entries.length || busy) return;
    const target = targets.find((t) => t.id === entries[0].targetId);
    if (!target) {
      showToast('That folder is no longer connected, so this change cannot be undone.', 4000);
      return;
    }
    const ok = await confirmDialog(
      'Undo this change?',
      [`This puts ${entries.length === 1 ? 'this skill' : `these ${entries.length} skills`} in "${target.label}" back the way ${entries.length === 1 ? 'it was' : 'they were'} before.`],
      'Undo',
      entries.map((e) => `${e.skill}: ${{ install: 'remove the newly installed copy', update: 'restore the previous version', remove: 'put it back' }[e.action]}`)
    );
    if (!ok) return;
    busy = true;
    try {
      if (!(await ensureAccess(target))) {
        showToast('Access to the folder was not allowed, so nothing was changed.', 4000);
        return;
      }
      const dir = await skillsDirOf(target, true);
      const failed = [];
      for (const e of entries.slice().reverse()) {
        try {
          await removeIfPresent(dir, e.dir);
          if (e.undo.kind === 'restore') await writeSkill(dir, e.dir, e.undo.files);
          e.undone = true;
        } catch (err) {
          failed.push(`${e.skill}: ${err.message}`);
        }
      }
      history = [{ action: 'undo', skill: plural(entries.length - failed.length, 'skill'), dir: '', batch: Date.now(), time: new Date().toISOString(), targetId: target.id, targetLabel: target.label, undo: null, undone: false }].concat(history);
      saveHistory();
      lastInstall = null;
      if (target.id !== currentTargetId) await switchTarget(target.id);
      else {
        await refreshInstalled();
        renderAll();
      }
      showToast(failed.length ? `Undo finished with problems: ${failed.join('; ')}` : 'Undone. Your skills are back the way they were.', 5000);
    } finally {
      busy = false;
    }
  }

  async function readSkillMd(dirHandle) {
    try {
      const file = await (await dirHandle.getFileHandle('SKILL.md')).getFile();
      return await file.text();
    } catch {
      return null;
    }
  }

  /** Every file under a folder handle as [{ path, size, handle }], skipping caches. */
  async function listFolder(dirHandle, prefix) {
    const out = [];
    for await (const [name, handle] of dirHandle.entries()) {
      if (handle.kind === 'directory') {
        if (!Scan.IGNORED_DIR_NAMES.has(name)) out.push(...(await listFolder(handle, `${prefix}${name}/`)));
      } else if (!Scan.IGNORED_FILE_NAMES.has(name)) {
        const file = await handle.getFile();
        out.push({ path: `${prefix}${name}`, size: file.size, handle });
      }
    }
    return out;
  }

  /** Re-read what is installed in Claude Code's skills folder (no prompts). */
  async function refreshInstalled() {
    if (!SUPPORTS_FOLDER_WRITE) return;
    const target = currentTarget();
    if (!target) {
      connection = 'disconnected';
      installed = new Map();
      local = [];
      reindex();
      return;
    }
    if ((await target.handle.queryPermission({ mode: 'readwrite' })) !== 'granted') {
      connection = 'needs-permission';
      return;
    }
    connection = 'connected';
    const next = new Map();
    try {
      const folder = await skillsDirOf(target, false);
      if (folder) for await (const [dir, handle] of folder.entries()) {
        if (handle.kind !== 'directory' || dir.startsWith('.')) continue;
        const text = await readSkillMd(handle);
        if (text === null) continue;
        const parsed = Scan.parseFrontmatter(text);
        const files = await listFolder(handle, '');
        next.set(dir, {
          name: parsed.attributes.name || dir,
          description: parsed.attributes.description || '',
          body: parsed.body,
          fp: Scan.skillFingerprint(text, files),
        });
      }
    } catch {
      connection = 'needs-permission';
      return;
    }
    installed = next;
    // Folders sharing one skill name: Claude sees duplicates.
    const byName = new Map();
    for (const [dir, info] of installed) byName.set(info.name, (byName.get(info.name) || []).concat(dir));
    duplicateNames = new Map([...byName].filter(([, dirs]) => dirs.length > 1));
    const known = new Set(library().map((s) => s.installDir));
    local = [...installed.entries()]
      .filter(([dir]) => !known.has(dir))
      .map(([dir, info]) => ({ id: `local:${dir}`, source: 'local', dir, installDir: dir, name: info.name, description: info.description, body: info.body }));
    reindex();
  }

  /** Other installed folders that hold a skill with this skill's name. */
  function otherCopies(skill) {
    return [...installed.entries()].filter(([dir, info]) => dir !== skill.installDir && info.name === skill.name).map(([dir]) => dir);
  }

  /** 'installed' | 'update' | 'elsewhere' | null for a library skill. */
  function installState(skill) {
    const info = installed.get(skill.installDir);
    if (!info) return otherCopies(skill).length ? 'elsewhere' : null;
    if (skill.source === 'local') return 'installed';
    return info.fp === skill.fp ? 'installed' : 'update';
  }

  async function folderExists(parent, name) {
    try {
      await parent.getDirectoryHandle(name);
      return true;
    } catch {
      return false;
    }
  }

  async function writeSkill(parent, folder, files) {
    const root = await parent.getDirectoryHandle(folder, { create: true });
    for (const file of files) {
      if (!safeRelativePath(file.path)) throw new Error(`Unsafe file path in ${folder}: ${file.path}`);
      const parts = file.path.split('/');
      let dir = root;
      for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part, { create: true });
      const handle = await dir.getFileHandle(parts[parts.length - 1], { create: true });
      const writable = await handle.createWritable();
      await writable.write(file.bytes);
      await writable.close();
    }
  }

  /** Read the installed SKILL.md back and confirm Claude Code will load it. */
  async function verifyInstalled(parent, skill) {
    try {
      const text = await readSkillMd(await parent.getDirectoryHandle(skill.installDir));
      if (text === null) return 'SKILL.md was not written';
      const compat = Scan.checkClaudeCompat(text, skill.installDir);
      if (compat.code === 'error') return compat.issues.find((i) => i.target === 'code' && i.level === 'error').message;
      if (compat.installDir !== skill.installDir) return 'Folder name does not match the skill name';
      return null;
    } catch (err) {
      return err.message;
    }
  }

  // ------------------------------------------------------- install / download

  async function confirmUnverified(picks) {
    const risky = picks.filter((s) => s.status === 'unverified');
    if (!risky.length) return true;
    return confirmDialog(
      `${plural(risky.length, 'skill')} couldn't be checked`,
      ['The safety scan could not inspect everything in these skills, so it cannot tell you they are safe. Only continue if you trust where they came from.'],
      'Install anyway',
      risky.map((s) => `${s.name}: ${firstReason(s, 'unverified')}`)
    );
  }

  /** Read a whole installed skill folder into memory (to restore it if an update fails). */
  async function backupFolder(parent, dir) {
    try {
      const handle = await parent.getDirectoryHandle(dir);
      const files = await listFolder(handle, '');
      return Promise.all(files.map(async (f) => ({ path: f.path, bytes: new Uint8Array(await (await f.handle.getFile()).arrayBuffer()) })));
    } catch {
      return null;
    }
  }

  async function removeIfPresent(parent, dir) {
    try {
      await parent.removeEntry(dir, { recursive: true });
    } catch (err) {
      if (err && err.name === 'NotFoundError') return;
      throw err;
    }
  }

  /**
   * Install one skill; on any failure put the previous copy back.
   * Returns { problem } or { history } describing how to undo it.
   */
  async function installOne(folder, s) {
    let files;
    try {
      files = await getFiles(s);
    } catch (err) {
      return { problem: err.message };
    }
    const unsafe = files.find((f) => !safeRelativePath(f.path));
    if (unsafe) return { problem: `the file name "${unsafe.path}" is not allowed on this computer` };
    try {
      const old = await folder.getFileHandle(s.installDir);
      if (old) return { problem: `a file named "${s.installDir}" is in the way in your skills folder` };
    } catch {
      /* no file in the way */
    }
    const backup = await backupFolder(folder, s.installDir);
    try {
      await removeIfPresent(folder, s.installDir);
      await writeSkill(folder, s.installDir, files);
      const problem = await verifyInstalled(folder, s);
      if (problem) throw new Error(problem);
      return {
        history: backup
          ? { action: 'update', skill: s.name, dir: s.installDir, undo: { kind: 'restore', files: backup } }
          : { action: 'install', skill: s.name, dir: s.installDir, undo: { kind: 'remove' } },
      };
    } catch (err) {
      try {
        await removeIfPresent(folder, s.installDir);
        if (backup) await writeSkill(folder, s.installDir, backup);
      } catch {
        return { problem: `${err.message} (and the previous copy could not be restored)` };
      }
      return { problem: `${err.message}${backup ? ' (the previous copy was kept)' : ''}` };
    }
  }

  function installSelected(forcePick) {
    return installSkills(chosen(), forcePick);
  }

  /** Library skills whose installed copy (in the current folder) is out of date. */
  function updatable() {
    return library().filter((s) => installState(s) === 'update');
  }

  async function installSkills(picks, forcePick) {
    if (!picks.length || busy) return;
    busy = true;
    try {
      const sameFolder = new Map();
      for (const s of picks) sameFolder.set(s.installDir, (sameFolder.get(s.installDir) || []).concat(s));
      const clashes = [...sameFolder].filter(([, list]) => list.length > 1);
      if (clashes.length) {
        await messageDialog(
          'Two selected skills use the same name',
          ['Claude can only have one skill per name. Deselect one of each pair, then install again.'],
          clashes.map(([dir, list]) => `${dir}: ${list.map((s) => (s.source === 'github' ? `${s.origin} (GitHub)` : 'this library')).join(' and ')}`)
        );
        return;
      }
      if (!(await confirmUnverified(picks))) return;
      const folder = await getSkillsFolder(forcePick);
      if (!folder) return;

      let wasEmpty = true;
      for await (const entry of folder.values()) {
        if (entry.kind === 'directory') {
          wasEmpty = false;
          break;
        }
      }

      const existing = [];
      for (const s of picks) if (await folderExists(folder, s.installDir)) existing.push(s.installDir);
      if (existing.length) {
        const replace = await confirmDialog(
          'Update installed skills?',
          [existing.length === 1
            ? 'This skill is already in Claude Code. It will be replaced with the version from this library. If anything goes wrong, the current copy is kept.'
            : `These ${existing.length} skills are already in Claude Code. They will be replaced with the versions from this library. If anything goes wrong, the current copies are kept.`],
          'Update',
          existing
        );
        if (!replace) return;
      }

      const dupes = picks.flatMap((s) => otherCopies(s).map((dir) => ({ s, dir })));
      if (dupes.length) {
        const clean = await confirmDialog(
          'Remove old copies?',
          ['These skills are also installed under another folder name, so Claude would see two copies. Remove the old folders?'],
          'Remove old copies',
          dupes.map((d) => `${d.s.name}: folder "${d.dir}"`),
          true
        );
        if (clean) for (const d of dupes) await removeIfPresent(folder, d.dir);
      }

      const failed = [];
      const changes = [];
      let done = 0;
      for (const s of picks) {
        showToast(`Installing ${s.name} (${done + 1} of ${picks.length})...`, 60000);
        const result = await installOne(folder, s);
        if (result.problem) failed.push(`${s.name}: ${result.problem}`);
        else changes.push(result.history);
        done++;
      }

      const batch = recordHistory(changes);
      const skippedNotes = picks.filter((s) => s.skippedFiles).map((s) => `${s.name}: ${plural(s.skippedFiles, 'file')} were not installed because they couldn't be checked`);
      const target = currentTarget();
      lastInstall = { count: done - failed.length, failed, notes: skippedNotes, wasEmpty, folder: target ? target.label : folder.name, batch };
      await refreshInstalled();
      renderAll();
      showToast(failed.length
        ? `Installed ${done - failed.length} of ${done}. ${plural(failed.length, 'skill')} could not be installed; see the panel for details.`
        : `Installed and verified ${plural(done, 'skill')} in Claude Code.`, 5000);
    } catch (err) {
      if (!(err && err.name === 'AbortError')) showToast(`Install failed: ${err.message}`, 6000);
      await refreshInstalled();
      renderAll();
    } finally {
      busy = false;
    }
  }

  async function removeInstalled(skill) {
    const folder = await getSkillsFolder(false, true);
    if (!folder) {
      showToast('Reconnect to Claude Code first (sidebar or Installed view).', 4000);
      return;
    }
    const ok = await confirmDialog(
      `Remove ${skill.name} from Claude?`,
      [`This deletes the "${skill.installDir}" folder from ${(currentTarget() || {}).label || 'your Claude Code skills folder'}. Claude stops using it straight away. You can undo this from History.`],
      'Remove',
      null,
      true
    );
    if (!ok) return;
    try {
      const backup = await backupFolder(folder, skill.installDir);
      await removeIfPresent(folder, skill.installDir);
      recordHistory([{ action: 'remove', skill: skill.name, dir: skill.installDir, undo: backup ? { kind: 'restore', files: backup } : null }]);
      lastInstall = null;
      showToast(`Removed ${skill.name} from Claude Code. You can undo this in History.`, 4000);
    } catch (err) {
      showToast(`Remove failed: ${err.message}`, 6000);
    }
    await refreshInstalled();
    if (preview.open) {
      if (skill.source === 'local') preview.close();
      else openPreview(skill.id);
    }
    renderAll();
  }

  async function connectFolder(forcePick) {
    try {
      const folder = await getSkillsFolder(forcePick);
      if (!folder) return;
      if (forcePick) lastInstall = null;
      await refreshInstalled();
      renderAll();
      showToast(`Connected to Claude Code (${plural(installed.size, 'skill')} installed).`, 3500);
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      showToast(`Couldn't connect: ${err.message}`, 6000);
    }
  }

  async function saveBlob(bytes, filename) {
    const blob = new Blob([bytes], { type: 'application/zip' });
    if (HOSTED) {
      if (!hostedDownloads) throw new Error('Saving files is not available in this view.');
      try {
        await hostedDownloads.save({ filename, data: blob });
      } catch (err) {
        if (err && err.code === 'declined') {
          const declined = new Error('Download cancelled.');
          declined.name = 'AbortError';
          throw declined;
        }
        throw new Error((err && err.message) || 'Saving files is not available in this view.');
      }
      return;
    }
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 10000);
  }

  /** One zip with every selected skill folder, for unzipping into .claude/skills. */
  async function downloadCodeZip() {
    const picks = chosen();
    if (!picks.length || busy) return;
    busy = true;
    try {
      if (!(await confirmUnverified(picks))) return;
      const entries = [];
      for (const s of picks) {
        for (const f of await getFiles(s)) {
          if (!safeRelativePath(f.path)) throw new Error(`The file name "${f.path}" in ${s.installDir} is not allowed on this computer`);
          entries.push({ path: `${s.installDir}/${f.path}`, data: f.bytes });
        }
      }
      await saveBlob(Zip.createZip(entries), picks.length === 1 ? `${picks[0].installDir}.zip` : 'claude-code-skills.zip');
      showToast(`Download started. Unzip it into your ${SKILLS_PATH} folder.`, 4000);
    } catch (err) {
      if (!(err && err.name === 'AbortError')) showToast(`Download failed: ${err.message}`, 6000);
    } finally {
      busy = false;
    }
  }

  /** One zip per skill, shaped the way the Claude desktop/web app expects. */
  async function downloadAppZips() {
    const picks = chosen();
    if (!picks.length || busy) return;
    busy = true;
    let saved = 0;
    try {
      if (!(await confirmUnverified(picks))) return;
      let shortened = 0;
      for (let i = 0; i < picks.length; i++) {
        const s = picks[i];
        const entries = [];
        for (const f of await getFiles(s)) {
          if (!safeRelativePath(f.path)) throw new Error(`The file name "${f.path}" in ${s.installDir} is not allowed on this computer`);
          let data = f.bytes;
          if (f.path === 'SKILL.md') {
            const prepared = prepareForClaudeApp(decoder.decode(f.bytes), s.installDir);
            if (prepared.shortened) shortened++;
            data = encoder.encode(prepared.text);
          }
          entries.push({ path: `${s.installDir}/${f.path}`, data });
        }
        await saveBlob(Zip.createZip(entries), `${s.installDir}.zip`);
        saved++;
        if (i < picks.length - 1 && !HOSTED) await new Promise((r) => setTimeout(r, 400));
      }
      const fitted = shortened ? ` (${shortened} description${shortened === 1 ? '' : 's'} shortened to fit)` : '';
      showToast(`${HOSTED ? 'Saved' : 'Started'} ${plural(picks.length, 'download')} for the Claude app${fitted}. Upload them in Customize > Skills.`, 6000);
    } catch (err) {
      if (err && err.name === 'AbortError') {
        if (saved) showToast(`Stopped after ${saved} of ${picks.length} downloads.`, 4000);
        return;
      }
      showToast(`Download failed: ${err.message}`, 6000);
    } finally {
      busy = false;
    }
  }

  // ------------------------------------------------------------ GitHub scan

  const GH_LIMITS = { skills: 30, filesPerSkill: 300, bytesPerSkill: 15 * 1024 * 1024, parallel: 6 };
  let ghFound = [];
  let ghScan = null; // AbortController of the scan in progress
  let lastScan = null; // { link, label, sha } of the last successful scan

  // Watched repositories: { link, label, sha, checkedAt, changed }
  let watched = [];
  const WATCH_INTERVAL = 60 * 60 * 1000;
  const saveWatched = () => idbPut('watched-repos', watched);

  function watchLink(link, label, sha) {
    watched = watched.filter((w) => w.link !== link).concat({ link, label, sha, checkedAt: Date.now(), changed: false });
    saveWatched();
    renderWatched();
    renderWatchNotice();
  }

  function unwatch(link) {
    watched = watched.filter((w) => w.link !== link);
    saveWatched();
    renderWatched();
    renderWatchNotice();
  }

  /** Check watched repos for new commits (at most once an hour each, to respect GitHub's limit). */
  async function checkWatched(force) {
    let changedAny = false;
    for (const w of watched) {
      if (!force && Date.now() - (w.checkedAt || 0) < WATCH_INTERVAL) continue;
      try {
        const { commit } = await resolveRef(parseGitHubUrl(w.link));
        w.checkedAt = Date.now();
        if (commit.sha !== w.sha) {
          w.changed = true;
          changedAny = true;
        }
      } catch {
        /* offline or rate-limited: try again next time */
      }
    }
    saveWatched();
    renderWatchNotice();
    return changedAny;
  }

  function renderWatchNotice() {
    const box = $('watch-notice');
    box.textContent = '';
    const changed = watched.filter((w) => w.changed);
    box.hidden = !changed.length;
    if (!changed.length) return;
    box.appendChild(el('div', 'watch-title', changed.length === 1 ? 'New changes on GitHub' : `${changed.length} watched repos changed`));
    for (const w of changed) {
      const row = el('div', 'watch-row');
      row.appendChild(el('span', null, w.label));
      const scan = el('button', 'link-btn', 'Scan now');
      scan.addEventListener('click', () => scanLink(w.link));
      row.appendChild(scan);
      box.appendChild(row);
    }
  }

  function renderWatched() {
    const wrap = $('github-watched');
    wrap.textContent = '';
    wrap.hidden = !watched.length;
    if (!watched.length) return;
    wrap.appendChild(el('p', 'section-label', 'Watched repositories'));
    for (const w of watched) {
      const row = el('div', 'watch-row');
      row.appendChild(el('span', null, `${w.label}${w.changed ? ' (changed)' : ''}`));
      const scan = el('button', 'link-btn', 'Scan');
      scan.type = 'button';
      scan.addEventListener('click', () => scanLink(w.link));
      const stop = el('button', 'link-btn', 'Stop watching');
      stop.type = 'button';
      stop.addEventListener('click', () => unwatch(w.link));
      row.appendChild(scan);
      row.appendChild(stop);
      wrap.appendChild(row);
    }
  }

  /** Open the GitHub dialog with a link and scan it. */
  function scanLink(link) {
    if (!$('github').open) $('github').showModal();
    $('github-url').value = link;
    renderWatched();
    $('github-form').requestSubmit();
  }

  function parseGitHubUrl(input) {
    let text = input.trim();
    if (!text) throw new Error('Paste a GitHub link first.');
    const ssh = text.match(/^git@github\.com:([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i);
    if (ssh) text = `https://github.com/${ssh[1]}/${ssh[2]}`;
    if (/\s/.test(text)) throw new Error("That doesn't look like a link. Paste something like https://github.com/owner/repo.");
    // Shorthand: owner/repo, or owner/repo/tree/branch/path
    if (/^[\w.-]+\/[\w.-]+(?:\/|$)/.test(text) && !/^(?:www\.)?github\.com\//i.test(text) && !text.includes('.com/') && !/^\w+:/.test(text)) {
      text = `https://github.com/${text}`;
    }
    let url;
    try {
      url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    } catch {
      throw new Error("That doesn't look like a link. Paste something like https://github.com/owner/repo.");
    }
    if (!/^(?:www\.)?github\.com$/i.test(url.hostname)) {
      throw new Error('Only github.com links are supported (not gists, raw files or other sites).');
    }
    let parts;
    try {
      parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    } catch {
      throw new Error('This link has a broken %-code in it. Copy it again from the address bar.');
    }
    if (parts.length < 2 || !/^[\w.-]+$/.test(parts[0]) || !/^[\w.-]+$/.test(parts[1])) {
      throw new Error('Use a link to a repository, like https://github.com/owner/repo.');
    }
    const result = { owner: parts[0], repo: parts[1].replace(/\.git$/, ''), refParts: null, path: '', blob: false };
    const kind = parts[2];
    if ((kind === 'tree' || kind === 'blob') && parts[3]) {
      result.refParts = parts.slice(3); // branch names can contain "/": resolved against GitHub later
      result.blob = kind === 'blob';
    } else if (kind === 'commit' && parts[3]) {
      result.refParts = [parts[3]];
    } else if (kind === 'releases' && parts[3] === 'tag' && parts[4]) {
      result.refParts = [parts[4]];
    }
    return result;
  }

  async function githubApi(path, signal) {
    let res;
    try {
      res = await fetch(`https://api.github.com${path}`, { headers: { Accept: 'application/vnd.github+json' }, signal });
    } catch (err) {
      if (err && err.name === 'AbortError') throw err;
      throw new Error("Couldn't reach GitHub. Check your internet connection and try again.");
    }
    if (res.status === 404) throw Object.assign(new Error('Repository, branch or folder not found. Private repositories are not supported.'), { status: 404 });
    if (res.status === 409) throw Object.assign(new Error('This repository is empty.'), { status: 409 });
    if (res.status === 422) throw Object.assign(new Error('That branch or commit was not found in this repository.'), { status: 422 });
    if (res.status === 403 || res.status === 429) {
      if (res.headers.get('x-ratelimit-remaining') === '0' || res.status === 429) {
        const reset = Number(res.headers.get('x-ratelimit-reset'));
        const when = reset ? ` Try again after ${new Date(reset * 1000).toLocaleTimeString()}.` : ' Try again later.';
        throw new Error(`GitHub's limit for lookups without signing in was reached.${when}`);
      }
      throw new Error('GitHub refused access to this repository (it may be blocked or restricted).');
    }
    if (!res.ok) throw new Error(`GitHub returned an error (${res.status}). Try again in a moment.`);
    return res.json();
  }

  /** Resolve the branch/commit and folder from a tree/blob link (branch names may contain "/"). */
  async function resolveRef(target, signal) {
    if (!target.refParts) {
      const repo = await githubApi(`/repos/${target.owner}/${target.repo}`, signal);
      return { commit: await githubApi(`/repos/${target.owner}/${target.repo}/commits/${encodeURIComponent(repo.default_branch)}`, signal), path: '' };
    }
    const parts = target.refParts;
    let lastError = null;
    for (let take = 1; take <= Math.min(parts.length, 4); take++) {
      try {
        const commit = await githubApi(`/repos/${target.owner}/${target.repo}/commits/${encodeURIComponent(parts.slice(0, take).join('/'))}`, signal);
        let path = parts.slice(take).join('/');
        if (target.blob) path = path.split('/').slice(0, -1).join('/'); // a file link scans its folder
        return { commit, path };
      } catch (err) {
        if (!err.status || (err.status !== 404 && err.status !== 422)) throw err;
        lastError = err;
      }
    }
    throw lastError;
  }

  function rawUrl(target, sha, filePath) {
    return `https://raw.githubusercontent.com/${target.owner}/${target.repo}/${sha}/${filePath.split('/').map(encodeURIComponent).join('/')}`;
  }

  async function mapLimit(items, limit, fn) {
    const results = new Array(items.length);
    let next = 0;
    const worker = async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i], i);
      }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return results;
  }

  /**
   * Find and scan every skill in a GitHub repo or folder.
   *
   * Anything that cannot be inspected is reported as `unverified` (the user is
   * warned and asked) rather than blocked; only content detected as dangerous
   * is `block`. Files are kept in memory so the exact scanned bytes are what
   * gets installed.
   */
  async function scanGitHub(input, onStatus, signal) {
    const target = parseGitHubUrl(input);
    onStatus(`Looking up ${target.owner}/${target.repo}...`);
    const { commit, path: subPath } = await resolveRef(target, signal);
    const sha = commit.sha;
    const tree = await githubApi(`/repos/${target.owner}/${target.repo}/git/trees/${sha}?recursive=1`, signal);

    const prefix = subPath ? `${subPath.replace(/\/$/, '')}/` : '';
    const entries = tree.tree.filter((e) => !prefix || e.path.startsWith(prefix) || `${e.path}/` === prefix);
    let roots = entries
      .filter((e) => e.type === 'blob' && (e.path === 'SKILL.md' || e.path.endsWith('/SKILL.md')))
      .map((e) => e.path.slice(0, -'SKILL.md'.length).replace(/\/$/, ''));
    if (!roots.length) {
      throw new Error(tree.truncated
        ? 'This repository is too large to list. Paste a link to the folder that contains the skill.'
        : 'No skills found here. A skill is a folder containing a SKILL.md file.');
    }
    const totalSkills = roots.length;
    roots = roots.slice(0, GH_LIMITS.skills);

    const results = [];
    for (let r = 0; r < roots.length; r++) {
      if (signal && signal.aborted) throw Object.assign(new Error('Scan cancelled'), { name: 'AbortError' });
      const root = roots[r];
      const rootPrefix = root ? `${root}/` : '';
      const nested = roots.filter((other) => other !== root && other.startsWith(rootPrefix));
      const own = entries.filter((e) => (!root || e.path.startsWith(rootPrefix))
        && !nested.some((n) => e.path.startsWith(`${n}/`)));
      const label = root.split('/').pop() || target.repo;
      onStatus(`Scanning ${label} (${r + 1} of ${roots.length})...`);

      const findings = [];
      const files = [];
      let skipped = 0;
      const add = (severity, rule, file, message) => findings.push({ severity, rule, file, line: 0, message });
      if (tree.truncated) add('unverified', 'tree-truncated', '.', 'The repository is too large to list every file');

      const blobs = [];
      let skippedDeps = 0;
      for (const e of own) {
        const rel = e.path.slice(rootPrefix.length);
        if (e.type === 'tree') continue;
        if (e.type === 'commit') {
          add('unverified', 'submodule', rel, "Links to another repository that wasn't checked or installed");
          continue;
        }
        if (/(^|\/)(node_modules|\.git|__pycache__)\//.test(rel)) {
          skippedDeps++;
          continue;
        }
        findings.push(...Scan.inspectPath(rel));
        if (e.mode === '120000') {
          add('unverified', 'symlink', rel, "A shortcut (symlink) that couldn't be followed; it is installed as a plain file");
        }
        blobs.push({ rel, path: e.path, size: e.size || 0 });
      }
      if (skippedDeps) {
        skipped += skippedDeps;
        add('unverified', 'vendored-directory', '.', "Bundled dependencies or caches weren't checked and won't be installed");
      }

      // SKILL.md first, so the file cap and size budget never cut it.
      blobs.sort((a, b) => (a.rel === 'SKILL.md' ? -1 : b.rel === 'SKILL.md' ? 1 : 0));
      if (blobs.length > GH_LIMITS.filesPerSkill) {
        skipped += blobs.length - GH_LIMITS.filesPerSkill;
        add('unverified', 'too-many-files', '.', `Has more than ${GH_LIMITS.filesPerSkill} files; the rest weren't checked and won't be installed`);
        blobs.length = GH_LIMITS.filesPerSkill;
      }

      let budget = GH_LIMITS.bytesPerSkill;
      const skillMdBlob = blobs.find((b) => b.rel === 'SKILL.md');
      await mapLimit(blobs, GH_LIMITS.parallel, async (blob) => {
        const decision = Scan.classifyFile(blob.rel, blob.size);
        if (decision.action === 'finding') {
          skipped++;
          findings.push({ ...decision.finding, message: `${decision.finding.message}; it won't be installed` });
          return;
        }
        if (budget - blob.size < 0) {
          skipped++;
          add('unverified', 'scan-budget', blob.rel, "Skipped because the skill is too large to check in one go; it won't be installed");
          return;
        }
        budget -= blob.size;
        let bytes;
        try {
          const res = await fetch(rawUrl(target, sha, blob.path), { signal });
          if (!res.ok) throw new Error(String(res.status));
          bytes = new Uint8Array(await res.arrayBuffer());
        } catch (err) {
          if (err && err.name === 'AbortError') throw err;
          skipped++;
          add('unverified', 'download-failed', blob.rel, "Couldn't download this file to check it, so it won't be installed");
          return;
        }
        files.push({ path: blob.rel, bytes });
        findings.push(...Scan.inspectFile(blob.rel, bytes));
      });

      const skillMd = files.find((f) => f.path === 'SKILL.md');
      const skillMdText = skillMd ? decoder.decode(skillMd.bytes) : null;
      const fallback = label.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
      const compat = Scan.checkClaudeCompat(skillMdText, fallback);
      if (skillMd) {
        for (const issue of compat.issues) {
          if (issue.target === 'code' && issue.level === 'error') add('invalid', 'claude-compat', 'SKILL.md', issue.message);
        }
      } else if (skillMdBlob) {
        // It exists but could not be fetched or checked: unknown, not invalid.
        add('unverified', 'skill-md-unavailable', 'SKILL.md', "SKILL.md couldn't be downloaded or checked");
      }
      const parsed = skillMdText !== null ? Scan.parseFrontmatter(skillMdText) : { body: '' };

      files.sort((a, b) => a.path.localeCompare(b.path));
      await applyAllowlist(compat.installDir, files, findings);
      results.push({
        id: `gh:${target.owner}/${target.repo}:${root || '.'}`,
        source: 'github',
        origin: `${target.owner}/${target.repo}`,
        commit: sha.slice(0, 7),
        url: `https://github.com/${target.owner}/${target.repo}/tree/${sha}/${root}`,
        name: compat.name,
        dir: compat.installDir,
        installDir: compat.installDir,
        description: compat.description,
        body: parsed.body,
        compat,
        files,
        skippedFiles: skipped,
        fp: Scan.skillFingerprint(skillMdText, files.map((f) => ({ path: f.path, size: f.bytes.length }))),
        findings,
        status: statusOf(findings),
      });
    }

    return { target, sha, skills: results, totalSkills, truncatedSkills: totalSkills > roots.length };
  }

  const STATUS_ORDER = { blocked: 0, invalid: 1, unverified: 2, warnings: 3, passed: 4 };

  function renderGitHubResults() {
    const wrap = $('github-results');
    wrap.textContent = '';
    const bundledNames = new Set(bundled.map((b) => b.installDir));
    ghFound
      .slice()
      .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.name.localeCompare(b.name))
      .forEach((s) => {
        const row = el('label', 'gh-row');
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.checked = !NOT_INSTALLABLE.has(s.status);
        box.disabled = NOT_INSTALLABLE.has(s.status);
        box.addEventListener('change', updateGitHubAdd);
        box.dataset.id = s.id;
        box.setAttribute('aria-label', `Add ${s.name}`);
        row.appendChild(box);

        const name = el('div', 'gh-row-name', s.name);
        name.appendChild(el('span', `pill ${STATUS[s.status].cls}`, STATUS[s.status].label));
        row.appendChild(name);
        row.appendChild(el('div', 'gh-row-desc', s.description || 'No description provided.'));
        if (s.status === 'blocked') row.appendChild(el('div', 'gh-row-note blocked', `Can't be installed: ${firstReason(s, 'block')}`));
        if (s.status === 'invalid') row.appendChild(el('div', 'gh-row-note blocked', `Can't be installed: ${firstReason(s, 'invalid')}`));
        if (s.status === 'unverified') row.appendChild(el('div', 'gh-row-note unverified', `Warning: couldn't be checked. ${firstReason(s, 'unverified')}`));
        if (s.status === 'warnings') row.appendChild(el('div', 'gh-row-note warn', `Note: ${firstReason(s, 'warn')}`));
        if (s.skippedFiles) row.appendChild(el('div', 'gh-row-note unverified', `${plural(s.skippedFiles, 'file')} won't be installed, so the skill may not work fully.`));
        if (bundledNames.has(s.installDir)) row.appendChild(el('div', 'gh-row-meta', `Same name as "${s.installDir}" in this library. Only one of them can be installed.`));
        wrap.appendChild(row);
      });
    updateGitHubAdd();
  }

  function ghChecked() {
    return [...$('github-results').querySelectorAll('input[type="checkbox"]:checked')].map((b) => b.dataset.id);
  }

  function updateGitHubAdd() {
    const n = ghChecked().length;
    $('github-add').disabled = n === 0;
    $('github-add').textContent = n ? `Add ${plural(n, 'skill')} to library` : 'Add to library';
  }

  function setGitHubStatus(text, kind) {
    const status = $('github-status');
    status.textContent = '';
    status.className = 'gh-status';
    if (kind === 'busy') status.appendChild(el('span', 'spinner'));
    if (kind === 'error') {
      status.className = 'gh-status notice danger';
      status.insertAdjacentHTML('beforeend', ICONS.warn);
    }
    status.appendChild(el('span', null, text));
  }

  async function runGitHubScan(event) {
    event.preventDefault();
    if (ghScan) ghScan.abort();
    const controller = new AbortController();
    ghScan = controller;
    const input = $('github-url').value;
    ghFound = [];
    renderGitHubResults();
    $('github-scan').disabled = true;
    try {
      $('github-watch').hidden = true;
      const { skills, totalSkills, truncatedSkills, sha } = await scanGitHub(input, (text) => setGitHubStatus(text, 'busy'), controller.signal);
      if (controller.signal.aborted) return;
      ghFound = skills;
      const counts = skills.reduce((acc, s) => Object.assign(acc, { [s.status]: (acc[s.status] || 0) + 1 }), {});
      const parts = [`Found ${plural(totalSkills, 'skill')}`];
      if (counts.blocked) parts.push(`${counts.blocked} blocked as unsafe`);
      if (counts.invalid) parts.push(`${counts.invalid} Claude can't load`);
      if (counts.unverified) parts.push(`${counts.unverified} couldn't be checked`);
      setGitHubStatus(parts.join(' · ') + (truncatedSkills ? `. Showing the first ${GH_LIMITS.skills}; paste a folder link for the others.` : '.'));
      renderGitHubResults();
      const target = parseGitHubUrl(input);
      const link = input.trim();
      lastScan = { link, label: `${target.owner}/${target.repo}${target.refParts ? `/${target.refParts.join('/')}` : ''}`, sha };
      const known = watched.find((w) => w.link === link);
      if (known) {
        known.sha = sha;
        known.changed = false;
        known.checkedAt = Date.now();
        saveWatched();
        renderWatchNotice();
      }
      $('github-watch').hidden = HOSTED;
      $('github-watch').textContent = known ? 'Watching' : 'Watch this repo';
      $('github-watch').disabled = Boolean(known);
      if (counts.unverified) showToast(`Heads up: ${plural(counts.unverified, 'skill')} couldn't be checked for safety.`, 4000);
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      setGitHubStatus(`Couldn't scan this link. ${err.message}`, 'error');
    } finally {
      if (ghScan === controller) {
        ghScan = null;
        $('github-scan').disabled = false;
      }
    }
  }

  /** Stop a running scan and reset the dialog when it closes. */
  function closeGitHub() {
    if (ghScan) {
      ghScan.abort();
      ghScan = null;
      setGitHubStatus('Scan cancelled.');
      $('github-scan').disabled = false;
    }
    if ($('github').open) $('github').close();
  }

  function addGitHubSkills() {
    const ids = new Set(ghChecked());
    const adding = ghFound.filter((s) => ids.has(s.id) && !NOT_INSTALLABLE.has(s.status));
    const replacing = new Set(adding.map((s) => s.id));
    // A new scan of the same repo and folder replaces the older copy.
    github.filter((s) => replacing.has(s.id)).forEach((s) => selected.delete(s.id));
    github = github.filter((s) => !replacing.has(s.id)).concat(adding);
    reindex();
    adding.forEach((s) => selected.add(s.id));
    saveGithub();
    closeGitHub();
    state.view = 'github';
    renderAll();
    const unverified = adding.filter((s) => s.status === 'unverified').length;
    showToast(unverified
      ? `Added ${plural(adding.length, 'skill')}. ${unverified} couldn't be checked for safety; install only if you trust the source.`
      : `Added ${plural(adding.length, 'skill')} and selected them. Click Install to add them to Claude.`, 5000);
  }

  function removeFromLibrary(skill) {
    github = github.filter((s) => s.id !== skill.id);
    selected.delete(skill.id);
    reindex();
    saveGithub();
    if (preview.open) preview.close();
    renderAll();
    showToast(`Removed ${skill.name} from the library. It is still installed in Claude if you installed it.`, 4000);
  }

  // ------------------------------------------------------------- rendering

  function visible() {
    const q = state.query.trim().toLowerCase();
    let pool;
    if (state.view === 'installed') pool = library().filter((s) => installState(s)).concat(local);
    else if (state.view === 'github') pool = github;
    else if (state.view === 'selected') pool = chosen();
    else pool = library();
    if (!q) return pool;
    if (q === 'original') return pool.filter((s) => s.original);
    return pool.filter((s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)
      || (s.original && ORIGINAL_LABEL.toLowerCase().includes(q)));
  }

  function selectable(skill) {
    return skill && skill.source !== 'local' && !NOT_INSTALLABLE.has(skill.status);
  }

  function toggle(id) {
    const skill = byId.get(id);
    if (!selectable(skill)) return;
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);
    if (state.view === 'selected') renderAll();
    else refreshSelection();
  }

  /** Cheap update after the selection changes: no card rebuild. */
  function refreshSelection() {
    lastInstall = null;
    keepFocus(() => {
      grid.querySelectorAll('.card-main[role="checkbox"]').forEach((m) => {
        m.setAttribute('aria-checked', String(selected.has(m.dataset.id)));
      });
      updateResultsBar(visible());
      renderNav();
      renderConnect();
      if (preview.open && previewId) syncPreviewButtons();
    });
  }

  function renderChips() {
    const wrap = $('chips');
    wrap.textContent = '';
    CHIPS.forEach((word) => {
      const chip = el('button', 'chip', word);
      chip.dataset.focusKey = `chip:${word}`;
      chip.setAttribute('aria-pressed', String(state.query.trim().toLowerCase() === word));
      chip.addEventListener('click', () => {
        state.query = state.query.trim().toLowerCase() === word ? '' : word;
        search.value = state.query;
        keepFocus(() => {
          renderGrid();
          renderChips();
        });
      });
      wrap.appendChild(chip);
    });
  }

  function installPill(skill) {
    const st = installState(skill);
    if (skill.source === 'local' && duplicateNames.has(skill.name)) return el('span', 'pill pill-unverified', 'Duplicate name: Claude sees two copies');
    if (st === 'installed') return el('span', 'pill pill-passed', skill.source === 'local' ? 'Installed (not in library)' : 'Installed in Claude');
    if (st === 'update') return el('span', 'pill pill-unverified', 'Update available');
    if (st === 'elsewhere') return el('span', 'pill pill-unverified', `Installed as "${otherCopies(skill)[0]}"`);
    return null;
  }

  function emptyState() {
    const empty = el('div', 'empty');
    const add = (title, text) => {
      empty.appendChild(el('h3', null, title));
      empty.appendChild(el('p', null, text));
    };
    if (state.query) add('No matching skills', 'Try a different word, or clear the search.');
    else if (state.view === 'github') add('No GitHub skills yet', 'Use "Add from GitHub" to scan a repository and add its skills.');
    else if (state.view === 'selected') add('Nothing selected yet', 'Pick skills from All skills and they will show up here.');
    else if (state.view === 'installed' && connection === 'unsupported') add('Not available in this browser', IS_IOS || HOSTED ? 'Seeing what is installed needs the Windows download of the app in Edge or Chrome.' : 'Open the app in Microsoft Edge or Google Chrome to connect to Claude Code.');
    else if (state.view === 'installed' && connection !== 'connected') {
      add('Not connected to Claude Code', 'Connect to your Claude skills folder (or a project folder) to see what is installed.');
      const btn = el('button', 'btn btn-primary', connection === 'needs-permission' ? 'Reconnect' : 'Connect');
      btn.dataset.focusKey = 'empty-connect';
      btn.addEventListener('click', () => connectFolder(false));
      empty.appendChild(btn);
    }
    else if (state.view === 'installed') add('No skills installed yet', 'Select skills and click Install to add them to Claude Code.');
    else add('No skills', 'Run node scripts/skill-connector-build.js to build the library.');
    return empty;
  }

  function updateResultsBar(shown) {
    const title = $('results-title');
    title.textContent = '';
    title.appendChild(el('strong', null, String(shown.length)));
    const scope = { selected: ' selected', github: ' from GitHub', installed: ' installed in Claude Code' }[state.view] || '';
    const q = state.query.trim();
    const matching = q === 'original' ? ` made for Prabh’s CSC` : q ? ` matching “${q}”` : '';
    title.appendChild(document.createTextNode(`${shown.length === 1 ? ' skill' : ' skills'}${scope}${matching}`));
    $('select-visible').disabled = !shown.some((s) => selectable(s) && !selected.has(s.id));
    $('clear').disabled = !selected.size;
  }

  const ACTION_LABEL = { install: 'Installed', update: 'Updated', remove: 'Removed', undo: 'Undid a change:' };

  function renderHistory() {
    grid.textContent = '';
    const title = $('results-title');
    title.textContent = '';
    const changes = history.filter((e) => e.action !== 'undo');
    title.appendChild(el('strong', null, String(changes.length)));
    title.appendChild(document.createTextNode(changes.length === 1 ? ' change' : ' changes'));
    if (!history.length) {
      const empty = el('div', 'empty');
      empty.appendChild(el('h3', null, 'No changes yet'));
      empty.appendChild(el('p', null, 'Installs, updates and removals show up here, and the latest one can be undone.'));
      grid.appendChild(empty);
      return;
    }
    const undoable = undoableBatch();
    const list = el('div', 'history-list');
    const batches = [...new Set(history.map((e) => e.batch))];
    for (const batch of batches) {
      const entries = history.filter((e) => e.batch === batch);
      const group = el('div', 'history-group');
      const head = el('div', 'history-head');
      head.appendChild(el('span', 'history-time', new Date(entries[0].time).toLocaleString()));
      head.appendChild(el('span', 'pill', entries[0].targetLabel || 'Claude Code'));
      if (entries.every((e) => e.undone)) head.appendChild(el('span', 'pill', 'Undone'));
      if (batch === undoable) {
        const undo = el('button', 'btn', 'Undo');
        undo.dataset.focusKey = `undo:${batch}`;
        undo.addEventListener('click', () => undoBatch(batch));
        head.appendChild(undo);
      }
      group.appendChild(head);
      const ul = el('ul', 'history-items');
      for (const e of entries) ul.appendChild(el('li', e.undone ? 'undone' : null, `${ACTION_LABEL[e.action] || e.action} ${e.skill}`));
      group.appendChild(ul);
      list.appendChild(group);
    }
    grid.appendChild(list);
  }

  function renderGrid() {
    const historyView = state.view === 'history';
    $('select-visible').hidden = historyView;
    $('clear').hidden = historyView;
    $('rescan').hidden = !(state.view === 'installed' && connection === 'connected' && installed.size);
    if (historyView) {
      renderHistory();
      return;
    }
    const shown = visible();
    grid.textContent = '';
    updateResultsBar(shown);

    if (!shown.length) {
      grid.appendChild(emptyState());
      return;
    }

    const frag = document.createDocumentFragment();
    shown.forEach((s, index) => {
      const canSelect = selectable(s);
      const card = el('div', 'card');
      if (NOT_INSTALLABLE.has(s.status)) card.classList.add('card-disabled');

      // The checkbox (or, for skills only installed in Claude, a preview button) is
      // its own element so the Preview button is not nested inside it.
      const main = el('div', 'card-main');
      const nameId = `card-name-${index}`;
      const descId = `card-desc-${index}`;
      main.tabIndex = 0;
      main.dataset.id = s.id;
      main.dataset.focusKey = `card:${s.id}`;
      main.setAttribute('role', canSelect ? 'checkbox' : 'button');
      if (canSelect) main.setAttribute('aria-checked', String(selected.has(s.id)));
      main.setAttribute('aria-labelledby', nameId);
      main.setAttribute('aria-describedby', descId);
      main.setAttribute('aria-keyshortcuts', 'p');
      if (canSelect) {
        const check = el('span', 'check');
        check.innerHTML = ICONS.check;
        check.setAttribute('aria-hidden', 'true');
        main.appendChild(check);
      }
      const name = el('div', 'card-name', s.name);
      name.id = nameId;
      main.appendChild(name);
      const pills = el('div', 'pills');
      if (s.original) pills.appendChild(el('span', 'pill pill-original', ORIGINAL_LABEL));
      if (s.source === 'custom') pills.appendChild(el('span', 'pill pill-original', 'Made by you'));
      if (s.source === 'github') {
        pills.appendChild(el('span', 'pill', `${s.origin}@${s.commit || ''}`));
        pills.appendChild(el('span', `pill ${STATUS[s.status].cls}`, STATUS[s.status].label));
      }
      const ip = installPill(s);
      if (ip) pills.appendChild(ip);
      const checked = state.view === 'installed' && rescan.get(s.installDir);
      if (checked) pills.appendChild(el('span', `pill ${STATUS[checked.status].cls}`, `Re-scan: ${STATUS[checked.status].label}`));
      if (pills.childNodes.length) main.appendChild(pills);
      const desc = el('div', 'card-desc', s.description || 'No description provided.');
      desc.id = descId;
      main.appendChild(desc);
      card.appendChild(main);

      const foot = el('div', 'card-foot');
      const view = withIcon(el('button', 'btn btn-ghost'), ICONS.eye, 'Preview');
      view.tabIndex = -1; // keyboard users press P on the card; keeps one Tab stop per card
      view.dataset.focusKey = `preview:${s.id}`;
      view.setAttribute('aria-label', `Preview ${s.name}`);
      view.addEventListener('click', (e) => {
        e.stopPropagation();
        openPreview(s.id);
      });
      foot.appendChild(view);
      card.appendChild(foot);

      card.addEventListener('click', () => (canSelect ? toggle(s.id) : openPreview(s.id)));
      main.addEventListener('keydown', (e) => {
        if (e.altKey || e.ctrlKey || e.metaKey) return;
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          if (canSelect) toggle(s.id);
          else openPreview(s.id);
        } else if (e.key === 'p' || e.key === 'P') {
          e.preventDefault();
          openPreview(s.id);
        }
      });
      frag.appendChild(card);
    });
    grid.appendChild(frag);
  }

  function shellQuote(value) {
    return `'${value.replace(/'/g, "'\\''")}'`;
  }

  // The terminal commands copy from this repository's skills/ folder, so they only make sense there.
  const IN_REPO = /\/apps\/skill-connector\/index\.html$/.test(decodeURIComponent(location.pathname));

  function terminalCommands(picks) {
    const localPicks = picks.filter((s) => s.source === 'bundled');
    const lines = ['mkdir -p ~/.claude/skills'];
    for (const s of localPicks) {
      // Replace the whole folder so old files go and "cp -r" never nests a copy inside it.
      lines.push(`rm -rf ~/.claude/skills/${shellQuote(s.installDir)} && cp -r skills/${shellQuote(s.dir)} ~/.claude/skills/${shellQuote(s.installDir)}`);
    }
    if (localPicks.length < picks.length) lines.push('# Skills from GitHub: use Install or a .zip download above');
    return lines.join('\n');
  }

  function buildOutput(picks) {
    if (state.mode === 'claudemd') {
      return `# Skills\n\nThese skills are installed in Claude Code. Use them when a task matches:\n\n${picks.map((s) => `- **${s.name}**: ${s.description}`).join('\n')}\n`;
    }
    return picks.map((s) => `## Skill: ${s.name}\n\n${s.body}`).join('\n\n---\n\n');
  }

  const DISPLAY_LIMIT = 20000;

  function codeBlock(label, text) {
    const code = el('div', 'code');
    const head = el('div', 'code-head');
    head.appendChild(el('span', null, label));
    const copy = withIcon(el('button', 'btn btn-ghost'), ICONS.copy, 'Copy');
    copy.addEventListener('click', () => copyText(text));
    head.appendChild(copy);
    code.appendChild(head);
    const pre = el('pre', null, text.length > DISPLAY_LIMIT ? text.slice(0, DISPLAY_LIMIT) : text);
    pre.tabIndex = 0;
    code.appendChild(pre);
    if (text.length > DISPLAY_LIMIT) {
      code.appendChild(el('div', 'code-note', `Showing the first ${DISPLAY_LIMIT.toLocaleString()} of ${text.length.toLocaleString()} characters. Copy copies everything.`));
    }
    return code;
  }

  function notice(kind, icon, nodes) {
    const box = el('div', `notice ${kind}`);
    box.innerHTML = icon;
    const body = el('div');
    (Array.isArray(nodes) ? nodes : [nodes]).forEach((n) => body.appendChild(typeof n === 'string' ? el('div', null, n) : n));
    box.appendChild(body);
    return box;
  }

  function steps(items) {
    const ol = el('ol', 'steps');
    items.forEach((t) => ol.appendChild(el('li', null, t)));
    return ol;
  }

  function renderInstallResult() {
    if (!lastInstall) return;
    const lines = [lastInstall.count
      ? `Installed and verified ${plural(lastInstall.count, 'skill')} in "${lastInstall.folder}". Claude Code picks them up automatically, even in sessions that are already open.`
      : 'Nothing was installed.'];
    if (lastInstall.wasEmpty) lines.push('These are your first skills, so run /reload-skills once in any Claude Code session that is already open.');
    lines.push('To confirm, type /skills in Claude Code.');
    (lastInstall.notes || []).forEach((n) => lines.push(`Note: ${n}`));
    lastInstall.failed.forEach((f) => lines.push(`Not installed: ${f}`));
    const result = notice(lastInstall.failed.length ? 'danger' : 'ok', lastInstall.failed.length ? ICONS.warn : ICONS.ok, lines);
    result.id = 'install-result';
    if (lastInstall.batch && undoableBatch() === lastInstall.batch) {
      const undo = el('button', 'link-btn', 'Undo this install');
      undo.id = 'undo-last';
      undo.dataset.focusKey = 'undo-last';
      undo.addEventListener('click', () => undoBatch(lastInstall.batch));
      result.lastChild.appendChild(undo);
    }
    connectBody.appendChild(result);
  }

  function renderInstall(picks) {
    renderInstallResult();

    const unverified = picks.filter((s) => s.status === 'unverified');
    if (unverified.length) {
      connectBody.appendChild(notice('', ICONS.warn,
        `${plural(unverified.length, 'selected skill')} couldn't be checked for safety. You'll be asked to confirm before installing.`));
    }

    const actions = el('div', 'install-actions');
    if (SUPPORTS_FOLDER_WRITE) {
      const states = picks.map((s) => installState(s));
      let verb = 'Install';
      if (states.every((st) => st === 'installed')) verb = 'Reinstall';
      else if (states.every((st) => st === 'installed' || st === 'update')) verb = 'Update';
      const install = withIcon(el('button', 'btn btn-primary'), ICONS.install, `${verb} ${plural(picks.length, 'skill')} in Claude Code`);
      install.id = 'install-now';
      install.addEventListener('click', () => installSelected(false));
      actions.appendChild(install);
    }
    const row = el('div', 'install-row');
    const app = withIcon(el('button', `btn${SUPPORTS_FOLDER_WRITE ? '' : ' btn-primary'}`), ICONS.zip, 'Claude app (.zip)');
    app.id = 'download-app';
    app.title = 'One zip per skill, ready to upload to the Claude desktop or web app';
    app.addEventListener('click', downloadAppZips);
    const code = withIcon(el('button', 'btn'), ICONS.zip, 'Claude Code (.zip)');
    code.id = 'download-zip';
    code.title = `All selected skills in one zip, to unzip into ${SKILLS_PATH}`;
    code.addEventListener('click', downloadCodeZip);
    row.appendChild(app);
    row.appendChild(code);
    actions.appendChild(row);
    connectBody.appendChild(actions);

    const target = el('div', 'target-line');
    if (connection === 'connected' && currentTarget()) {
      const t = currentTarget();
      target.appendChild(document.createTextNode('Installs into'));
      target.appendChild(el('code', null, t.kind === 'project' ? `${t.handle.name}/.claude/skills` : t.label));
      const change = el('button', 'link-btn', 'Change');
      change.addEventListener('click', () => {
        const select = document.getElementById('target-select');
        if (select) select.focus();
        else connectFolder(true);
      });
      target.appendChild(change);
    } else if (SUPPORTS_FOLDER_WRITE) {
      target.appendChild(document.createTextNode(`First time? You'll pick your ${SKILLS_PATH} folder once.`));
    } else {
      target.appendChild(document.createTextNode(IS_IOS || HOSTED
        ? `${IS_IOS ? 'On iPhone and iPad' : 'In this web version'}, the app cannot write into folders. Use "Claude app (.zip)" and upload the zip in Claude (Customize > Skills), or use the Windows download for one-click install.`
        : `One-click install needs Microsoft Edge or Google Chrome. Here, use "Claude Code (.zip)" and unzip it into ${SKILLS_PATH}.`));
    }
    connectBody.appendChild(target);

    const appHelp = el('details', 'more');
    appHelp.open = state.open.app;
    appHelp.addEventListener('toggle', () => { state.open.app = appHelp.open; });
    appHelp.appendChild(el('summary', null, 'Using the Claude desktop or web app?'));
    const appBody = el('div', 'more-body');
    appBody.appendChild(steps([
      'Click "Claude app (.zip)". You get one zip per skill.',
      'In Claude, open Settings > Capabilities and turn on code execution (file creation).',
      'Go to Customize > Skills, click +, then "Upload a skill", and choose a zip.',
    ]));
    appBody.appendChild(el('p', 'more-note', 'Descriptions longer than 200 characters are shortened automatically, because the Claude app rejects them. Names containing "claude" or "anthropic" may be refused by the Claude app.'));
    appHelp.appendChild(appBody);
    connectBody.appendChild(appHelp);

    if (IN_REPO) {
      const more = el('details', 'more');
      more.open = state.open.terminal;
      more.addEventListener('toggle', () => { state.open.terminal = more.open; });
      more.appendChild(el('summary', null, 'Install from a terminal instead'));
      more.appendChild(codeBlock('Run in the repository folder (macOS, Linux or Git Bash)', terminalCommands(picks)));
      connectBody.appendChild(more);
    }
  }

  function renderConnect() {
    const picks = chosen();
    connectBody.textContent = '';

    if (!picks.length) {
      if (state.mode === 'install') renderInstallResult();
      const ph = el('div', 'placeholder');
      ph.innerHTML = ICONS.spark;
      ph.appendChild(el('div', null, 'Select one or more skills to install them or generate the setup.'));
      connectBody.appendChild(ph);
      return;
    }

    const selWrap = el('div');
    selWrap.appendChild(el('p', 'section-label', `${picks.length} selected`));
    const list = el('div', 'selected-list');
    const TAG_LIMIT = 12;
    const shownTags = state.showAllTags ? picks : picks.slice(0, TAG_LIMIT);
    shownTags.forEach((s) => {
      const tag = el('span', 'tag');
      tag.appendChild(el('span', null, s.name));
      const rm = el('button');
      rm.innerHTML = ICONS.x;
      rm.setAttribute('aria-label', `Remove ${s.name} from selection`);
      rm.dataset.focusKey = `tag:${s.id}`;
      rm.addEventListener('click', () => toggle(s.id));
      tag.appendChild(rm);
      list.appendChild(tag);
    });
    if (picks.length > TAG_LIMIT) {
      const more = el('button', 'link-btn', state.showAllTags ? 'Show fewer' : `+${picks.length - TAG_LIMIT} more`);
      more.dataset.focusKey = 'tags-more';
      more.addEventListener('click', () => {
        state.showAllTags = !state.showAllTags;
        keepFocus(renderConnect);
      });
      list.appendChild(more);
    }
    selWrap.appendChild(list);
    connectBody.appendChild(selWrap);

    if (state.mode === 'install') {
      renderInstall(picks);
      return;
    }

    const unchecked = picks.filter((s) => s.status === 'unverified').length;
    if (unchecked) connectBody.appendChild(notice('', ICONS.warn, `${plural(unchecked, 'selected skill')} couldn't be checked for safety. Only use ${unchecked === 1 ? 'it' : 'them'} if you trust the source.`));
    const stepsWrap = el('div');
    stepsWrap.appendChild(el('p', 'section-label', 'How to use'));
    stepsWrap.appendChild(steps({
      claudemd: ['Install the skills first (Install tab); this block only helps Claude pick them.', 'Open or create CLAUDE.md in your project root and paste the block below.', 'Claude Code reads it at the start of every session.'],
      api: ['Copy the text below.', 'Pass it as the system parameter in your Claude API request.'],
    }[state.mode]));
    connectBody.appendChild(stepsWrap);
    connectBody.appendChild(codeBlock(state.mode === 'claudemd' ? 'CLAUDE.md' : 'System prompt', buildOutput(picks)));
  }

  function copyText(text) {
    const ok = () => showToast('Copied to clipboard');
    const fail = () => showToast('Copy failed. Select the text and copy it manually.');
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, fail);
    else fail();
  }

  function renderStatus() {
    const box = $('claude-status');
    box.textContent = '';
    box.className = `claude-status ${connection}`;
    const line = el('div', 'claude-status-line');
    line.appendChild(el('span', 'status-dot'));
    const t = currentTarget();
    const text = {
      connected: `${t ? (t.kind === 'project' ? t.handle.name : 'Claude Code') : 'Claude Code'} connected · ${plural(installed.size, 'skill')}`,
      'needs-permission': `${t && t.kind === 'project' ? t.handle.name : 'Claude Code'}: allow access again`,
      disconnected: 'Claude Code not connected',
      unsupported: IS_IOS || HOSTED ? 'Use "Claude app (.zip)" to add skills' : 'Open in Edge or Chrome to install directly',
    }[connection];
    line.appendChild(el('span', null, text));
    box.appendChild(line);

    if (SUPPORTS_FOLDER_WRITE && targets.length) {
      const select = document.createElement('select');
      select.id = 'target-select';
      select.className = 'target-select';
      select.dataset.focusKey = 'target-select';
      select.setAttribute('aria-label', 'Install skills into');
      for (const tg of targets) {
        const opt = document.createElement('option');
        opt.value = tg.id;
        opt.textContent = tg.label;
        opt.selected = tg.id === currentTargetId;
        select.appendChild(opt);
      }
      const add = document.createElement('option');
      add.value = '__add-project';
      add.textContent = '+ Add a project folder...';
      select.appendChild(add);
      if (!targets.some((tg) => tg.kind === 'personal')) {
        const personal = document.createElement('option');
        personal.value = '__add-personal';
        personal.textContent = '+ Connect personal skills folder...';
        select.appendChild(personal);
      }
      select.addEventListener('change', () => {
        const value = select.value;
        select.value = currentTargetId;
        if (value === '__add-project') addProjectTarget();
        else if (value === '__add-personal') connectFolder(true);
        else switchTarget(value);
      });
      box.appendChild(select);
    }

    const updates = connection === 'connected' ? updatable().length : 0;
    if (updates) {
      const btn = el('button', 'btn btn-primary claude-connect', `Update all (${updates})`);
      btn.id = 'update-all';
      btn.dataset.focusKey = 'update-all';
      btn.addEventListener('click', () => installSkills(updatable(), false));
      box.appendChild(btn);
    }
    if (connection === 'disconnected' || connection === 'needs-permission') {
      const btn = el('button', 'btn claude-connect', connection === 'disconnected' ? 'Connect' : 'Reconnect');
      btn.id = 'connect-claude';
      btn.dataset.focusKey = 'connect-claude';
      btn.addEventListener('click', () => connectFolder(false));
      box.appendChild(btn);
    }
  }

  function updateJump() {
    const jump = $('jump-install');
    jump.hidden = !selected.size || jump.dataset.panelVisible === 'true';
    jump.textContent = `${plural(selected.size, 'skill')} selected · Install`;
  }

  function renderNav() {
    $('count-all').textContent = String(library().length);
    $('count-selected').textContent = String(selected.size);
    $('count-github').textContent = String(github.length);
    $('count-installed').textContent = connection === 'connected' ? String(installed.size) : '-';
    $('count-history').textContent = String(history.filter((e) => e.action !== 'undo').length);
    document.querySelectorAll('.nav-item[data-view]').forEach((item) => {
      item.setAttribute('aria-current', String(item.getAttribute('data-view') === state.view));
    });
    $('eyebrow').textContent = { selected: 'Your selection', github: 'Added from GitHub', installed: `Installed in ${(currentTarget() || {}).label || 'Claude Code'}`, history: 'Install history' }[state.view] || 'Skills library';
    renderStatus();
    updateJump();
  }

  function renderAll() {
    keepFocus(() => {
      renderNav();
      renderGrid();
      renderConnect();
      if (preview.open && previewId) syncPreviewButtons();
    });
  }

  function appIssues(skill) {
    if (skill.compat) return skill.compat.issues.filter((i) => i.level !== 'info');
    const issues = [];
    if (skill.description && skill.description.length > APP_DESCRIPTION_LIMIT) {
      issues.push({ target: 'app', level: 'warn', message: `Description is ${skill.description.length} characters; shortened to 200 in the Claude app download` });
    }
    return issues;
  }

  /** An example request for a skill: the curated one, or one built from its description. */
  function tryPromptFor(s) {
    if (s.tryPrompt) return s.tryPrompt;
    const when = (s.description || '').match(/\buse (?:this skill )?when(?: the user)?(?: asks? (?:to|for|about))?\s+([^.]+)/i);
    if (when) return `Help me ${when[1].trim().replace(/^(?:you |they |users? )/i, '')}.`;
    const first = (s.description || '').split(/(?<=\.)\s/)[0].replace(/\.$/, '');
    return first ? `Can you help me with this: ${first.charAt(0).toLowerCase()}${first.slice(1)}?` : `Use the ${s.name} skill to help me with my current task.`;
  }

  function openPreview(id) {
    const s = byId.get(id);
    if (!s) return;
    previewId = id;
    $('preview-title').textContent = s.name;
    const origin = { github: ` (from ${s.origin}, commit ${s.commit || '?'})`, local: ' (installed in Claude Code, not part of this library)' }[s.source] || '';
    $('preview-desc').textContent = `${s.description || 'No description provided.'}${origin}`;
    const findings = $('preview-findings');
    findings.textContent = '';
    const head = el('li', 'findings-head');
    if (s.original) head.appendChild(el('span', 'pill pill-original', ORIGINAL_LABEL));
    if (s.source === 'github') head.appendChild(el('span', `pill ${STATUS[s.status].cls}`, STATUS[s.status].label));
    const ip = installPill(s);
    if (ip) head.appendChild(ip);
    head.appendChild(el('span', 'pill', `Folder: ${s.installDir}`));
    findings.appendChild(head);
    const rescanned = rescan.get(s.installDir);
    const shownFindings = (s.findings || []).concat(rescanned && installState(s) ? rescanned.findings.map((f) => ({ ...f, message: `Installed copy: ${f.message}` })) : []);
    shownFindings.forEach((f) => {
      const li = el('li');
      const sev = { block: 'Unsafe', invalid: "Claude can't load", unverified: "Couldn't check", warn: 'Note', allowed: 'Reviewed, safe' }[f.severity] || f.severity;
      li.appendChild(el('strong', null, sev));
      li.appendChild(el('span', null, f.message));
      li.appendChild(el('code', null, f.file + (f.line ? `:${f.line}` : '')));
      findings.appendChild(li);
    });
    appIssues(s).forEach((i) => {
      const li = el('li');
      li.appendChild(el('strong', null, i.target === 'app' ? 'Claude app' : 'Claude Code'));
      li.appendChild(el('span', null, i.message));
      findings.appendChild(li);
    });
    $('preview-try-text').textContent = tryPromptFor(s);
    $('preview-body').textContent = s.body || 'SKILL.md could not be read.';
    syncPreviewButtons();
    if (!preview.open) {
      preview.showModal();
      preview.querySelector('.dialog-body').scrollTop = 0;
    }
  }

  function syncPreviewButtons() {
    const s = byId.get(previewId);
    const toggleBtn = $('preview-toggle');
    toggleBtn.hidden = !selectable(s);
    toggleBtn.textContent = selected.has(previewId) ? 'Deselect' : 'Select';
    const st = s && installState(s);
    $('preview-remove').hidden = !(st && st !== 'elsewhere' && SUPPORTS_FOLDER_WRITE);
    $('preview-remove-library').hidden = !(s && s.source === 'github');
    $('preview-edit').hidden = !(s && s.source === 'custom');
    $('preview-delete').hidden = !(s && s.source === 'custom');
  }

  // ------------------------------------------------------------------ theme

  function storedTheme() {
    try {
      return localStorage.getItem('skill-connector-theme');
    } catch {
      return null;
    }
  }
  function currentTheme() {
    const attr = document.documentElement.getAttribute('data-theme');
    if (attr) return attr;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    $('theme-label').textContent = theme === 'dark' ? 'Light mode' : 'Dark mode';
  }
  const saved = storedTheme();
  if (saved === 'light' || saved === 'dark') applyTheme(saved);
  else $('theme-label').textContent = currentTheme() === 'dark' ? 'Light mode' : 'Dark mode';

  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (!document.documentElement.getAttribute('data-theme')) {
        $('theme-label').textContent = currentTheme() === 'dark' ? 'Light mode' : 'Dark mode';
      }
    });
  }

  $('theme-toggle').addEventListener('click', () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    try {
      localStorage.setItem('skill-connector-theme', next);
    } catch {
      /* storage unavailable */
    }
  });

  // ----------------------------------------------------------------- events

  let searchTimer = null;
  search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.query = search.value;
      renderGrid();
      renderChips();
    }, 80);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && document.activeElement !== search && !document.querySelector('dialog[open]')
      && !/^(INPUT|TEXTAREA)$/.test(document.activeElement && document.activeElement.tagName)) {
      e.preventDefault();
      search.focus();
    }
  });

  document.querySelectorAll('.nav-item[data-view]').forEach((item) => {
    item.addEventListener('click', () => {
      state.view = item.getAttribute('data-view');
      renderAll();
    });
  });

  const tabs = [...document.querySelectorAll('.segmented [role="tab"]')];
  function selectTab(tab, focus) {
    state.mode = tab.getAttribute('data-mode');
    tabs.forEach((t) => {
      t.setAttribute('aria-selected', String(t === tab));
      t.tabIndex = t === tab ? 0 : -1;
    });
    connectBody.setAttribute('aria-labelledby', tab.id);
    if (focus) tab.focus();
    renderConnect();
  }
  tabs.forEach((tab, i) => {
    tab.tabIndex = tab.getAttribute('aria-selected') === 'true' ? 0 : -1;
    tab.addEventListener('click', () => selectTab(tab, false));
    tab.addEventListener('keydown', (e) => {
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (step) {
        e.preventDefault();
        selectTab(tabs[(i + step + tabs.length) % tabs.length], true);
      } else if (e.key === 'Home' || e.key === 'End') {
        e.preventDefault();
        selectTab(tabs[e.key === 'Home' ? 0 : tabs.length - 1], true);
      }
    });
  });

  $('select-visible').addEventListener('click', () => {
    visible().forEach((s) => {
      if (selectable(s)) selected.add(s.id);
    });
    if (state.view === 'selected') renderAll();
    else refreshSelection();
  });

  $('rescan').addEventListener('click', rescanInstalled);

  $('clear').addEventListener('click', () => {
    selected.clear();
    if (state.view === 'selected') renderAll();
    else refreshSelection();
  });

  $('preview-close').addEventListener('click', () => preview.close());
  $('preview-try-copy').addEventListener('click', () => copyText($('preview-try-text').textContent));
  $('preview-dismiss').addEventListener('click', () => preview.close());
  $('preview-toggle').addEventListener('click', () => toggle(previewId));
  $('preview-remove').addEventListener('click', () => {
    const s = byId.get(previewId);
    if (s) removeInstalled(s);
  });
  $('preview-remove-library').addEventListener('click', () => {
    const s = byId.get(previewId);
    if (s) removeFromLibrary(s);
  });
  // Close on a click that starts and ends on the backdrop (not a text-selection drag).
  let pressedOnBackdrop = false;
  preview.addEventListener('mousedown', (e) => { pressedOnBackdrop = e.target === preview; });
  preview.addEventListener('click', (e) => {
    if (e.target === preview && pressedOnBackdrop) preview.close();
  });
  preview.addEventListener('close', () => {
    const opener = document.querySelector(`[data-focus-key="${CSS.escape(`card:${previewId}`)}"]`);
    if (opener) opener.focus({ preventScroll: true });
  });

  $('open-github').addEventListener('click', () => {
    renderWatched();
    $('github').showModal();
    $('github-url').focus();
  });
  $('github-form').addEventListener('submit', runGitHubScan);
  $('github-watch').addEventListener('click', () => {
    if (!lastScan) return;
    watchLink(lastScan.link, lastScan.label, lastScan.sha);
    $('github-watch').textContent = 'Watching';
    $('github-watch').disabled = true;
    showToast(`Watching ${lastScan.label}. The app checks it for changes when it opens.`, 4000);
  });
  $('open-maker').addEventListener('click', () => openMaker(null));
  ['maker-name', 'maker-description', 'maker-body'].forEach((id) => $(id).addEventListener('input', updateMaker));
  $('maker-form').addEventListener('submit', (e) => {
    e.preventDefault();
    saveMaker();
  });
  $('maker-cancel').addEventListener('click', () => $('maker').close());
  $('maker-close').addEventListener('click', () => $('maker').close());
  $('preview-edit').addEventListener('click', () => {
    const s = byId.get(previewId);
    if (s) openMaker(s);
  });
  $('preview-delete').addEventListener('click', () => {
    const s = byId.get(previewId);
    if (s) deleteCustom(s);
  });
  $('github-add').addEventListener('click', addGitHubSkills);
  $('github-close').addEventListener('click', closeGitHub);
  $('github-cancel').addEventListener('click', closeGitHub);
  $('github').addEventListener('close', () => {
    if (ghScan) closeGitHub();
  });
  let ghPressedOnBackdrop = false;
  $('github').addEventListener('mousedown', (e) => { ghPressedOnBackdrop = e.target === $('github'); });
  $('github').addEventListener('click', (e) => {
    if (e.target === $('github') && ghPressedOnBackdrop) closeGitHub();
  });

  // Stay in sync when the user comes back from Claude Code or the file explorer.
  let lastRefresh = 0;
  window.addEventListener('focus', async () => {
    if (Date.now() - lastRefresh < 2000 || document.querySelector('dialog[open]')) return;
    lastRefresh = Date.now();
    const before = `${connection}|${[...installed.entries()].map(([k, v]) => `${k}:${v.fingerprint}`).join(',')}`;
    await refreshInstalled();
    const after = `${connection}|${[...installed.entries()].map(([k, v]) => `${k}:${v.fingerprint}`).join(',')}`;
    if (before !== after) renderAll();
  });

  // Small screens: the Install panel sits below the list, so offer a jump to it.
  const jump = $('jump-install');
  jump.addEventListener('click', () => {
    $('connect-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    const firstAction = document.getElementById('install-now') || document.getElementById('download-app');
    if (firstAction) setTimeout(() => firstAction.focus({ preventScroll: true }), 350);
  });
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((entries) => {
      jump.dataset.panelVisible = String(entries[0].isIntersecting);
      updateJump();
    }).observe($('connect-panel'));
  }

  if (!bundled.length) {
    $('results-title').textContent = 'No skills data found. Run: node scripts/skill-connector-build.js';
  }

  if (HOSTED) {
    // GitHub is unreachable from the hosted frame; the desktop download has the importer.
    $('open-github').hidden = true;
    document.querySelector('.nav-item[data-view="github"]').hidden = true;
    window.claude.use('downloads').then((downloads) => {
      hostedDownloads = downloads;
      renderAll();
    }).catch(() => {});
  }

  reindex();
  renderChips();
  renderAll();
  Promise.all([SUPPORTS_FOLDER_WRITE ? loadTargets() : null, idbGet('history')]).then(([, savedHistory]) => {
    if (Array.isArray(savedHistory)) history = savedHistory;
    return refreshInstalled();
  }).then(renderAll);
  loadCustom().then((saved) => {
    if (!Array.isArray(saved) || !saved.length) return;
    custom = saved.filter((s) => s && s.source === 'custom');
    reindex();
    renderAll();
  });
  if (!HOSTED) {
    idbGet('watched-repos').then((saved) => {
      if (Array.isArray(saved)) watched = saved;
      renderWatchNotice();
      return checkWatched(false);
    });
    loadGithub().then((saved) => {
      if (!Array.isArray(saved) || !saved.length) return;
      github = saved.filter((s) => s && s.source === 'github' && !NOT_INSTALLABLE.has(s.status));
      reindex();
      renderAll();
    });
  }

  // Exposed for automated checks (scripts/skill-connector-check.js).
  window.SkillConnector = { scanGitHub, parseGitHubUrl, statusOf, prepareForClaudeApp, refreshInstalled, addProjectTarget, switchTarget, checkWatched };
})();
