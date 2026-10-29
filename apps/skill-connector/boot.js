/* Prabh's CSC - loading screen.
 *
 * A small computer "runs the test suite": checks pass, one fails, the error is
 * fixed, and the app opens. Loaded before the data scripts so it starts while
 * they parse. Click or press any key to skip; reduced-motion users get a short
 * static version.
 */
(function () {
  'use strict';

  const boot = document.getElementById('boot');
  if (!boot) return;
  const screen = boot.querySelector('.boot-screen');
  const log = document.getElementById('boot-log');
  const bar = document.getElementById('boot-bar');
  const status = document.getElementById('boot-status');
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const STEPS = [
    { text: '$ csc test --all', cls: 'cmd', wait: 260 },
    { text: 'loading skill library', cls: 'dim', wait: 220, progress: 15 },
    { text: 'PASS  safety scan', cls: 'pass', wait: 200, progress: 32 },
    { text: 'PASS  frontmatter', cls: 'pass', wait: 200, progress: 46 },
    { text: 'FAIL  install: SKILL.md not found', cls: 'fail', wait: 420, progress: 58, error: true },
    { text: '> fixing: write SKILL.md to skill folder', cls: 'fix', wait: 360, fix: true },
    { text: 'PASS  install', cls: 'pass', wait: 200, progress: 78, replacesError: true },
    { text: 'PASS  claude sync', cls: 'pass', wait: 200, progress: 92 },
    { text: 'all checks passed', cls: 'ok', wait: 280, progress: 100 },
  ];

  let done = false;
  let errorLine = null;
  const timers = [];

  function finish() {
    if (done) return;
    done = true;
    timers.forEach(clearTimeout);
    boot.classList.add('boot-done');
    document.documentElement.classList.remove('booting');
    setTimeout(() => boot.remove(), reduced ? 0 : 420);
    window.removeEventListener('keydown', finish, true);
  }

  function addLine(step) {
    const line = document.createElement('div');
    line.className = `boot-line ${step.cls}`;
    line.textContent = step.text;
    if (step.replacesError && errorLine) {
      errorLine.classList.add('fixed');
    }
    log.appendChild(line);
    if (step.error) {
      errorLine = line;
      screen.classList.add('has-error');
      status.textContent = 'Found an error';
    }
    if (step.fix) status.textContent = 'Fixing it';
    if (step.replacesError) {
      screen.classList.remove('has-error');
      status.textContent = 'Fixed. Running the rest';
    }
    if (typeof step.progress === 'number') bar.style.width = `${step.progress}%`;
    if (step.cls === 'ok') status.textContent = 'Ready';
  }

  boot.addEventListener('click', finish);
  window.addEventListener('keydown', finish, true);

  if (reduced) {
    STEPS.forEach(addLine);
    timers.push(setTimeout(finish, 500));
    return;
  }

  let at = 120;
  STEPS.forEach((step) => {
    timers.push(setTimeout(() => addLine(step), at));
    at += step.wait;
  });
  timers.push(setTimeout(finish, at + 250));
})();
