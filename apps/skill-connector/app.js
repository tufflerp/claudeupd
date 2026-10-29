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
    return bundled.concat(github);
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

  /** Comparable form of a SKILL.md (frontmatter fields that matter + body). */
  function fingerprint(name, description, body) {
    return [name, description, (body || '').replace(/\r\n/g, '\n').trim()].join('\u0000');
  }

  function libraryFingerprint(skill) {
    return fingerprint(skill.name, skill.description, skill.body);
  }

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
    dialog.showModal();
    return new Promise((resolve) => {
      const done = (value) => {
        ok.onclick = null;
        $('confirm-cancel').onclick = null;
        dialog.onclose = null;
        if (dialog.open) dialog.close();
        resolve(value);
      };
      ok.onclick = () => done(true);
      $('confirm-cancel').onclick = () => done(false);
      dialog.onclose = () => done(false);
    });
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
    if (skill.source === 'github') {
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
        extras.push(`  ${block.key}: ${JSON.stringify(value)}`);
      }
    }
    if (extras.length) metadata = (metadata || ['metadata:']).concat(extras);
    if (metadata) kept.push(...metadata);

    const head = [`name: ${installDir}`, `description: ${JSON.stringify(description)}`].concat(kept).join('\n');
    const body = match ? normalized.slice(match[0].length) : normalized;
    return { text: `---\n${head}\n---\n${body}`, shortened, movedToMetadata: extras.length };
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
  const getSavedFolder = () => idb('readonly', (store) => store.get('skills-dir')).catch(() => null);
  const saveFolder = (handle) => idb('readwrite', (store) => store.put(handle, 'skills-dir')).catch(() => null);

  /** 'unsupported' | 'disconnected' | 'needs-permission' | 'connected' */
  let connection = SUPPORTS_FOLDER_WRITE ? 'disconnected' : 'unsupported';
  let sessionFolder = null; // kept even if the browser cannot persist the handle
  let installed = new Map(); // installDir -> { name, description, body, fingerprint }
  let lastInstall = null;

  async function pickSkillsFolder() {
    const ok = await confirmDialog(
      'Connect to Claude Code',
      [
        'In the next window, open your user folder, then .claude, then skills. Create the skills folder if it is not there yet.',
        'On Windows this is C:\\Users\\<your name>\\.claude\\skills. You only need to do this once.',
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
    await saveFolder(handle);
    sessionFolder = handle;
    connection = 'connected';
    return handle;
  }

  /** Get a writable skills folder, prompting only when needed (must run from a click). */
  async function getSkillsFolder(forcePick) {
    if (!forcePick) {
      const saved = sessionFolder || (await getSavedFolder());
      if (saved) {
        let permission = await saved.queryPermission({ mode: 'readwrite' });
        if (permission !== 'granted') permission = await saved.requestPermission({ mode: 'readwrite' });
        if (permission === 'granted') {
          sessionFolder = saved;
          connection = 'connected';
          return saved;
        }
      }
    }
    return pickSkillsFolder();
  }

  async function readSkillMd(dirHandle) {
    try {
      const file = await (await dirHandle.getFileHandle('SKILL.md')).getFile();
      return await file.text();
    } catch {
      return null;
    }
  }

  /** Re-read what is installed in Claude Code's skills folder (no prompts). */
  async function refreshInstalled() {
    if (!SUPPORTS_FOLDER_WRITE) return;
    let folder = sessionFolder;
    if (!folder) {
      const saved = await getSavedFolder();
      if (!saved) {
        connection = 'disconnected';
        return;
      }
      if ((await saved.queryPermission({ mode: 'readwrite' })) !== 'granted') {
        connection = 'needs-permission';
        return;
      }
      folder = sessionFolder = saved;
    }
    connection = 'connected';
    const next = new Map();
    try {
      for await (const [name, handle] of folder.entries()) {
        if (handle.kind !== 'directory') continue;
        const text = await readSkillMd(handle);
        if (text === null) continue;
        const parsed = Scan.parseFrontmatter(text);
        const skillName = parsed.attributes.name || name;
        const description = parsed.attributes.description || '';
        next.set(name, { name: skillName, description, body: parsed.body, fingerprint: fingerprint(skillName, description, parsed.body) });
      }
    } catch {
      connection = 'needs-permission';
      return;
    }
    installed = next;
    const known = new Set(library().map((s) => s.installDir));
    local = [...installed.entries()]
      .filter(([dir]) => !known.has(dir))
      .map(([dir, info]) => ({ id: `local:${dir}`, source: 'local', dir, installDir: dir, name: info.name, description: info.description || 'No description provided.', body: info.body }));
    reindex();
  }

  /** 'installed' | 'update' | null for a library skill. */
  function installState(skill) {
    const info = installed.get(skill.installDir);
    if (!info) return null;
    if (skill.source === 'local') return 'installed';
    return info.fingerprint === libraryFingerprint(skill) ? 'installed' : 'update';
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

  async function installSelected(forcePick) {
    const picks = chosen();
    if (!picks.length) return;
    try {
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
            ? 'This skill is already in Claude Code. It will be replaced with the version from this library.'
            : `These ${existing.length} skills are already in Claude Code. They will be replaced with the versions from this library.`],
          'Update',
          existing
        );
        if (!replace) return;
      }

      const failed = [];
      let done = 0;
      for (const s of picks) {
        showToast(`Installing ${s.name} (${done + 1} of ${picks.length})...`, 60000);
        const files = await getFiles(s);
        if (await folderExists(folder, s.installDir)) await folder.removeEntry(s.installDir, { recursive: true });
        await writeSkill(folder, s.installDir, files);
        const problem = await verifyInstalled(folder, s);
        if (problem) failed.push(`${s.name}: ${problem}`);
        done++;
      }

      lastInstall = { count: done - failed.length, failed, wasEmpty, folder: folder.name };
      await refreshInstalled();
      renderAll();
      showToast(failed.length
        ? `Installed ${done - failed.length} of ${done}. ${plural(failed.length, 'skill')} failed the check.`
        : `Installed and verified ${plural(done, 'skill')} in Claude Code.`, 5000);
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      showToast(`Install failed: ${err.message}`, 6000);
    }
  }

  async function removeInstalled(skill) {
    const ok = await confirmDialog(
      `Remove ${skill.name} from Claude?`,
      [`This deletes the "${skill.installDir}" folder from your Claude Code skills folder. Claude stops using it straight away.`],
      'Remove',
      null,
      true
    );
    if (!ok) return;
    try {
      const folder = await getSkillsFolder(false);
      if (!folder) return;
      await folder.removeEntry(skill.installDir, { recursive: true });
      await refreshInstalled();
      if (skill.source === 'local' && preview.open) preview.close();
      renderAll();
      showToast(`Removed ${skill.name} from Claude Code.`, 3000);
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      showToast(`Remove failed: ${err.message}`, 6000);
    }
  }

  async function connectFolder(forcePick) {
    try {
      const folder = await getSkillsFolder(forcePick);
      if (!folder) return;
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

  /** One zip with every selected skill folder, for unzipping into .claude\skills. */
  async function downloadCodeZip() {
    const picks = chosen();
    if (!picks.length) return;
    try {
      if (!(await confirmUnverified(picks))) return;
      const entries = [];
      for (const s of picks) {
        for (const f of await getFiles(s)) {
          if (!safeRelativePath(f.path)) throw new Error(`Unsafe file path in ${s.installDir}: ${f.path}`);
          entries.push({ path: `${s.installDir}/${f.path}`, data: f.bytes });
        }
      }
      await saveBlob(Zip.createZip(entries), picks.length === 1 ? `${picks[0].installDir}.zip` : 'claude-code-skills.zip');
      showToast('Downloaded. Unzip it into your .claude\\skills folder.', 4000);
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      showToast(`Download failed: ${err.message}`, 6000);
    }
  }

  /** One zip per skill, shaped the way the Claude desktop/web app expects. */
  async function downloadAppZips() {
    const picks = chosen();
    if (!picks.length) return;
    try {
      if (!(await confirmUnverified(picks))) return;
      let shortened = 0;
      for (let i = 0; i < picks.length; i++) {
        const s = picks[i];
        const entries = [];
        for (const f of await getFiles(s)) {
          if (!safeRelativePath(f.path)) throw new Error(`Unsafe file path in ${s.installDir}: ${f.path}`);
          let data = f.bytes;
          if (f.path === 'SKILL.md') {
            const prepared = prepareForClaudeApp(decoder.decode(f.bytes), s.installDir);
            if (prepared.shortened) shortened++;
            data = encoder.encode(prepared.text);
          }
          entries.push({ path: `${s.installDir}/${f.path}`, data });
        }
        await saveBlob(Zip.createZip(entries), `${s.installDir}.zip`);
        if (i < picks.length - 1 && !HOSTED) await new Promise((r) => setTimeout(r, 400));
      }
      showToast(`Downloaded ${plural(picks.length, 'zip')} for the Claude app${shortened ? ` (${shortened} description${shortened === 1 ? '' : 's'} shortened to fit)` : ''}. Upload them in Customize > Skills.`, 6000);
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      showToast(`Download failed: ${err.message}`, 6000);
    }
  }

  // ------------------------------------------------------------ GitHub scan

  const GH_LIMITS = { skills: 30, filesPerSkill: 300, bytesPerScan: 25 * 1024 * 1024, parallel: 6 };
  let ghFound = [];

  function parseGitHubUrl(input) {
    let text = input.trim().replace(/\.git$/, '');
    if (!text) throw new Error('Paste a GitHub link first.');
    if (/^[\w.-]+\/[\w.-]+$/.test(text)) text = `https://github.com/${text}`;
    let url;
    try {
      url = new URL(/^https?:\/\//.test(text) ? text : `https://${text}`);
    } catch {
      throw new Error("That doesn't look like a link.");
    }
    if (url.hostname !== 'github.com' && url.hostname !== 'www.github.com') {
      throw new Error('Only github.com links are supported.');
    }
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    if (parts.length < 2 || !/^[\w.-]+$/.test(parts[0]) || !/^[\w.-]+$/.test(parts[1])) {
      throw new Error('Use a link like https://github.com/owner/repo.');
    }
    const result = { owner: parts[0], repo: parts[1].replace(/\.git$/, ''), ref: null, path: '' };
    if ((parts[2] === 'tree' || parts[2] === 'blob') && parts[3]) {
      result.ref = parts[3];
      let sub = parts.slice(4).join('/');
      if (parts[2] === 'blob') sub = sub.split('/').slice(0, -1).join('/'); // a file link scans its folder
      result.path = sub;
    }
    return result;
  }

  async function githubApi(path) {
    let res;
    try {
      res = await fetch(`https://api.github.com${path}`, { headers: { Accept: 'application/vnd.github+json' } });
    } catch {
      throw new Error("Couldn't reach GitHub. Check your internet connection and try again.");
    }
    if (res.status === 404) throw new Error('Repository, branch or folder not found. Private repositories are not supported.');
    if (res.status === 403 || res.status === 429) {
      const reset = Number(res.headers.get('x-ratelimit-reset'));
      const when = reset ? ` Try again after ${new Date(reset * 1000).toLocaleTimeString()}.` : ' Try again later.';
      throw new Error(`GitHub's limit for lookups without signing in was reached.${when}`);
    }
    if (!res.ok) throw new Error(`GitHub returned an error (${res.status}).`);
    return res.json();
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
  async function scanGitHub(input, onStatus) {
    const target = parseGitHubUrl(input);
    onStatus(`Looking up ${target.owner}/${target.repo}...`);
    if (!target.ref) target.ref = (await githubApi(`/repos/${target.owner}/${target.repo}`)).default_branch;
    const commit = await githubApi(`/repos/${target.owner}/${target.repo}/commits/${encodeURIComponent(target.ref)}`);
    const sha = commit.sha;
    const tree = await githubApi(`/repos/${target.owner}/${target.repo}/git/trees/${sha}?recursive=1`);

    const prefix = target.path ? `${target.path.replace(/\/$/, '')}/` : '';
    const entries = tree.tree.filter((e) => !prefix || e.path.startsWith(prefix) || `${e.path}/` === prefix);
    let roots = entries
      .filter((e) => e.type === 'blob' && (e.path === 'SKILL.md' || e.path.endsWith('/SKILL.md')))
      .map((e) => e.path.slice(0, -'SKILL.md'.length).replace(/\/$/, ''));
    if (!roots.length) {
      throw new Error(tree.truncated
        ? 'This repository is too large to list. Paste a link to the folder that contains the skill.'
        : 'No skills found here. A skill is a folder containing a SKILL.md file.');
    }
    const truncatedSkills = roots.length > GH_LIMITS.skills;
    roots = roots.slice(0, GH_LIMITS.skills);

    let budget = GH_LIMITS.bytesPerScan;
    const results = [];
    for (let r = 0; r < roots.length; r++) {
      const root = roots[r];
      const rootPrefix = root ? `${root}/` : '';
      const nested = roots.filter((other) => other !== root && other.startsWith(rootPrefix));
      const own = entries.filter((e) => (!root || e.path.startsWith(rootPrefix))
        && !nested.some((n) => e.path.startsWith(`${n}/`)));
      const label = root.split('/').pop() || target.repo;
      onStatus(`Scanning ${label} (${r + 1} of ${roots.length})...`);

      const findings = [];
      const files = [];
      const add = (severity, rule, file, message) => findings.push({ severity, rule, file, line: 0, message });
      if (tree.truncated) add('unverified', 'tree-truncated', '.', 'The repository is too large to list every file');

      const blobs = [];
      let skippedDeps = false;
      for (const e of own) {
        const rel = e.path.slice(rootPrefix.length);
        if (e.type === 'tree') continue;
        if (e.type === 'commit') {
          add('unverified', 'submodule', rel, "Links to another repository that wasn't checked or installed");
          continue;
        }
        if (/(^|\/)(node_modules|\.git|__pycache__)\//.test(rel)) {
          skippedDeps = true;
          continue;
        }
        if (e.mode === '120000') {
          add('unverified', 'symlink', rel, "A shortcut (symlink) that couldn't be followed; it is installed as a plain file");
        }
        blobs.push({ rel, path: e.path, size: e.size || 0 });
      }
      if (skippedDeps) add('unverified', 'vendored-directory', '.', "Bundled dependencies or caches weren't checked and won't be installed");

      if (blobs.length > GH_LIMITS.filesPerSkill) {
        add('unverified', 'too-many-files', '.', `Has more than ${GH_LIMITS.filesPerSkill} files; the rest weren't checked or installed`);
        blobs.length = GH_LIMITS.filesPerSkill;
      }

      await mapLimit(blobs, GH_LIMITS.parallel, async (blob) => {
        const decision = Scan.classifyFile(blob.rel, blob.size);
        if (decision.action === 'finding') {
          findings.push(decision.finding);
          return;
        }
        if (budget - blob.size < 0) {
          add('unverified', 'scan-budget', blob.rel, "Skipped because the repository is too large to check in one go; it won't be installed");
          return;
        }
        budget -= blob.size;
        let bytes;
        try {
          const res = await fetch(rawUrl(target, sha, blob.path));
          if (!res.ok) throw new Error(String(res.status));
          bytes = new Uint8Array(await res.arrayBuffer());
        } catch {
          add('unverified', 'download-failed', blob.rel, "Couldn't download this file to check it, so it won't be installed");
          return;
        }
        files.push({ path: blob.rel, bytes });
        findings.push(...Scan.inspectFile(blob.rel, bytes));
      });

      const skillMd = files.find((f) => f.path === 'SKILL.md');
      const compat = Scan.checkClaudeCompat(skillMd ? decoder.decode(skillMd.bytes) : null, label.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, ''));
      for (const issue of compat.issues) {
        if (issue.target === 'code' && issue.level === 'error') add('invalid', 'claude-compat', 'SKILL.md', issue.message);
      }
      const parsed = skillMd ? Scan.parseFrontmatter(decoder.decode(skillMd.bytes)) : { body: '' };

      files.sort((a, b) => a.path.localeCompare(b.path));
      await applyAllowlist(compat.installDir, files, findings);
      results.push({
        id: `gh:${target.owner}/${target.repo}@${sha.slice(0, 7)}:${root || '.'}`,
        source: 'github',
        origin: `${target.owner}/${target.repo}`,
        url: `https://github.com/${target.owner}/${target.repo}/tree/${sha}/${root}`,
        name: compat.name,
        dir: compat.installDir,
        installDir: compat.installDir,
        description: compat.description || 'No description provided.',
        body: parsed.body,
        compat,
        files,
        findings,
        status: statusOf(findings),
      });
    }

    return { target, skills: results, truncatedSkills };
  }

  function renderGitHubResults() {
    const wrap = $('github-results');
    wrap.textContent = '';
    ghFound.forEach((s) => {
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
      row.appendChild(el('div', 'gh-row-desc', s.description));
      if (s.status === 'blocked') row.appendChild(el('div', 'gh-row-note blocked', `Can't be installed: ${firstReason(s, 'block')}`));
      if (s.status === 'invalid') row.appendChild(el('div', 'gh-row-note blocked', `Can't be installed: ${firstReason(s, 'invalid')}`));
      if (s.status === 'unverified') row.appendChild(el('div', 'gh-row-note unverified', `Warning: couldn't be checked. ${firstReason(s, 'unverified')}`));
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
    const input = $('github-url').value;
    ghFound = [];
    renderGitHubResults();
    $('github-scan').disabled = true;
    try {
      const { skills, truncatedSkills } = await scanGitHub(input, (text) => setGitHubStatus(text, 'busy'));
      ghFound = skills;
      const counts = skills.reduce((acc, s) => Object.assign(acc, { [s.status]: (acc[s.status] || 0) + 1 }), {});
      const parts = [`Found ${plural(skills.length, 'skill')}`];
      if (counts.blocked) parts.push(`${counts.blocked} blocked as unsafe`);
      if (counts.invalid) parts.push(`${counts.invalid} Claude can't load`);
      if (counts.unverified) parts.push(`${counts.unverified} couldn't be checked`);
      setGitHubStatus(parts.join(' · ') + (truncatedSkills ? `. Showing the first ${GH_LIMITS.skills}; paste a folder link for others.` : '.'));
      renderGitHubResults();
      if (counts.unverified) showToast(`Heads up: ${plural(counts.unverified, 'skill')} couldn't be checked for safety.`, 4000);
    } catch (err) {
      setGitHubStatus(`Couldn't scan this link. ${err.message}`, 'error');
    } finally {
      $('github-scan').disabled = false;
    }
  }

  function addGitHubSkills() {
    const ids = new Set(ghChecked());
    const adding = ghFound.filter((s) => ids.has(s.id) && !NOT_INSTALLABLE.has(s.status));
    github = github.filter((s) => !ids.has(s.id)).concat(adding);
    reindex();
    adding.forEach((s) => selected.add(s.id));
    $('github').close();
    state.view = 'github';
    renderAll();
    const unverified = adding.filter((s) => s.status === 'unverified').length;
    showToast(unverified
      ? `Added ${plural(adding.length, 'skill')}. ${unverified} couldn't be checked for safety; install only if you trust the source.`
      : `Added ${plural(adding.length, 'skill')} and selected them. Click Install to add them to Claude.`, 5000);
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
    if (st === 'installed') return el('span', 'pill pill-passed', skill.source === 'local' ? 'Installed (not in library)' : 'Installed in Claude');
    if (st === 'update') return el('span', 'pill pill-unverified', 'Update available');
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
      add('Not connected to Claude Code', 'Connect to your Claude skills folder to see what is installed.');
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

  function renderGrid() {
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
      if (s.source === 'github') {
        pills.appendChild(el('span', 'pill', s.origin));
        pills.appendChild(el('span', `pill ${STATUS[s.status].cls}`, STATUS[s.status].label));
      }
      const ip = installPill(s);
      if (ip) pills.appendChild(ip);
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

  function terminalCommands(picks) {
    const localPicks = picks.filter((s) => s.source === 'bundled');
    const lines = ['mkdir -p ~/.claude/skills'].concat(localPicks.map((s) => (s.dir === s.installDir
      ? `cp -r skills/${shellQuote(s.dir)} ~/.claude/skills/`
      : `cp -r skills/${shellQuote(s.dir)} ~/.claude/skills/${shellQuote(s.installDir)}`)));
    if (localPicks.length < picks.length) lines.push('# Skills from GitHub: use Install or a .zip download above');
    return lines.join('\n');
  }

  function buildOutput(picks) {
    if (state.mode === 'claudemd') {
      return `# Skills\n\nUse these skills when the task matches:\n\n${picks.map((s) => `- **${s.name}**: ${s.description}`).join('\n')}\n`;
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
    const lines = [`Installed and verified ${plural(lastInstall.count, 'skill')} in "${lastInstall.folder}". Claude Code picks them up automatically, even in sessions that are already open.`];
    if (lastInstall.wasEmpty) lines.push('These are your first skills, so run /reload-skills once in any Claude Code session that is already open.');
    lines.push('To confirm, type /skills in Claude Code.');
    lastInstall.failed.forEach((f) => lines.push(`Problem: ${f}`));
    const result = notice(lastInstall.failed.length ? 'danger' : 'ok', lastInstall.failed.length ? ICONS.warn : ICONS.ok, lines);
    result.id = 'install-result';
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
      const updates = picks.filter((s) => installState(s)).length;
      const verb = updates === picks.length ? 'Update' : 'Install';
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
    code.title = 'All selected skills in one zip, to unzip into .claude\\skills';
    code.addEventListener('click', downloadCodeZip);
    row.appendChild(app);
    row.appendChild(code);
    actions.appendChild(row);
    connectBody.appendChild(actions);

    const target = el('div', 'target-line');
    if (connection === 'connected' && sessionFolder) {
      target.appendChild(document.createTextNode('Installs into'));
      target.appendChild(el('code', null, sessionFolder.name));
      const change = el('button', 'link-btn', 'Change folder');
      change.addEventListener('click', () => connectFolder(true));
      target.appendChild(change);
    } else if (SUPPORTS_FOLDER_WRITE) {
      target.appendChild(document.createTextNode("First time? You'll pick your .claude\\skills folder once."));
    } else {
      target.appendChild(document.createTextNode(IS_IOS || HOSTED
        ? `${IS_IOS ? 'On iPhone and iPad' : 'In this web version'}, the app cannot write into folders. Use "Claude app (.zip)" and upload the zip in Claude (Customize > Skills), or use the Windows download for one-click install.`
        : 'One-click install needs Microsoft Edge or Google Chrome. Here, use "Claude Code (.zip)" and unzip it into .claude\\skills.'));
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
    appBody.appendChild(el('p', 'more-note', 'Descriptions longer than 200 characters are shortened automatically, because the Claude app rejects them.'));
    appHelp.appendChild(appBody);
    connectBody.appendChild(appHelp);

    const more = el('details', 'more');
    more.open = state.open.terminal;
    more.addEventListener('toggle', () => { state.open.terminal = more.open; });
    more.appendChild(el('summary', null, 'Install from a terminal instead'));
    more.appendChild(codeBlock('Run from the repository folder', terminalCommands(picks)));
    connectBody.appendChild(more);
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

    const stepsWrap = el('div');
    stepsWrap.appendChild(el('p', 'section-label', 'How to use'));
    stepsWrap.appendChild(steps({
      claudemd: ['Open or create CLAUDE.md in your project root.', 'Paste the block below.', 'Claude Code reads it at the start of every session.'],
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
    const text = {
      connected: `Claude Code connected · ${plural(installed.size, 'skill')}`,
      'needs-permission': 'Claude Code: allow access again',
      disconnected: 'Claude Code not connected',
      unsupported: IS_IOS || HOSTED ? 'Use "Claude app (.zip)" to add skills' : 'Open in Edge or Chrome to install directly',
    }[connection];
    line.appendChild(el('span', null, text));
    box.appendChild(line);
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
    document.querySelectorAll('.nav-item[data-view]').forEach((item) => {
      item.setAttribute('aria-current', String(item.getAttribute('data-view') === state.view));
    });
    $('eyebrow').textContent = { selected: 'Your selection', github: 'Added from GitHub', installed: 'Installed in Claude Code' }[state.view] || 'Skills library';
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

  function openPreview(id) {
    const s = byId.get(id);
    if (!s) return;
    previewId = id;
    $('preview-title').textContent = s.name;
    const origin = { github: ` (from ${s.origin})`, local: ' (installed in Claude Code, not part of this library)' }[s.source] || '';
    $('preview-desc').textContent = `${s.description}${origin}`;
    const findings = $('preview-findings');
    findings.textContent = '';
    const head = el('li', 'findings-head');
    if (s.original) head.appendChild(el('span', 'pill pill-original', ORIGINAL_LABEL));
    if (s.source === 'github') head.appendChild(el('span', `pill ${STATUS[s.status].cls}`, STATUS[s.status].label));
    const ip = installPill(s);
    if (ip) head.appendChild(ip);
    head.appendChild(el('span', 'pill', `Folder: ${s.installDir}`));
    findings.appendChild(head);
    (s.findings || []).forEach((f) => {
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
    $('preview-body').textContent = s.body || 'SKILL.md could not be read.';
    syncPreviewButtons();
    preview.showModal();
    preview.querySelector('.dialog-body').scrollTop = 0;
  }

  function syncPreviewButtons() {
    const s = byId.get(previewId);
    const toggleBtn = $('preview-toggle');
    toggleBtn.hidden = !selectable(s);
    toggleBtn.textContent = selected.has(previewId) ? 'Deselect' : 'Select';
    $('preview-remove').hidden = !(s && installState(s) && SUPPORTS_FOLDER_WRITE);
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

  $('clear').addEventListener('click', () => {
    selected.clear();
    if (state.view === 'selected') renderAll();
    else refreshSelection();
  });

  $('preview-close').addEventListener('click', () => preview.close());
  $('preview-dismiss').addEventListener('click', () => preview.close());
  $('preview-toggle').addEventListener('click', () => toggle(previewId));
  $('preview-remove').addEventListener('click', () => {
    const s = byId.get(previewId);
    if (s) removeInstalled(s);
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
    $('github').showModal();
    $('github-url').focus();
  });
  $('github-form').addEventListener('submit', runGitHubScan);
  $('github-add').addEventListener('click', addGitHubSkills);
  $('github-close').addEventListener('click', () => $('github').close());
  $('github-cancel').addEventListener('click', () => $('github').close());

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
  refreshInstalled().then(renderAll);

  // Exposed for automated checks (scripts/skill-connector-check.js).
  window.SkillConnector = { scanGitHub, parseGitHubUrl, statusOf, prepareForClaudeApp, refreshInstalled };
})();
