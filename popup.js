const STATE_KEY   = 'dhunt_state';
const COOLDOWN_MS = 5 * 60 * 1000;
const THEME_KEY   = 'dhuntTheme';

// ── Theme ─────────────────────────────────────────────────────────────────────

function applyTheme(t) {
  const dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  localStorage.setItem(THEME_KEY, t);
  document.querySelectorAll('#themeToggle button').forEach(b => {
    b.classList.toggle('active', b.dataset.theme === t);
  });
}

document.getElementById('themeToggle').addEventListener('click', e => {
  const btn = e.target.closest('button[data-theme]');
  if (!btn) return;
  applyTheme(btn.dataset.theme);
  chrome.storage.local.set({ [THEME_KEY]: btn.dataset.theme });
});

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if ((localStorage.getItem(THEME_KEY) || 'system') === 'system') applyTheme('system');
});

const keyword        = document.getElementById('keyword');
const startBtn       = document.getElementById('startBtn');
const dashBtn        = document.getElementById('dashBtn');
const interruptedRow = document.getElementById('interruptedRow');
const resumeBtn      = document.getElementById('resumeBtn');
const restartBtn     = document.getElementById('restartBtn');
const cooldownRow    = document.getElementById('cooldownRow');
const cooldownTimer  = document.getElementById('cooldownTimer');
const progressRow    = document.getElementById('progressRow');
const progressFill   = document.getElementById('progressFill');
const progressText   = document.getElementById('progressText');
const pauseBtn       = document.getElementById('pauseBtn');
const stopBtn        = document.getElementById('stopBtn');
const statusMsg      = document.getElementById('statusMsg');
const viewResultsBtn = document.getElementById('viewResultsBtn');

let paused = false;
let cooldownInterval = null;

// ── Status helpers ────────────────────────────────────────────────────────────

function setStatus(text, level = '') {
  statusMsg.textContent = text;
  statusMsg.className   = level;
}

function showToast(text, level = '', duration = 3000) {
  const wrap = document.getElementById('toastWrap');
  const el = document.createElement('div');
  el.className = `toast${level ? ' ' + level : ''}`;
  el.textContent = text;
  wrap.appendChild(el);
  setTimeout(() => {
    el.classList.add('out');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }, duration);
}

// ── Offline banner ────────────────────────────────────────────────────────────

let offlineBannerEl = null;

function showOfflineBanner() {
  if (offlineBannerEl) return;
  const wrap = document.getElementById('toastWrap');
  offlineBannerEl = document.createElement('div');
  offlineBannerEl.className = 'toast err sticky';
  offlineBannerEl.textContent = 'No internet connection';
  wrap.prepend(offlineBannerEl);
  startBtn.disabled = true;
  resumeBtn.disabled = true;
}

function hideOfflineBanner() {
  if (!offlineBannerEl) return;
  offlineBannerEl.classList.add('out');
  offlineBannerEl.addEventListener('animationend', () => {
    offlineBannerEl?.remove();
    offlineBannerEl = null;
  }, { once: true });
  startBtn.disabled = false;
  resumeBtn.disabled = false;
}

function showProgress(current, total, text) {
  progressRow.classList.add('visible');
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  progressFill.style.width = pct + '%';
  if (text) progressText.textContent = text;
}

function hideProgress() {
  progressRow.classList.remove('visible');
  progressFill.style.width = '0%';
}

function setRunning(running) {
  startBtn.disabled = running;
  keyword.disabled  = running;
  pauseBtn.style.display = running ? '' : 'none';
  stopBtn.style.display  = running ? '' : 'none';
}

function startCooldown(endTime) {
  clearInterval(cooldownInterval);
  cooldownRow.classList.add('visible');
  startBtn.disabled = true;
  cooldownInterval = setInterval(() => {
    const left = Math.max(0, Math.ceil((endTime - Date.now()) / 1000));
    cooldownTimer.textContent = left + 's';
    if (left <= 0) {
      clearInterval(cooldownInterval);
      cooldownRow.classList.remove('visible');
      startBtn.disabled = false;
    }
  }, 500);
}

// ── Apply storage state to popup UI ──────────────────────────────────────────

function applyState(state) {
  if (!state) return;

  const running     = state.status === 'running';
  const complete    = state.status === 'complete';
  const interrupted = state.status === 'interrupted';

  paused = state.controlSignal === 'pause' || state.status === 'paused';
  pauseBtn.textContent = paused ? 'Resume' : 'Pause';

  // Interrupted banner
  if (interrupted) {
    interruptedRow.classList.add('visible');
    setStatus('Hunt was interrupted.', 'info');
    setRunning(false);
    hideProgress();
    viewResultsBtn.classList.remove('visible');
    return;
  } else {
    interruptedRow.classList.remove('visible');
  }

  setRunning(running);

  if (running) {
    const { current = 0, total = 0 } = state.progress || {};
    const lastLog = state.logs?.slice(-1)[0];
    showProgress(current, total, lastLog?.text || `${current} / ${total}`);
    viewResultsBtn.classList.remove('visible');
  } else {
    hideProgress();
  }

  if (complete && state.results?.length > 0) {
    setStatus(`Done — ${state.results.length} products scored.`, 'ok');
    viewResultsBtn.classList.add('visible');
  }

  if (state.lastHuntEndTime && !running && !interrupted) {
    const elapsed = Date.now() - state.lastHuntEndTime;
    if (elapsed < COOLDOWN_MS) startCooldown(state.lastHuntEndTime + COOLDOWN_MS);
  }

  if (!running && !complete && !interrupted && state.logs?.length) {
    const last = state.logs[state.logs.length - 1];
    setStatus(last.text, last.level || '');
  }
}

// ── Boot ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  pauseBtn.style.display = 'none';
  stopBtn.style.display  = 'none';
  keyword.value = '';

  document.getElementById('d-copyrightYear').textContent = new Date().getFullYear();

  const { [STATE_KEY]: state, [THEME_KEY]: savedTheme } = await chrome.storage.local.get([STATE_KEY, THEME_KEY]);
  applyTheme(savedTheme || 'system');
  applyState(state);

  if (!navigator.onLine) showOfflineBanner();
  window.addEventListener('offline', showOfflineBanner);
  window.addEventListener('online',  hideOfflineBanner);

  chrome.storage.onChanged.addListener((changes) => {
    if (changes[STATE_KEY]) applyState(changes[STATE_KEY].newValue);
  });

  // ── Start Hunt ────────────────────────────────────────────────────────────
  startBtn.addEventListener('click', () => {
    const kw = keyword.value.trim();
    if (!kw) { keyword.focus(); return; }

    interruptedRow.classList.remove('visible');
    showToast(`Starting hunt for "${kw}"…`, 'info');
    viewResultsBtn.classList.remove('visible');
    setRunning(true);
    showProgress(0, 0, 'Starting…');

    chrome.runtime.sendMessage({ action: 'startHunt', keyword: kw }, (res) => {
      if (chrome.runtime.lastError) {
        showToast('Error: ' + chrome.runtime.lastError.message, 'err');
        setRunning(false); hideProgress();
        return;
      }
      if (res && !res.ok) {
        setRunning(false); hideProgress();
        showToast(res.status || 'Failed.', 'err');
        if (res.cooldownRemaining) startCooldown(Date.now() + res.cooldownRemaining * 1000);
      }
    });
  });

  // ── Pause / Resume ────────────────────────────────────────────────────────
  pauseBtn.addEventListener('click', () => {
    if (paused) {
      chrome.runtime.sendMessage({ action: 'resumeHunt' });
      paused = false; pauseBtn.textContent = 'Pause';
    } else {
      chrome.runtime.sendMessage({ action: 'pauseHunt' });
      paused = true; pauseBtn.textContent = 'Resume';
    }
  });

  // ── Stop ──────────────────────────────────────────────────────────────────
  stopBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'stopHunt' });
    setRunning(false); hideProgress();
    showToast('Hunt stopped.', 'warn');
    paused = false; pauseBtn.textContent = 'Pause';
  });

  // ── Resume Interrupted ────────────────────────────────────────────────────
  resumeBtn.addEventListener('click', () => {
    interruptedRow.classList.remove('visible');
    showToast('Resuming hunt…', 'info');
    setRunning(true);
    showProgress(0, 0, 'Resuming…');

    chrome.runtime.sendMessage({ action: 'resumeInterrupted' }, (res) => {
      if (chrome.runtime.lastError || (res && !res.ok)) {
        showToast((res && res.status) || 'Resume failed.', 'err');
        setRunning(false); hideProgress();
        interruptedRow.classList.add('visible');
      }
    });
  });

  // ── Restart Interrupted ───────────────────────────────────────────────────
  restartBtn.addEventListener('click', () => {
    const kw = keyword.value.trim() || undefined;
    interruptedRow.classList.remove('visible');
    showToast('Restarting hunt…', 'info');
    setRunning(true);
    showProgress(0, 0, 'Starting…');

    chrome.runtime.sendMessage({ action: 'restartHunt', keyword: kw }, (res) => {
      if (chrome.runtime.lastError || (res && !res.ok)) {
        showToast((res && res.status) || 'Restart failed.', 'err');
        setRunning(false); hideProgress();
      }
    });
  });

  // ── Dashboard / Results ───────────────────────────────────────────────────
  dashBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'openLogs' });
  });

  viewResultsBtn.addEventListener('click', () => {
    const url = chrome.runtime.getURL('dashboard.html') + '#results';
    chrome.tabs.create({ url });
  });

  keyword.addEventListener('keydown', e => { if (e.key === 'Enter') startBtn.click(); });
});
