/* Prabh's CSC (Claude Skill Connector) - browser app logic.
 *
 * Data comes from data/skills-data.js (window.SKILLS). Full skill files are
 * loaded on demand from data/skill-files/<dir>.js (window.SKILL_FILES).
 * Safety rules come from data/scan-core.js (window.SkillScanCore), shared with
 * the repository's CI scanner. ZIP downloads use data/zip-store.js.
 */
(function () {
  'use strict';

  const Scan = window.SkillScanCore;
  const ALLOWLIST = window.SKILL_SCAN_ALLOWLIST || [];
  const Zip = window.ZipStore;

  const bundled = (window.SKILLS || []).map((s) => Object.assign({}, s, { id: s.dir, source: 'bundled' }));
  let github = [];
  let byId = new Map();
  const selected = new Set();
  const state = { view: 'all', mode: 'install', query: '' };

  const $ = (id) => document.getElementById(id);
  const grid = $('grid');
  const search = $('search');
  const connectBody = $('connect-body');
  const preview = $('preview');
  const toast = $('toast');
  let previewId = null;

  const CHIPS = ['roblox', 'game', 'animation', 'testing', 'security', 'react', 'python', 'api', 'agent', 'docs'];
  const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;
  const SUPPORTS_FOLDER_WRITE = typeof window.showDirectoryPicker === 'function';

  const STATUS = {
    passed: { label: 'Passed safety scan', cls: 'pill-passed' },
    warnings: { label: 'Passed with notes', cls: 'pill-warnings' },
    unverified: { label: "Couldn't fully check", cls: 'pill-unverified' },
    blocked: { label: 'Blocked', cls: 'pill-blocked' },
  };

  const ICONS = {
    check: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg>',
    x: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    copy: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
    eye: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    spark: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"/></svg>',
    install: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12m0 0-4-4m4 4 4-4M5 21h14"/></svg>',
    zip: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M10 12h2m-2 3h2m-2 3h2"/></svg>',
    warn: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4m0 4h.01"/></svg>',
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

  function all() {
    return bundled.concat(github);
  }

  function reindex() {
    byId = new Map(all().map((s) => [s.id, s]));
  }

  function chosen() {
    return all().filter((s) => selected.has(s.id));
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
      if (f.severity !== 'block') continue;
      const entry = ALLOWLIST.find((e) => e.skill === dir && e.file === f.file && e.rule === f.rule);
      const file = entry && files.find((x) => x.path === f.file);
      if (file && (await sha256Hex(file.bytes)) === entry.sha256) f.severity = 'allowed';
    }
  }

  function firstReason(skill, severity) {
    const f = (skill.findings || []).find((x) => x.severity === severity);
    return f ? `${f.message}${f.file && f.file !== '.' ? ` (${f.file})` : ''}` : '';
  }

  /** Minimal SKILL.md frontmatter parser (mirrors scripts/lib/skill-index.js). */
  function parseFrontmatter(text) {
    const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
    const match = normalized.match(/^---\n([\s\S]*?)\n---\n?/);
    if (!match) return { attributes: {}, body: normalized.trim() };
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
      attributes[pair[1]] = value.replace(/^(['"])(.*)\1$/, '$2');
    }
    return { attributes, body: normalized.slice(match[0].length).trim() };
  }

  // ------------------------------------------------------------ confirm UI

  function confirmDialog(title, paragraphs, okLabel, items) {
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
    $('confirm-ok').textContent = okLabel;
    dialog.showModal();
    return new Promise((resolve) => {
      const done = (value) => {
        $('confirm-ok').onclick = null;
        $('confirm-cancel').onclick = null;
        dialog.onclose = null;
        if (dialog.open) dialog.close();
        resolve(value);
      };
      $('confirm-ok').onclick = () => done(true);
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

  /** Every file of a skill as [{ path, bytes }]. */
  async function getFiles(skill) {
    if (skill.source === 'github') return skill.files;
    window.SKILL_FILES = window.SKILL_FILES || {};
    if (!window.SKILL_FILES[skill.dir]) {
      await loadScript(`data/skill-files/${encodeURIComponent(skill.dir)}.js`).catch(() => {
        throw new Error(`The files for "${skill.name}" are missing. Re-download the app, or run node scripts/skill-connector-build.js.`);
      });
    }
    const encoder = new TextEncoder();
    return window.SKILL_FILES[skill.dir].map((f) => ({
      path: f.path,
      bytes: typeof f.text === 'string' ? encoder.encode(f.text) : base64ToBytes(f.base64),
    }));
  }

  function safeRelativePath(p) {
    const parts = p.split('/');
    return parts.length > 0 && parts.every((part) => part && part !== '.' && part !== '..' && !/[\\:*?"<>|]/.test(part));
  }

  // ------------------------------------------------- remembered skills folder

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
  let folderName = null;
  let sessionFolder = null; // kept even if the browser cannot persist the handle

  async function pickSkillsFolder() {
    const ok = await confirmDialog(
      'Choose your Claude skills folder',
      [
        'In the next window, open your user folder, then .claude, then skills. Create the skills folder if it is not there yet.',
        'On Windows this is usually C:\\Users\\<your name>\\.claude\\skills. You only need to do this once.',
      ],
      'Choose folder'
    );
    if (!ok) return null;
    const handle = await window.showDirectoryPicker({ id: 'claude-skills', mode: 'readwrite' });
    if (handle.name !== 'skills') {
      const keep = await confirmDialog(
        'Use this folder?',
        [`This folder is called "${handle.name}". Claude Code reads skills from a folder called "skills" inside .claude. Use "${handle.name}" anyway?`],
        'Use it anyway'
      );
      if (!keep) return null;
    }
    await saveFolder(handle);
    folderName = handle.name;
    sessionFolder = handle;
    return handle;
  }

  async function getSkillsFolder(forcePick) {
    if (!forcePick) {
      const saved = sessionFolder || (await getSavedFolder());
      if (saved) {
        let permission = await saved.queryPermission({ mode: 'readwrite' });
        if (permission !== 'granted') permission = await saved.requestPermission({ mode: 'readwrite' });
        if (permission === 'granted') {
          folderName = saved.name;
          sessionFolder = saved;
          return saved;
        }
      }
    }
    return pickSkillsFolder();
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

  // ------------------------------------------------------- install / download

  async function confirmUnverified(picks) {
    const risky = picks.filter((s) => s.status === 'unverified');
    if (!risky.length) return true;
    return confirmDialog(
      `${plural(risky.length, 'skill')} couldn't be fully checked`,
      ['The safety scan could not inspect everything in these skills, so it cannot say they are safe. Only continue if you trust where they came from.'],
      'Continue anyway',
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

      const existing = [];
      for (const s of picks) if (await folderExists(folder, s.dir)) existing.push(s.dir);
      if (existing.length) {
        const replace = await confirmDialog(
          'Replace existing skills?',
          [`${plural(existing.length, 'skill')} already installed will be updated with this version.`],
          'Replace',
          existing
        );
        if (!replace) return;
      }

      let done = 0;
      for (const s of picks) {
        showToast(`Installing ${s.name} (${done + 1} of ${picks.length})...`, 60000);
        await writeSkill(folder, s.dir, await getFiles(s));
        done++;
      }
      showToast(`Installed ${plural(done, 'skill')}. Start a new Claude Code session to use them.`, 5000);
      renderConnect();
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      showToast(`Install failed: ${err.message}`, 6000);
    }
  }

  async function downloadZip() {
    const picks = chosen();
    if (!picks.length) return;
    try {
      if (!(await confirmUnverified(picks))) return;
      const entries = [];
      for (const s of picks) {
        for (const f of await getFiles(s)) {
          if (!safeRelativePath(f.path)) throw new Error(`Unsafe file path in ${s.dir}: ${f.path}`);
          entries.push({ path: `${s.dir}/${f.path}`, data: f.bytes });
        }
      }
      const blob = new Blob([Zip.createZip(entries)], { type: 'application/zip' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = picks.length === 1 ? `${picks[0].dir}.zip` : 'claude-skills.zip';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(link.href), 10000);
      showToast('Downloaded. Unzip it into your .claude\\skills folder.', 4000);
    } catch (err) {
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
    const result = { owner: parts[0], repo: parts[1], ref: null, path: '' };
    if ((parts[2] === 'tree' || parts[2] === 'blob') && parts[3]) {
      result.ref = parts[3];
      let sub = parts.slice(4).join('/');
      if (parts[2] === 'blob') sub = sub.split('/').slice(0, -1).join('/'); // a file link scans its folder
      result.path = sub;
    }
    return result;
  }

  async function githubApi(path) {
    const res = await fetch(`https://api.github.com${path}`, { headers: { Accept: 'application/vnd.github+json' } });
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
   * Returns skill records with `status` and `findings`; files are kept in
   * memory so the exact scanned bytes are what gets installed.
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
      if (tree.truncated) add('unverified', 'tree-truncated', '.', 'Repository too large to list every file');

      const blobs = [];
      for (const e of own) {
        const rel = e.path.slice(rootPrefix.length);
        if (e.type === 'tree') {
          if (/(^|\/)(node_modules|\.git)$/.test(rel)) add('block', 'vendored-directory', rel, 'Bundled node_modules or .git directory');
          continue;
        }
        if (e.type === 'commit') {
          add('unverified', 'submodule', rel, 'Links to another repository that was not scanned');
          continue;
        }
        if (e.mode === '120000') {
          add('block', 'symlink', rel, 'Symbolic link could point outside the skill folder');
          continue;
        }
        if (/(^|\/)(__pycache__|node_modules)\//.test(rel)) {
          add('block', 'vendored-directory', rel, 'Bundled caches or dependencies');
          continue;
        }
        blobs.push({ rel, path: e.path, size: e.size || 0 });
      }

      if (blobs.length > GH_LIMITS.filesPerSkill) {
        add('unverified', 'too-many-files', '.', `More than ${GH_LIMITS.filesPerSkill} files; only the first ${GH_LIMITS.filesPerSkill} were checked`);
        blobs.length = GH_LIMITS.filesPerSkill;
      }

      await mapLimit(blobs, GH_LIMITS.parallel, async (blob) => {
        const decision = Scan.classifyFile(blob.rel, blob.size);
        if (decision.action === 'finding' && decision.finding.severity === 'block') {
          findings.push(decision.finding);
          return;
        }
        if (budget - blob.size < 0) {
          add('unverified', 'scan-budget', blob.rel, 'Skipped: the repository is too large to scan in one go');
          return;
        }
        budget -= blob.size;
        let bytes;
        try {
          const res = await fetch(rawUrl(target, sha, blob.path));
          if (!res.ok) throw new Error(String(res.status));
          bytes = new Uint8Array(await res.arrayBuffer());
        } catch {
          add('unverified', 'download-failed', blob.rel, 'Could not download this file to check it');
          return;
        }
        if (Scan.hasBinaryMagic(bytes)) {
          add('block', 'executable-binary', blob.rel, 'File contents are a native executable');
          return;
        }
        files.push({ path: blob.rel, bytes });
        if (decision.action === 'skip') return;
        if (decision.action === 'finding') {
          // Unknown file types cannot be judged by the text rules.
          add('unverified', decision.finding.rule, blob.rel, "Couldn't inspect this type of file");
          return;
        }
        findings.push(...Scan.scanText(blob.rel, new TextDecoder('utf-8').decode(bytes)));
      });

      const skillMd = files.find((f) => f.path === 'SKILL.md');
      const meta = skillMd ? parseFrontmatter(new TextDecoder('utf-8').decode(skillMd.bytes)) : { attributes: {}, body: '' };
      const fallback = label.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
      const name = meta.attributes.name || fallback;
      const dir = NAME_RE.test(name) ? name : fallback;
      if (!NAME_RE.test(dir)) add('block', 'invalid-name', 'SKILL.md', 'Skill name is not a valid folder name');
      if (!skillMd) add('unverified', 'missing-skill-md', 'SKILL.md', 'SKILL.md could not be read');

      files.sort((a, b) => a.path.localeCompare(b.path));
      await applyAllowlist(dir, files, findings);
      results.push({
        id: `gh:${target.owner}/${target.repo}@${sha.slice(0, 7)}:${root || '.'}`,
        source: 'github',
        origin: `${target.owner}/${target.repo}`,
        url: `https://github.com/${target.owner}/${target.repo}/tree/${sha}/${root}`,
        name,
        dir,
        description: meta.attributes.description || 'No description provided.',
        body: meta.body,
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
      box.checked = s.status !== 'blocked';
      box.disabled = s.status === 'blocked';
      box.addEventListener('change', updateGitHubAdd);
      box.dataset.id = s.id;
      row.appendChild(box);

      const name = el('div', 'gh-row-name', s.name);
      const pill = el('span', `pill ${STATUS[s.status].cls}`, STATUS[s.status].label);
      name.appendChild(pill);
      row.appendChild(name);
      row.appendChild(el('div', 'gh-row-desc', s.description));
      if (s.status === 'blocked') row.appendChild(el('div', 'gh-row-note blocked', `Can't be installed: ${firstReason(s, 'block')}`));
      if (s.status === 'unverified') row.appendChild(el('div', 'gh-row-note unverified', `Warning: ${firstReason(s, 'unverified')}`));
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

  function setGitHubStatus(text, busy) {
    const status = $('github-status');
    status.textContent = '';
    if (busy) status.appendChild(el('span', 'spinner'));
    status.appendChild(el('span', null, text));
  }

  async function runGitHubScan(event) {
    event.preventDefault();
    const input = $('github-url').value;
    ghFound = [];
    renderGitHubResults();
    $('github-scan').disabled = true;
    try {
      const { skills, truncatedSkills } = await scanGitHub(input, (text) => setGitHubStatus(text, true));
      ghFound = skills;
      const counts = skills.reduce((acc, s) => Object.assign(acc, { [s.status]: (acc[s.status] || 0) + 1 }), {});
      const parts = [`Found ${plural(skills.length, 'skill')}`];
      if (counts.blocked) parts.push(`${counts.blocked} blocked`);
      if (counts.unverified) parts.push(`${counts.unverified} couldn't be fully checked`);
      setGitHubStatus(parts.join(' · ') + (truncatedSkills ? `. Showing the first ${GH_LIMITS.skills}; paste a folder link for others.` : '.'));
      renderGitHubResults();
      if (counts.unverified) showToast(`Heads up: ${plural(counts.unverified, 'skill')} couldn't be fully checked.`, 3500);
    } catch (err) {
      setGitHubStatus(err.message);
    } finally {
      $('github-scan').disabled = false;
    }
  }

  function addGitHubSkills() {
    const ids = new Set(ghChecked());
    const adding = ghFound.filter((s) => ids.has(s.id) && s.status !== 'blocked');
    github = github.filter((s) => !ids.has(s.id)).concat(adding);
    reindex();
    adding.forEach((s) => selected.add(s.id));
    $('github').close();
    state.view = 'github';
    renderAll();
    const unverified = adding.filter((s) => s.status === 'unverified').length;
    showToast(unverified
      ? `Added ${plural(adding.length, 'skill')}. ${unverified} couldn't be fully checked - install only if you trust the source.`
      : `Added ${plural(adding.length, 'skill')} and selected them. Use Install to add them to Claude.`, 4500);
  }

  // ------------------------------------------------------------- rendering

  function visible() {
    const q = state.query.trim().toLowerCase();
    return all().filter((s) => {
      if (state.view === 'selected' && !selected.has(s.id)) return false;
      if (state.view === 'github' && s.source !== 'github') return false;
      if (!q) return true;
      return s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q);
    });
  }

  function toggle(id) {
    const skill = byId.get(id);
    if (!skill || skill.status === 'blocked') return;
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);
    renderAll();
  }

  function renderChips() {
    const wrap = $('chips');
    wrap.textContent = '';
    CHIPS.forEach((word) => {
      const chip = el('button', 'chip', word);
      chip.setAttribute('aria-pressed', String(state.query === word));
      chip.addEventListener('click', () => {
        state.query = state.query === word ? '' : word;
        search.value = state.query;
        renderGrid();
        renderChips();
      });
      wrap.appendChild(chip);
    });
  }

  function renderGrid() {
    const shown = visible();
    grid.textContent = '';

    const title = $('results-title');
    title.textContent = '';
    title.appendChild(el('strong', null, String(shown.length)));
    const scope = { selected: ' selected', github: ' from GitHub' }[state.view] || '';
    title.appendChild(document.createTextNode(
      `${shown.length === 1 ? ' skill' : ' skills'}${scope}${state.query ? ` matching \u201c${state.query}\u201d` : ''}`
    ));
    $('select-visible').disabled = !shown.length || shown.every((s) => selected.has(s.id) || s.status === 'blocked');
    $('clear').disabled = !selected.size;

    if (!shown.length) {
      const empty = el('div', 'empty');
      if (state.view === 'github' && !github.length) {
        empty.appendChild(el('h3', null, 'No GitHub skills yet'));
        empty.appendChild(el('p', null, 'Use "Add from GitHub" to scan a repository and add its skills.'));
      } else if (state.view === 'selected' && !selected.size) {
        empty.appendChild(el('h3', null, 'Nothing selected yet'));
        empty.appendChild(el('p', null, 'Pick skills from All skills and they will show up here.'));
      } else {
        empty.appendChild(el('h3', null, 'No matching skills'));
        empty.appendChild(el('p', null, 'Try a different word, or clear the search.'));
      }
      grid.appendChild(empty);
      return;
    }

    const frag = document.createDocumentFragment();
    shown.forEach((s) => {
      const card = el('div', 'card');
      card.setAttribute('role', 'checkbox');
      card.setAttribute('tabindex', '0');
      card.setAttribute('aria-checked', String(selected.has(s.id)));
      card.setAttribute('aria-label', s.name);
      if (s.status === 'blocked') card.setAttribute('aria-disabled', 'true');

      const check = el('span', 'check');
      check.innerHTML = ICONS.check;
      card.appendChild(check);
      card.appendChild(el('div', 'card-name', s.name));
      if (s.source === 'github') {
        const pills = el('div', 'pills');
        pills.appendChild(el('span', 'pill', s.origin));
        pills.appendChild(el('span', `pill ${STATUS[s.status].cls}`, STATUS[s.status].label));
        card.appendChild(pills);
      }
      card.appendChild(el('div', 'card-desc', s.description || 'No description provided.'));

      const foot = el('div', 'card-foot');
      const view = withIcon(el('button', 'btn btn-ghost'), ICONS.eye, 'Preview');
      view.setAttribute('aria-label', `Preview ${s.name}`);
      view.addEventListener('click', (e) => {
        e.stopPropagation();
        openPreview(s.id);
      });
      foot.appendChild(view);
      card.appendChild(foot);

      card.addEventListener('click', () => toggle(s.id));
      card.addEventListener('keydown', (e) => {
        if (e.target !== card) return;
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          toggle(s.id);
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
    const local = picks.filter((s) => s.source === 'bundled');
    const lines = ['mkdir -p ~/.claude/skills'].concat(local.map((s) => `cp -r skills/${shellQuote(s.dir)} ~/.claude/skills/`));
    if (local.length < picks.length) lines.push('# Skills from GitHub: use Install or Download .zip above');
    return lines.join('\n');
  }

  function buildOutput(picks) {
    if (state.mode === 'claudemd') {
      return `# Skills\n\nUse these skills when the task matches:\n\n${picks.map((s) => `- **${s.name}**: ${s.description}`).join('\n')}\n`;
    }
    return picks.map((s) => `## Skill: ${s.name}\n\n${s.body}`).join('\n\n---\n\n');
  }

  function codeBlock(label, text) {
    const code = el('div', 'code');
    const head = el('div', 'code-head');
    head.appendChild(el('span', null, label));
    const copy = withIcon(el('button', 'btn btn-ghost'), ICONS.copy, 'Copy');
    copy.addEventListener('click', () => copyText(text));
    head.appendChild(copy);
    code.appendChild(head);
    code.appendChild(el('pre', null, text));
    return code;
  }

  function notice(kind, icon, text) {
    const box = el('div', `notice ${kind}`);
    box.innerHTML = icon;
    box.appendChild(el('div', null, text));
    return box;
  }

  function renderInstall(picks) {
    const unverified = picks.filter((s) => s.status === 'unverified');
    if (unverified.length) {
      connectBody.appendChild(notice('', ICONS.warn,
        `${plural(unverified.length, 'selected skill')} couldn't be fully checked. You'll be asked to confirm before installing.`));
    }

    const actions = el('div', 'install-actions');
    if (SUPPORTS_FOLDER_WRITE) {
      const install = withIcon(el('button', 'btn btn-primary'), ICONS.install, `Install ${plural(picks.length, 'skill')} to Claude Code`);
      install.id = 'install-now';
      install.addEventListener('click', () => installSelected(false));
      actions.appendChild(install);
    }
    const zip = withIcon(el('button', `btn${SUPPORTS_FOLDER_WRITE ? '' : ' btn-primary'}`), ICONS.zip, 'Download as .zip');
    zip.id = 'download-zip';
    zip.addEventListener('click', downloadZip);
    actions.appendChild(zip);
    connectBody.appendChild(actions);

    const target = el('div', 'target-line');
    if (SUPPORTS_FOLDER_WRITE) {
      if (folderName) {
        target.appendChild(document.createTextNode('Installs into'));
        target.appendChild(el('code', null, folderName));
      } else {
        target.appendChild(document.createTextNode("First time? You'll pick your .claude\\skills folder once."));
      }
      const change = el('button', 'link-btn', folderName ? 'Change folder' : '');
      if (folderName) {
        change.addEventListener('click', () => installSelected(true));
        target.appendChild(change);
      }
    } else {
      target.appendChild(document.createTextNode('One-click install needs Microsoft Edge or Google Chrome. In this browser, download the .zip and unzip it into .claude\\skills.'));
    }
    connectBody.appendChild(target);

    const stepsWrap = el('div');
    stepsWrap.appendChild(el('p', 'section-label', 'After installing'));
    const steps = el('ol', 'steps');
    ['Start a new Claude Code session.', 'Claude picks the skills up automatically when a task matches.'].forEach((t) => steps.appendChild(el('li', null, t)));
    stepsWrap.appendChild(steps);
    connectBody.appendChild(stepsWrap);

    const more = el('details', 'more');
    more.appendChild(el('summary', null, 'Install from a terminal instead'));
    more.appendChild(codeBlock('Run from the repository folder', terminalCommands(picks)));
    connectBody.appendChild(more);
  }

  function renderConnect() {
    const picks = chosen();
    connectBody.textContent = '';

    if (!picks.length) {
      const ph = el('div', 'placeholder');
      ph.innerHTML = ICONS.spark;
      ph.appendChild(el('div', null, 'Select one or more skills to install them or generate the setup.'));
      connectBody.appendChild(ph);
      return;
    }

    const selWrap = el('div');
    selWrap.appendChild(el('p', 'section-label', `${picks.length} selected`));
    const list = el('div', 'selected-list');
    picks.forEach((s) => {
      const tag = el('span', 'tag');
      tag.appendChild(el('span', null, s.name));
      const rm = el('button');
      rm.innerHTML = ICONS.x;
      rm.setAttribute('aria-label', `Remove ${s.name}`);
      rm.addEventListener('click', () => toggle(s.id));
      tag.appendChild(rm);
      list.appendChild(tag);
    });
    selWrap.appendChild(list);
    connectBody.appendChild(selWrap);

    if (state.mode === 'install') {
      renderInstall(picks);
      return;
    }

    const stepsWrap = el('div');
    stepsWrap.appendChild(el('p', 'section-label', 'How to use'));
    const steps = el('ol', 'steps');
    const STEPS = {
      claudemd: ['Open or create CLAUDE.md in your project root.', 'Paste the block below.', 'Claude Code reads it at the start of every session.'],
      api: ['Copy the text below.', 'Pass it as the system parameter in your Claude API request.'],
    };
    STEPS[state.mode].forEach((t) => steps.appendChild(el('li', null, t)));
    stepsWrap.appendChild(steps);
    connectBody.appendChild(stepsWrap);
    connectBody.appendChild(codeBlock(state.mode === 'claudemd' ? 'CLAUDE.md' : 'System prompt', buildOutput(picks)));
  }

  function copyText(text) {
    const ok = () => showToast('Copied to clipboard');
    const fail = () => showToast('Copy failed. Select the text and copy it manually.');
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, fail);
    else fail();
  }

  function renderNav() {
    $('count-all').textContent = String(all().length);
    $('count-selected').textContent = String(selected.size);
    $('count-github').textContent = String(github.length);
    document.querySelectorAll('.nav-item[data-view]').forEach((item) => {
      item.setAttribute('aria-current', String(item.getAttribute('data-view') === state.view));
    });
    $('eyebrow').textContent = { selected: 'Your selection', github: 'Added from GitHub' }[state.view] || 'Skills library';
  }

  function renderAll() {
    renderNav();
    renderGrid();
    renderConnect();
    if (preview.open && previewId) syncPreviewButton();
  }

  function openPreview(id) {
    const s = byId.get(id);
    if (!s) return;
    previewId = id;
    $('preview-title').textContent = s.name;
    $('preview-desc').textContent = s.source === 'github' ? `${s.description} (from ${s.origin})` : s.description;
    const findings = $('preview-findings');
    findings.textContent = '';
    if (s.source === 'github') {
      const head = el('li');
      head.appendChild(el('span', `pill ${STATUS[s.status].cls}`, STATUS[s.status].label));
      findings.appendChild(head);
      (s.findings || []).forEach((f) => {
        const li = el('li');
        const sev = { block: 'Blocked', unverified: 'Not checked', warn: 'Note', allowed: 'Reviewed, safe' }[f.severity] || f.severity;
        li.appendChild(el('strong', null, sev));
        li.appendChild(el('span', null, f.message));
        li.appendChild(el('code', null, f.file + (f.line ? `:${f.line}` : '')));
        findings.appendChild(li);
      });
    }
    $('preview-body').textContent = s.body || 'SKILL.md could not be read.';
    syncPreviewButton();
    preview.showModal();
    preview.querySelector('.dialog-body').scrollTop = 0;
  }

  function syncPreviewButton() {
    const s = byId.get(previewId);
    const button = $('preview-toggle');
    button.disabled = !s || s.status === 'blocked';
    button.textContent = selected.has(previewId) ? 'Remove from selection' : 'Add to selection';
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

  search.addEventListener('input', () => {
    state.query = search.value;
    renderGrid();
    renderChips();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement !== search && !document.querySelector('dialog[open]')) {
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

  document.querySelectorAll('.segmented [role="tab"]').forEach((tab) => {
    tab.addEventListener('click', () => {
      state.mode = tab.getAttribute('data-mode');
      document.querySelectorAll('.segmented [role="tab"]').forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
      renderConnect();
    });
  });

  $('select-visible').addEventListener('click', () => {
    visible().forEach((s) => {
      if (s.status !== 'blocked') selected.add(s.id);
    });
    renderAll();
  });

  $('clear').addEventListener('click', () => {
    selected.clear();
    renderAll();
  });

  $('preview-close').addEventListener('click', () => preview.close());
  $('preview-dismiss').addEventListener('click', () => preview.close());
  $('preview-toggle').addEventListener('click', () => toggle(previewId));
  preview.addEventListener('click', (e) => {
    if (e.target === preview) preview.close();
  });

  $('open-github').addEventListener('click', () => {
    $('github').showModal();
    $('github-url').focus();
  });
  $('github-form').addEventListener('submit', runGitHubScan);
  $('github-add').addEventListener('click', addGitHubSkills);
  $('github-close').addEventListener('click', () => $('github').close());
  $('github-cancel').addEventListener('click', () => $('github').close());

  if (!bundled.length) {
    $('results-title').textContent = 'No skills data found. Run: node scripts/skill-connector-build.js';
  }

  if (SUPPORTS_FOLDER_WRITE) {
    getSavedFolder().then((handle) => {
      if (handle) {
        folderName = handle.name;
        renderConnect();
      }
    });
  }

  reindex();
  renderChips();
  renderAll();

  // Exposed for automated checks (scripts/skill-connector-check.js).
  window.SkillConnector = { scanGitHub, parseGitHubUrl, statusOf };
})();
