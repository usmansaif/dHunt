// dHunt Dashboard controller  v0.2.1

const STATE_KEY   = 'dhunt_state';
const HISTORY_KEY = 'dhunt_history';
const CONFIG_KEY  = 'dhunt_config';
const COOLDOWN_MS = 5 * 60 * 1000;
const TOP_N       = 5;
const TOP_MIN_SCORE = 25;

const DEFAULT_CONFIG = {
  maxPages: 5, maxProducts: 80, sortBy: 'popularity',
  priceMin: '', priceMax: '', minRating: 0, minReviews: 0,
  brandFilter: 'any', minImages: 0, freeShipping: false,
  keywordInclude: '', keywordExclude: ''
};

// ── DOM refs ──────────────────────────────────────────────────────────────────

const huntDot      = document.getElementById('huntDot');
const logsBadge    = document.getElementById('logsBadge');
const resultsBadge = document.getElementById('resultsBadge');
const histBadge    = document.getElementById('histBadge');

// Hunt page
const dKeyword      = document.getElementById('d-keyword');
const dStartBtn     = document.getElementById('d-startBtn');
const dCooldown     = document.getElementById('d-cooldown');
const dCoolTimer    = document.getElementById('d-cooldownTimer');
const dInterrupted  = document.getElementById('d-interrupted');
const dResumeBtn    = document.getElementById('d-resumeBtn');
const dRestartBtn   = document.getElementById('d-restartBtn');
const dProgressCard = document.getElementById('d-progressCard');
const dProgressFill = document.getElementById('d-progressFill');
const dProgressText = document.getElementById('d-progressText');
const dPauseBtn     = document.getElementById('d-pauseBtn');
const dStopBtn      = document.getElementById('d-stopBtn');
const dStatus       = document.getElementById('d-status');
const dWarn         = document.getElementById('d-warn');

// Logs page
const dLogList    = document.getElementById('d-logList');
const dLogCount   = document.getElementById('d-logCount');
const dAutoScroll = document.getElementById('d-autoScroll');
const dClearBtn   = document.getElementById('d-clearBtn');

// Results page
const dResultsSub    = document.getElementById('d-resultsSubtitle');
const dCsvBtn        = document.getElementById('d-csvBtn');
const dTableToolbar  = document.getElementById('d-tableToolbar');
const dToolbarCount  = document.getElementById('d-toolbarCount');
const dResultsEmpty  = document.getElementById('d-resultsEmpty');
const dResultsTable  = document.getElementById('d-resultsTable');
const dResultsBody   = document.getElementById('d-resultsBody');
const dHuntTabs      = document.getElementById('d-huntTabs');
const dHuntTabsInner = document.getElementById('d-huntTabsInner');

// History page
const dHistEmpty = document.getElementById('d-histEmpty');
const dHistList  = document.getElementById('d-histList');

// Settings page
const dTestNotif  = document.getElementById('d-testNotif');

// About
const dAboutBtn     = document.getElementById('d-aboutBtn');
const dAboutOverlay = document.getElementById('d-aboutOverlay');
const dAboutClose   = document.getElementById('d-aboutClose');

// Confirm dialog
const dConfirmOverlay = document.getElementById('d-confirmOverlay');
const dConfirmMsg     = document.getElementById('d-confirmMsg');
const dConfirmOk      = document.getElementById('d-confirmOk');
const dConfirmCancel  = document.getElementById('d-confirmCancel');

// Results page extras
const dClearResultsBtn = document.getElementById('d-clearResultsBtn');
const dToast           = document.getElementById('d-toast');

// Quick filter
const dFilterToggle = document.getElementById('d-filterToggle');
const dQfBar        = document.getElementById('d-qfBar');
const dQfTab        = document.getElementById('d-qfTab');
const dQfText       = document.getElementById('d-qfText');
const dQfScore      = document.getElementById('d-qfScore');
const dQfClear      = document.getElementById('d-qfClear');

// Seller modal
const dSellerOverlay    = document.getElementById('d-sellerOverlay');
const dSellerAvatar     = document.getElementById('d-sellerAvatar');
const dSellerName       = document.getElementById('d-sellerName');
const dSellerSub        = document.getElementById('d-sellerSub');
const dSellerStatsGrid  = document.getElementById('d-sellerStatsGrid');
const dSellerProducts   = document.getElementById('d-sellerProducts');
const dSellerClose      = document.getElementById('d-sellerClose');

// Context menu
const ctxMenu = document.getElementById('ctxMenu');

// ── Confirm helper ────────────────────────────────────────────────────────────

function showConfirm(message, okLabel = 'Delete', cancelLabel = 'Cancel') {
  return new Promise(resolve => {
    dConfirmMsg.textContent    = message;
    dConfirmOk.textContent     = okLabel;
    dConfirmCancel.textContent = cancelLabel;
    dConfirmOverlay.classList.add('open');

    const finish = (result) => {
      dConfirmOverlay.classList.remove('open');
      dConfirmOk.removeEventListener('click', onOk);
      dConfirmCancel.removeEventListener('click', onCancel);
      dConfirmOverlay.removeEventListener('click', onBackdrop);
      dConfirmCancel.textContent = 'Cancel';
      resolve(result);
    };
    const onOk       = () => finish(true);
    const onCancel   = () => finish(false);
    const onBackdrop = (e) => { if (e.target === dConfirmOverlay) finish(false); };

    dConfirmOk.addEventListener('click', onOk);
    dConfirmCancel.addEventListener('click', onCancel);
    dConfirmOverlay.addEventListener('click', onBackdrop);
  });
}

// ── State ─────────────────────────────────────────────────────────────────────

let sortCol = 'demandScore';
let sortDir = -1;
let currentResults = [];
let renderedLogCount = 0;
let paused = false;
let cooldownInterval = null;
let currentPage = 'hunt';

// Hunt tabs state
let huntTabs  = [];   // [{id, label, keyword, results, timestamp, count, topScore?}]
let activeTabId = null;

// Quick filter state
let quickFilter = { text: '', minScore: 0 };
let fullTabResults = [];  // unfiltered results for active tab

// ── Helpers ───────────────────────────────────────────────────────────────────

let toastTimer = null;
function showToast(msg, type = '', duration = 2500) {
  dToast.textContent = msg;
  dToast.className = 'toast show' + (type ? ' toast-' + type : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => dToast.classList.remove('show'), duration);
}

function formatCountdown(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const ss = String(s).padStart(2, '0');
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m ${ss}s`;
  return `${m}:${ss}`;
}

function applyQuickFilter() {
  const text  = quickFilter.text.toLowerCase().trim();
  const score = quickFilter.minScore;
  const filtered = fullTabResults.filter(p => {
    if (text) {
      const hay = [p.title, p.brand, p.seller].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(text)) return false;
    }
    if (score > 0 && (p.demandScore || 0) < score) return false;
    return true;
  });
  renderResults(filtered);
  const hasFilter = !!(text || score > 0);
  dFilterToggle.classList.toggle('has-filter', hasFilter);
}

function syncFilterUI() {
  // Populate tab dropdown from current huntTabs
  dQfTab.innerHTML = huntTabs.map(t => {
    const date = t.timestamp
      ? new Date(t.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' })
      : 'Live';
    return `<option value="${esc(t.id)}">${esc(t.label)} — ${date} (${t.count})</option>`;
  }).join('');
  dQfTab.value = activeTabId || '';
}

// ── Navigation ────────────────────────────────────────────────────────────────

document.querySelectorAll('.nav-item[data-page]').forEach(item => {
  item.addEventListener('click', () => navigateTo(item.dataset.page));
});

async function navigateTo(page) {
  currentPage = page;
  document.querySelectorAll('.nav-item[data-page]').forEach(i => i.classList.remove('active'));
  document.querySelector(`.nav-item[data-page="${page}"]`).classList.add('active');
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + page).classList.add('active');

  const { [STATE_KEY]: state, [HISTORY_KEY]: hist = [] }
    = await chrome.storage.local.get([STATE_KEY, HISTORY_KEY]);

  if (page === 'logs') {
    renderedLogCount = 0;
    renderLogs(state?.logs || []);
  } else if (page === 'results') {
    clearQuickFilter();
    await renderResultsTabs();
  } else if (page === 'history') {
    await loadHistory();
  } else if (page === 'settings') {
    await loadConfig();
  }
}

// ── Sort ──────────────────────────────────────────────────────────────────────

document.querySelectorAll('#d-resultsTable th.sortable').forEach(th => {
  th.addEventListener('click', () => {
    if (sortCol === th.dataset.col) {
      sortDir *= -1;
    } else {
      sortCol = th.dataset.col;
      sortDir = -1;
    }
    document.querySelectorAll('#d-resultsTable th.sortable').forEach(h => {
      h.classList.remove('sort-active');
      h.textContent = h.textContent.replace(/ [▲▼]$/, '');
    });
    th.classList.add('sort-active');
    th.textContent += sortDir === -1 ? ' ▼' : ' ▲';
    renderResults(currentResults);
  });
});

// ── Theme ─────────────────────────────────────────────────────────────────────

function applyTheme(val) {
  const effective = val === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : val;
  document.documentElement.dataset.theme = effective;
  localStorage.setItem('dhuntTheme', val);
  document.querySelectorAll('.theme-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.themeVal === val);
  });
}

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (localStorage.getItem('dhuntTheme') === 'system') applyTheme('system');
});

// ── Boot ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  dPauseBtn.style.display = 'none';
  dStopBtn.style.display  = 'none';

  document.getElementById('d-copyrightYear').textContent = new Date().getFullYear();

  const savedTheme = localStorage.getItem('dhuntTheme') || 'system';
  document.querySelectorAll('.theme-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.themeVal === savedTheme);
    b.addEventListener('click', () => applyTheme(b.dataset.themeVal));
  });

  const { [STATE_KEY]: state, [HISTORY_KEY]: history = [] }
    = await chrome.storage.local.get([STATE_KEY, HISTORY_KEY]);

  applyState(state);
  updateBadges(state, history);

  chrome.storage.onChanged.addListener(async (changes) => {
    if (changes[STATE_KEY]) {
      const newState = changes[STATE_KEY].newValue;
      applyState(newState);

      const { [HISTORY_KEY]: h = [] } = await chrome.storage.local.get(HISTORY_KEY);
      updateBadges(newState, h);

      if (currentPage === 'logs' && newState) {
        const logs = newState.logs || [];
        if (logs.length > renderedLogCount) {
          logs.slice(renderedLogCount).forEach(appendLogEntry);
          if (dAutoScroll.checked) dLogList.scrollTop = dLogList.scrollHeight;
        } else if (logs.length < renderedLogCount) {
          renderedLogCount = 0;
          renderLogs(newState.logs || []);
        }
      }

      if (currentPage === 'results' && newState && newState.status === 'complete') {
        await renderResultsTabs();
      }
    }
    if (changes[HISTORY_KEY]) {
      const newHist = changes[HISTORY_KEY].newValue || [];
      histBadge.textContent = newHist.length;
      if (currentPage === 'history') loadHistory();
      if (currentPage === 'results') await renderResultsTabs();
    }
  });

  // Logs: clear
  dClearBtn.addEventListener('click', async () => {
    const ok = await showConfirm('Clear all log entries?', 'Clear');
    if (!ok) return;
    chrome.runtime.sendMessage({ action: 'clearLogs' }, () => {
      renderedLogCount = 0;
      dLogList.innerHTML = '<div class="empty-pane">Logs cleared.</div>';
      dLogCount.textContent = '0 entries';
    });
  });

  // Hunt: Start
  dStartBtn.addEventListener('click', async () => {
    const kw = dKeyword.value.trim();
    if (!kw) { dKeyword.focus(); return; }

    // Check if any filter criteria is configured
    const { [CONFIG_KEY]: cfg } = await chrome.storage.local.get(CONFIG_KEY);
    const c = cfg || {};
    const hasFilters = !!(
      c.priceMin || c.priceMax ||
      (parseFloat(c.minRating) > 0) ||
      (parseInt(c.minReviews) > 0) ||
      (parseInt(c.minImages) > 0) ||
      (c.brandFilter && c.brandFilter !== 'any') ||
      c.freeShipping ||
      (c.keywordInclude || '').trim() ||
      (c.keywordExclude || '').trim()
    );

    if (!hasFilters) {
      const goSettings = await showConfirm(
        'No filter criteria configured. Without filters the hunt scores all products broadly.\n\nGo to Settings to add criteria, or start anyway.',
        'Go to Settings',
        'Start Anyway'
      );
      if (goSettings) { await navigateTo('settings'); return; }
    }

    setStatus('info', `Starting hunt for "${kw}"…`);
    dWarn.classList.remove('visible');
    dInterrupted.classList.remove('visible');
    dStartBtn.disabled = true;
    dKeyword.disabled  = true;

    chrome.runtime.sendMessage({ action: 'startHunt', keyword: kw }, (res) => {
      if (chrome.runtime.lastError) {
        setStatus('err', 'Error: ' + chrome.runtime.lastError.message);
        resetHuntUI();
        return;
      }
      if (res && !res.ok) {
        if (res.cooldownRemaining) startCooldown(Date.now() + res.cooldownRemaining * 1000);
        if (res.status && res.status.includes('0 products')) dWarn.classList.add('visible');
        setStatus('err', res.status || 'Hunt failed.');
        resetHuntUI();
      }
    });
  });

  // Hunt: Pause / Resume
  dPauseBtn.addEventListener('click', () => {
    if (paused) {
      chrome.runtime.sendMessage({ action: 'resumeHunt' });
      paused = false; dPauseBtn.textContent = 'Pause';
    } else {
      chrome.runtime.sendMessage({ action: 'pauseHunt' });
      paused = true; dPauseBtn.textContent = 'Resume';
    }
  });

  // Hunt: Stop
  dStopBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'stopHunt' });
    resetHuntUI();
    dProgressCard.classList.remove('visible');
  });

  // Interrupted: Resume
  dResumeBtn.addEventListener('click', () => {
    dInterrupted.classList.remove('visible');
    setStatus('info', 'Resuming interrupted hunt…');
    dStartBtn.disabled = true;
    dKeyword.disabled  = true;

    chrome.runtime.sendMessage({ action: 'resumeInterrupted' }, (res) => {
      if (chrome.runtime.lastError || (res && !res.ok)) {
        setStatus('err', (res && res.status) || 'Resume failed.');
        resetHuntUI();
        dInterrupted.classList.add('visible');
      }
    });
  });

  // Interrupted: Restart
  dRestartBtn.addEventListener('click', () => {
    const kw = dKeyword.value.trim() || undefined;
    dInterrupted.classList.remove('visible');
    setStatus('info', 'Restarting hunt…');
    dStartBtn.disabled = true;
    dKeyword.disabled  = true;

    chrome.runtime.sendMessage({ action: 'restartHunt', keyword: kw }, (res) => {
      if (chrome.runtime.lastError || (res && !res.ok)) {
        setStatus('err', (res && res.status) || 'Restart failed.');
        resetHuntUI();
      }
    });
  });

  dKeyword.addEventListener('keydown', e => { if (e.key === 'Enter') dStartBtn.click(); });

  // Results: CSV
  dCsvBtn.addEventListener('click', () => exportCSV(currentResults));

  // Results: Clear
  dClearResultsBtn.addEventListener('click', async () => {
    const ok = await showConfirm('Delete all current results?', 'Delete');
    if (!ok) return;
    const { [STATE_KEY]: s } = await chrome.storage.local.get(STATE_KEY);
    await chrome.storage.local.set({ [STATE_KEY]: { ...s, results: [], status: 'idle' } });
    renderResults([]);
  });

  // Settings: Auto-save on any change (debounced)
  let autoSaveTimer = null;
  function scheduleAutoSave() {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(() => saveConfig(), 600);
  }
  document.querySelectorAll(
    '#page-settings input[type="number"], #page-settings input[type="text"], #page-settings select'
  ).forEach(el => el.addEventListener('input', scheduleAutoSave));
  document.querySelectorAll(
    '#page-settings input[type="checkbox"], #page-settings input[type="radio"]'
  ).forEach(el => el.addEventListener('change', () => saveConfig()));

  // Settings: Test notification
  dTestNotif.addEventListener('click', () => {
    chrome.notifications.create('dhunt-test-' + Date.now(), {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon48.png'),
      title: 'dHunt — Test Notification',
      message: 'Notifications are working correctly!'
    });
  });

  // About: open / close
  dAboutBtn.addEventListener('click', () => dAboutOverlay.classList.add('open'));
  dAboutClose.addEventListener('click', () => dAboutOverlay.classList.remove('open'));
  dAboutOverlay.addEventListener('click', (e) => {
    if (e.target === dAboutOverlay) dAboutOverlay.classList.remove('open');
  });
  document.getElementById('d-aboutVisit').addEventListener('click', () => {
    window.open('https://usmansaif.com', '_blank', 'noopener,noreferrer');
  });

  // Seller modal
  dSellerClose.addEventListener('click', () => dSellerOverlay.classList.remove('open'));
  dSellerOverlay.addEventListener('click', (e) => {
    if (e.target === dSellerOverlay) dSellerOverlay.classList.remove('open');
  });

  // Quick filter
  dFilterToggle.addEventListener('click', () => {
    dQfBar.classList.toggle('open');
  });
  dQfTab.addEventListener('change', () => {
    clearQuickFilter(false);
    selectTab(dQfTab.value);
  });
  dQfText.addEventListener('input', () => {
    quickFilter.text = dQfText.value;
    applyQuickFilter();
  });
  dQfScore.addEventListener('input', () => {
    quickFilter.minScore = parseFloat(dQfScore.value) || 0;
    applyQuickFilter();
  });
  dQfClear.addEventListener('click', () => {
    clearQuickFilter(true);
    applyQuickFilter();
  });

  // Hash navigation
  if (window.location.hash) {
    const hash = window.location.hash.replace('#', '');
    if (['hunt', 'logs', 'results', 'history', 'settings'].includes(hash)) {
      navigateTo(hash);
    }
  }
});

// ── applyState ────────────────────────────────────────────────────────────────

function applyState(state) {
  if (!state) return;

  const running     = state.status === 'running';
  const complete    = state.status === 'complete';
  const interrupted = state.status === 'interrupted';

  huntDot.className = 'hunt-dot' + (running ? ' running' : '');

  paused = state.controlSignal === 'pause' || state.status === 'paused';
  dPauseBtn.textContent = paused ? 'Resume' : 'Pause';

  if (interrupted) {
    dInterrupted.classList.add('visible');
    dCooldown.classList.remove('visible');
    resetHuntUI();
    dProgressCard.classList.remove('visible');
  } else if (running) {
    dInterrupted.classList.remove('visible');
    dStartBtn.disabled = true;
    dKeyword.disabled  = true;
    dPauseBtn.style.display = '';
    dStopBtn.style.display  = '';
    dProgressCard.classList.add('visible');
  } else {
    dInterrupted.classList.remove('visible');
    resetHuntUI();
    dProgressCard.classList.remove('visible');
  }

  // Progress bar
  const { current = 0, total = 0 } = state.progress || {};
  if (total > 0) {
    const pct = Math.round((current / total) * 100);
    dProgressFill.style.width = pct + '%';
    const lastLog = state.logs?.slice(-1)[0];
    dProgressText.textContent = lastLog ? lastLog.text : `${current} / ${total}`;
    if (running) dProgressCard.classList.add('visible');
  }

  // Cooldown
  if (state.lastHuntEndTime && !running && !interrupted) {
    const elapsed = Date.now() - state.lastHuntEndTime;
    if (elapsed < COOLDOWN_MS) startCooldown(state.lastHuntEndTime + COOLDOWN_MS);
  }

  if (complete && state.results?.length > 0) {
    setStatus('ok', `Hunt complete — ${state.results.length} products scored. View the Results page.`);
  }
  if (complete && (!state.results || state.results.length === 0)) {
    dWarn.classList.add('visible');
  }
}

function resetHuntUI() {
  dStartBtn.disabled = false;
  dKeyword.disabled  = false;
  dPauseBtn.style.display = 'none';
  dStopBtn.style.display  = 'none';
}

function setStatus(level, text) {
  dStatus.className = `status-strip visible ${level}`;
  dStatus.textContent = text;
}

// ── Badges ────────────────────────────────────────────────────────────────────

function updateBadges(state, history) {
  logsBadge.textContent    = state?.logs?.length || 0;
  resultsBadge.textContent = state?.results?.length || 0;
  histBadge.textContent    = history?.length || 0;
}

// ── Logs ──────────────────────────────────────────────────────────────────────

function renderLogs(logs) {
  if (!logs.length) {
    dLogList.innerHTML = '<div class="empty-pane">No logs yet — run a hunt.</div>';
    dLogCount.textContent = '0 entries';
    renderedLogCount = 0;
    return;
  }
  dLogList.innerHTML = '';
  renderedLogCount = 0;
  logs.forEach(appendLogEntry);
  dLogCount.textContent = `${logs.length} ${logs.length === 1 ? 'entry' : 'entries'}`;
  if (dAutoScroll.checked) dLogList.scrollTop = dLogList.scrollHeight;
}

function appendLogEntry(entry) {
  const isEmpty = dLogList.querySelector('.empty-pane');
  if (isEmpty) isEmpty.remove();
  const div = document.createElement('div');
  div.className = 'log-entry' + (entry.level ? ' ' + entry.level : '');
  div.innerHTML =
    `<span class="log-time">${fmtTime(entry.time)}</span>` +
    `<span class="log-msg ${entry.level || ''}">${esc(entry.text)}</span>`;
  dLogList.appendChild(div);
  renderedLogCount++;
  dLogCount.textContent = `${renderedLogCount} ${renderedLogCount === 1 ? 'entry' : 'entries'}`;
}

// ── Results tabs ──────────────────────────────────────────────────────────────

async function renderResultsTabs() {
  const { [STATE_KEY]: state, [HISTORY_KEY]: history = [] }
    = await chrome.storage.local.get([STATE_KEY, HISTORY_KEY]);

  huntTabs = [];

  // Live tab: running hunt with in-progress results not yet persisted to history
  if (state && state.status === 'running' && state.results?.length > 0) {
    huntTabs.push({
      id: 'live',
      label: state.keyword || 'Live',
      keyword: state.keyword,
      results: state.results,
      timestamp: null,
      count: state.results.length
    });
  }

  // One tab per history entry (history is already newest-first)
  for (const entry of history) {
    huntTabs.push({
      id: String(entry.id),
      label: entry.keyword || 'Hunt',
      keyword: entry.keyword,
      results: entry.results || [],
      timestamp: entry.timestamp,
      count: entry.count || (entry.results || []).length,
      topScore: entry.topScore
    });
  }

  if (!huntTabs.length) {
    dHuntTabs.style.display = 'none';
    dFilterToggle.style.display = 'none';
    dQfBar.classList.remove('open');
    renderResults([]);
    return;
  }

  // If activeTabId no longer exists among tabs, reset to first
  if (!huntTabs.find(t => t.id === activeTabId)) {
    activeTabId = huntTabs[0].id;
  }

  dHuntTabs.style.display = 'block';
  dFilterToggle.style.display = '';
  dHuntTabsInner.innerHTML = '';

  for (const tab of huntTabs) {
    const btn = document.createElement('button');
    btn.className = 'hunt-tab' + (tab.id === activeTabId ? ' active' : '');
    btn.dataset.tabId = tab.id;

    const dateStr = tab.timestamp
      ? new Date(tab.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' })
      : 'Live';
    const metaStr = tab.topScore != null
      ? `${dateStr} · ${tab.count} · top ${tab.topScore}`
      : `${dateStr} · ${tab.count}`;

    btn.innerHTML =
      `<span class="tab-keyword">${esc(tab.label)}</span>` +
      `<span class="tab-meta">${metaStr}</span>`;

    btn.addEventListener('click', () => {
      clearQuickFilter(false);
      selectTab(tab.id);
    });
    dHuntTabsInner.appendChild(btn);
  }

  syncFilterUI();

  const active = huntTabs.find(t => t.id === activeTabId);
  if (active) {
    fullTabResults = active.results;
    applyQuickFilter();
  }
}

function selectTab(tabId) {
  activeTabId = tabId;
  dHuntTabsInner.querySelectorAll('.hunt-tab').forEach(b => {
    b.classList.toggle('active', b.dataset.tabId === tabId);
  });
  const tab = huntTabs.find(t => t.id === tabId);
  if (tab) {
    fullTabResults = tab.results;
    dQfTab.value = tabId;
    applyQuickFilter();
  }
}

function clearQuickFilter(resetInputs = true) {
  quickFilter = { text: '', minScore: 0 };
  if (resetInputs) {
    dQfText.value  = '';
    dQfScore.value = '';
  }
  dFilterToggle.classList.remove('has-filter');
}

// ── Results ───────────────────────────────────────────────────────────────────

function renderResults(results) {
  currentResults = results || [];

  if (!results || !results.length) {
    dResultsSub.textContent          = 'No hunt results yet';
    dResultsEmpty.style.display      = 'flex';
    dResultsTable.style.display      = 'none';
    dTableToolbar.style.display      = 'none';
    dCsvBtn.style.display            = 'none';
    dClearResultsBtn.style.display   = 'none';
    return;
  }

  dResultsEmpty.style.display    = 'none';
  dResultsTable.style.display    = 'table';
  dTableToolbar.style.display    = 'flex';
  dCsvBtn.style.display          = '';
  dClearResultsBtn.style.display = '';

  const topScore = results.reduce((m, p) => Math.max(m, p.demandScore || 0), 0);
  dResultsSub.textContent   = `${results.length} products · top score ${topScore}`;
  dToolbarCount.textContent = `${results.length} products · sorted by ${sortCol}`;

  // Identify TOP picks (best N by score, always shown at top)
  const byScore = [...results].sort((a, b) => (b.demandScore || 0) - (a.demandScore || 0));
  const topSet  = new Set();
  for (const p of byScore) {
    if (topSet.size >= TOP_N) break;
    if ((p.demandScore || 0) >= TOP_MIN_SCORE) topSet.add(p.url || p.title);
  }

  const sortVal = p => {
    const raw = String(p[sortCol] || '');
    const num = parseFloat(raw.replace(/[^0-9.]/g, ''));
    return isNaN(num) ? raw : num;
  };

  // TOP picks sorted by score; rest sorted by active column
  const topArr  = [...results].filter(p =>  topSet.has(p.url || p.title))
    .sort((a, b) => (b.demandScore || 0) - (a.demandScore || 0));
  const restArr = [...results].filter(p => !topSet.has(p.url || p.title))
    .sort((a, b) => {
      const av = sortVal(a), bv = sortVal(b);
      if (typeof av === 'number' && typeof bv === 'number') return sortDir * (bv - av);
      return sortDir * String(bv).localeCompare(String(av));
    });

  const sorted = [...topArr, ...restArr];

  dResultsBody.innerHTML = '';
  sorted.forEach((p, i) => {
    const isTop     = topSet.has(p.url || p.title);
    const isLastTop = isTop && i === topArr.length - 1;

    const tr = document.createElement('tr');
    if (isTop) tr.classList.add('top-pick');
    if (isLastTop && restArr.length > 0) tr.classList.add('top-divider');

    const stockClass =
      (p.stockStatus || '').includes('Low')  ? 'stock-low' :
      (p.stockStatus || '').includes('Out')  ? 'stock-out' : 'stock-ok';

    const url        = p.url || '';
    const title      = p.title || '-';
    const shortTitle = title.length > 60 ? title.substring(0, 60) + '…' : title;
    const brand      = p.brand ? esc(p.brand.substring(0, 20)) : '<span class="muted">—</span>';
    const discBadge  = p.discountPct  ? `<span class="badge-disc">${esc(p.discountPct)}</span>` : '';
    const shipBadge  = p.freeShipping ? `<span class="badge-ship">FREE</span>` : '';

    tr.innerHTML =
      `<td class="col-rank">${isTop ? `<span class="badge-top">TOP</span>` : i + 1}</td>` +

      `<td class="col-name">` +
        (url
          ? `<a class="product-link" href="${url}" target="_blank" rel="noreferrer" title="${esc(title)}">${esc(shortTitle)}</a>`
          : `<span>${esc(shortTitle)}</span>`
        ) +
        (p.isMall ? `<span class="badge-mall">MALL</span>` : '') +
      `</td>` +

      `<td class="col-brand">${brand}</td>` +
      `<td class="col-seller">${p.seller ? `<button class="seller-link" data-seller="${esc(p.seller)}">${esc(p.seller.substring(0, 20))}</button>` : '<span class="muted">—</span>'}</td>` +
      `<td class="col-price">${esc(p.currentPrice || p.price || '—')}${discBadge}${shipBadge}</td>` +
      `<td>${p.rating || '—'}</td>` +
      `<td>${p.reviewCount || '—'}</td>` +
      `<td class="${stockClass}">${esc(p.stockStatus || '—')}</td>` +
      `<td class="col-num">${p.imagesCount || '—'}</td>` +
      `<td class="col-score">${p.demandScore || 0}</td>` +
      `<td class="col-link">${url ? `<a class="ext-link" href="${url}" target="_blank" rel="noreferrer" title="Open on Daraz">↗</a>` : '—'}</td>` +
      `<td class="col-del"><button class="del-btn" title="Remove this result">✕</button></td>`;

    tr.querySelector('.del-btn')?.addEventListener('click', () => deleteResult(p));
    const sellerBtn = tr.querySelector('.seller-link');
    if (sellerBtn) sellerBtn.addEventListener('click', () => showSellerModal(sellerBtn.dataset.seller, currentResults));
    tr.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); showContextMenu(e, buildCtxItems(p, e.target)); });
    dResultsBody.appendChild(tr);
  });
}

// ── Delete individual result ──────────────────────────────────────────────────

async function deleteResult(product) {
  const key = product.url || product.title;
  const confirmed = await showConfirm(`Remove "${product.title ? product.title.substring(0, 60) : 'this product'}" from results?`, 'Remove');
  if (!confirmed) return;

  if (activeTabId === 'live') {
    const { [STATE_KEY]: state } = await chrome.storage.local.get(STATE_KEY);
    if (!state) return;
    state.results = (state.results || []).filter(p => (p.url || p.title) !== key);
    await chrome.storage.local.set({ [STATE_KEY]: state });
  } else {
    const { [HISTORY_KEY]: history = [] } = await chrome.storage.local.get(HISTORY_KEY);
    const entry = history.find(e => String(e.id) === activeTabId);
    if (!entry) return;
    entry.results = (entry.results || []).filter(p => (p.url || p.title) !== key);
    entry.count   = entry.results.length;
    await chrome.storage.local.set({ [HISTORY_KEY]: history });
  }

  await renderResultsTabs();
}

// ── Seller modal ──────────────────────────────────────────────────────────────

function showSellerModal(sellerName, allResults) {
  const products = allResults.filter(p => p.seller === sellerName);

  dSellerName.textContent    = sellerName;
  dSellerAvatar.textContent  = sellerName.charAt(0).toUpperCase();

  const isMall   = products.some(p => p.isMall);
  const scores   = products.map(p => p.demandScore || 0);
  const avgScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
  const topScore = Math.max(...scores, 0);
  const prices   = products.map(p => parseFloat(String(p.currentPrice || p.price || '').replace(/[^0-9.]/g, ''))).filter(n => !isNaN(n));
  const minPrice = prices.length ? Math.min(...prices) : null;
  const maxPrice = prices.length ? Math.max(...prices) : null;
  const avgRating = products.filter(p => p.rating).length
    ? (products.reduce((s, p) => s + parseFloat(p.rating || 0), 0) / products.filter(p => p.rating).length).toFixed(1)
    : '—';
  const freeShipCount = products.filter(p => p.freeShipping).length;

  dSellerSub.textContent = (isMall ? '✦ Mall Seller  ·  ' : '') +
    `${products.length} product${products.length !== 1 ? 's' : ''} in this hunt`;

  const priceStr = minPrice != null
    ? (minPrice === maxPrice ? `Rs ${minPrice.toLocaleString()}` : `Rs ${minPrice.toLocaleString()} – ${maxPrice.toLocaleString()}`)
    : '—';

  dSellerStatsGrid.innerHTML =
    stat(products.length, 'Products') +
    stat(avgScore,        'Avg Score') +
    stat(topScore,        'Top Score') +
    stat(avgRating,       'Avg Rating') +
    stat(priceStr,        'Price Range') +
    stat(freeShipCount,   'Free Shipping');

  dSellerProducts.innerHTML = '';
  const sorted = [...products].sort((a, b) => (b.demandScore || 0) - (a.demandScore || 0));
  sorted.forEach(p => {
    const row = document.createElement('div');
    row.className = 'seller-product-row';
    const shortTitle = (p.title || '').substring(0, 55) + ((p.title || '').length > 55 ? '…' : '');
    row.innerHTML =
      `<div class="seller-product-name">${p.url
        ? `<a href="${p.url}" target="_blank" rel="noreferrer">${esc(shortTitle)}</a>`
        : esc(shortTitle)}</div>` +
      `<span class="seller-product-price">${esc(p.currentPrice || p.price || '—')}</span>` +
      `<span class="seller-product-score">${p.demandScore || 0}</span>`;
    dSellerProducts.appendChild(row);
  });

  dSellerOverlay.classList.add('open');
}

function stat(val, label) {
  return `<div class="seller-stat"><div class="seller-stat-val">${val}</div><div class="seller-stat-lbl">${label}</div></div>`;
}

// ── History ───────────────────────────────────────────────────────────────────

async function loadHistory() {
  const { [HISTORY_KEY]: history = [] } = await chrome.storage.local.get(HISTORY_KEY);
  histBadge.textContent = history.length;

  if (!history.length) {
    dHistEmpty.style.display = 'flex';
    dHistList.innerHTML = '';
    return;
  }
  dHistEmpty.style.display = 'none';
  dHistList.innerHTML = '';

  for (const entry of history) {
    const div = document.createElement('div');
    div.className = 'history-entry';
    div.dataset.id = entry.id;
    div.dataset.keyword = entry.keyword || '';
    const date = new Date(entry.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
    div.innerHTML =
      `<div class="history-icon">📦</div>` +
      `<div class="history-info">` +
        `<span class="history-keyword">"${esc(entry.keyword)}"</span>` +
        `<span class="history-meta">${date} · ${entry.count} products` +
          `<span class="history-score">Top ${entry.topScore}</span>` +
        `</span>` +
      `</div>` +
      `<div class="history-actions">` +
        `<button class="btn btn-ghost btn-sm btn-load" data-id="${entry.id}" data-tooltip="Load results into dashboard">Show</button>` +
        `<button class="btn btn-danger btn-sm btn-del"  data-id="${entry.id}" data-tooltip="Delete this history entry">✕</button>` +
      `</div>`;
    dHistList.appendChild(div);
  }

  dHistList.querySelectorAll('.btn-load').forEach(btn => {
    btn.addEventListener('click', async () => {
      const entry = history.find(h => String(h.id) === btn.dataset.id);
      if (!entry) return;
      dKeyword.value = entry.keyword;
      activeTabId = String(entry.id);
      await navigateTo('results');
    });
  });

  dHistList.querySelectorAll('.btn-del').forEach(btn => {
    btn.addEventListener('click', async () => {
      const ok = await showConfirm('Delete this hunt from history?', 'Delete');
      if (!ok) return;
      chrome.runtime.sendMessage({ action: 'deleteHistory', id: btn.dataset.id }, loadHistory);
    });
  });
}

// ── Settings ──────────────────────────────────────────────────────────────────

async function loadConfig() {
  const { [CONFIG_KEY]: cfg } = await chrome.storage.local.get(CONFIG_KEY);
  const c = cfg ? { ...DEFAULT_CONFIG, ...cfg } : { ...DEFAULT_CONFIG };

  document.getElementById('cfg-maxPages').value       = c.maxPages;
  document.getElementById('cfg-maxProducts').value    = c.maxProducts;
  document.getElementById('cfg-sortBy').value         = c.sortBy;
  document.getElementById('cfg-priceMin').value       = c.priceMin;
  document.getElementById('cfg-priceMax').value       = c.priceMax;
  document.getElementById('cfg-minRating').value      = c.minRating;
  document.getElementById('cfg-minReviews').value     = c.minReviews;
  document.getElementById('cfg-minImages').value      = c.minImages;
  document.getElementById('cfg-freeShipping').checked = c.freeShipping;
  document.getElementById('cfg-keywordInclude').value = c.keywordInclude;
  document.getElementById('cfg-keywordExclude').value = c.keywordExclude;
  document.querySelectorAll('input[name="brandFilter"]')
    .forEach(r => { r.checked = r.value === c.brandFilter; });
}

async function saveConfig(silent = false) {
  const config = {
    maxPages:       parseInt(document.getElementById('cfg-maxPages').value)    || 5,
    maxProducts:    parseInt(document.getElementById('cfg-maxProducts').value)  || 80,
    sortBy:         document.getElementById('cfg-sortBy').value || 'popularity',
    priceMin:       document.getElementById('cfg-priceMin').value.trim(),
    priceMax:       document.getElementById('cfg-priceMax').value.trim(),
    minRating:      parseFloat(document.getElementById('cfg-minRating').value)  || 0,
    minReviews:     parseInt(document.getElementById('cfg-minReviews').value)   || 0,
    minImages:      parseInt(document.getElementById('cfg-minImages').value)    || 0,
    freeShipping:   document.getElementById('cfg-freeShipping').checked,
    keywordInclude: document.getElementById('cfg-keywordInclude').value.trim(),
    keywordExclude: document.getElementById('cfg-keywordExclude').value.trim(),
    brandFilter:    document.querySelector('input[name="brandFilter"]:checked')?.value || 'any'
  };

  await chrome.storage.local.set({ [CONFIG_KEY]: config });
  if (!silent) showToast('✓ Settings saved', 'success');
}

// ── Cooldown ──────────────────────────────────────────────────────────────────

function startCooldown(endTime) {
  clearInterval(cooldownInterval);
  dCooldown.classList.add('visible');
  dStartBtn.disabled = true;
  cooldownInterval = setInterval(() => {
    const left = Math.max(0, Math.ceil((endTime - Date.now()) / 1000));
    dCoolTimer.textContent = formatCountdown(left);
    if (left <= 0) {
      clearInterval(cooldownInterval);
      dCooldown.classList.remove('visible');
      dStartBtn.disabled = false;
    }
  }, 500);
}

// ── CSV export ────────────────────────────────────────────────────────────────

function exportCSV(results) {
  if (!results || !results.length) return;
  const headers = [
    'Rank','Title','URL','Category','Brand',
    'Current Price','Original Price','Discount %',
    'Rating','Reviews','Stock','Is Mall','Seller','Free Shipping',
    'Images','Video','Desc Length','Specs','Variants','Score'
  ];
  const rows = results.map((p, i) => [
    i + 1,
    csvCell(p.title),
    csvCell(p.url),
    csvCell(p.category),
    csvCell(p.brand),
    csvCell(p.currentPrice || p.price),
    csvCell(p.originalPrice),
    csvCell(p.discountPct),
    p.rating       || '',
    p.reviewCount  || '',
    csvCell(p.stockStatus),
    p.isMall          ? 'Yes' : 'No',
    csvCell(p.seller),
    p.freeShipping    ? 'Yes' : 'No',
    p.imagesCount          || 0,
    p.videoAvailable       ? 'Yes' : 'No',
    p.descriptionLength    || 0,
    p.specificationsCount  || 0,
    p.variantsCount        || 0,
    p.demandScore          || 0
  ]);
  const content = [headers, ...rows].map(r => r.join(',')).join('\r\n');
  const blob = new Blob(['﻿' + content], { type: 'text/csv;charset=utf-8;' });
  const burl = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = burl;
  a.download = `dhunt-${(dKeyword.value || 'results').replace(/\W+/g, '-').slice(0, 20)}-${Date.now()}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(burl);
}

// ── Context menu ─────────────────────────────────────────────────────────────

function buildCtxItems(p, targetEl) {
  const td  = targetEl.closest('td');
  const cls = td ? td.className : '';
  const items = [];

  if (cls.includes('col-seller') && p.seller) {
    items.push({ icon: '👤', label: 'View Seller Details', action: () => showSellerModal(p.seller, currentResults) });
    items.push({ icon: '📋', label: 'Copy Seller Name',    action: () => copyCtx(p.seller, 'Seller copied') });
  } else if (cls.includes('col-price') && (p.currentPrice || p.price)) {
    items.push({ icon: '💰', label: 'Copy Price', action: () => copyCtx(p.currentPrice || p.price, 'Price copied') });
  } else if (cls.includes('col-score')) {
    items.push({ icon: '📊', label: 'Copy Score', action: () => copyCtx(String(p.demandScore ?? 0), 'Score copied') });
  } else {
    if (p.url)   items.push({ icon: '↗',  label: 'Open Product', action: () => window.open(p.url, '_blank') });
    if (p.title) items.push({ icon: '📋', label: 'Copy Title',   action: () => copyCtx(p.title, 'Title copied') });
    if (p.url)   items.push({ icon: '🔗', label: 'Copy Link',    action: () => copyCtx(p.url,   'Link copied') });
  }

  items.push({ sep: true });
  items.push({ icon: '✕', label: 'Delete Product', action: () => deleteResult(p), danger: true });
  return items;
}

function copyCtx(text, toastMsg) {
  navigator.clipboard.writeText(text).then(() => showToast('✓ ' + toastMsg, 'success'));
}

function showContextMenu(e, items) {
  ctxMenu.innerHTML = items.map((item, i) => {
    if (item.sep) return '<div class="ctx-sep"></div>';
    return `<div class="ctx-item${item.danger ? ' danger' : ''}" data-idx="${i}">` +
           `<span class="ctx-icon">${item.icon}</span>${item.label}</div>`;
  }).join('');

  ctxMenu.querySelectorAll('.ctx-item').forEach(el => {
    const idx = parseInt(el.dataset.idx, 10);
    el.addEventListener('click', () => { hideContextMenu(); items[idx].action(); });
  });

  ctxMenu.style.left = '0'; ctxMenu.style.top = '0';
  ctxMenu.classList.add('open');
  const mw = ctxMenu.offsetWidth, mh = ctxMenu.offsetHeight;
  const vw = window.innerWidth,   vh = window.innerHeight;
  ctxMenu.style.left = Math.min(e.clientX, vw - mw - 4) + 'px';
  ctxMenu.style.top  = Math.min(e.clientY, vh - mh - 4) + 'px';
}

function buildGenericCtxItems(target) {
  const items = [];

  const logEntry    = target.closest('.log-entry');
  const histEntry   = target.closest('.history-entry');
  const sidebar     = target.closest('.sidebar');
  const pageResults = target.closest('#page-results');
  const pageLogs    = target.closest('#page-logs');
  const pageHunt    = target.closest('#page-hunt');
  const pageSettings = target.closest('#page-settings');

  if (logEntry) {
    const msg = logEntry.querySelector('.log-msg')?.textContent?.trim() || '';
    if (msg) items.push({ icon: '📋', label: 'Copy Log Line', action: () => copyCtx(msg, 'Log copied') });
    items.push({ sep: true });
    items.push({ icon: '🗑', label: 'Clear Logs', danger: true, action: () => dClearBtn.click() });

  } else if (histEntry) {
    const id      = histEntry.dataset.id;
    const keyword = histEntry.dataset.keyword || '';
    items.push({ icon: '📊', label: 'Load Results', action: () => {
      dKeyword.value = keyword;
      activeTabId = String(id);
      navigateTo('results');
    }});
    items.push({ sep: true });
    items.push({ icon: '✕', label: 'Delete Entry', danger: true, action: () => {
      showConfirm('Delete this hunt from history?', 'Delete').then(ok => {
        if (ok) chrome.runtime.sendMessage({ action: 'deleteHistory', id }, loadHistory);
      });
    }});

  } else if (sidebar) {
    items.push({ icon: '🎯', label: 'Hunt',     action: () => navigateTo('hunt') });
    items.push({ icon: '📋', label: 'Logs',     action: () => navigateTo('logs') });
    items.push({ icon: '📊', label: 'Results',  action: () => navigateTo('results') });
    items.push({ icon: '🕐', label: 'History',  action: () => navigateTo('history') });
    items.push({ icon: '⚙',  label: 'Settings', action: () => navigateTo('settings') });

  } else if (pageResults) {
    if (currentResults.length) {
      items.push({ icon: '⬇', label: 'Export CSV',    action: () => dCsvBtn.click() });
      items.push({ sep: true });
      items.push({ icon: '🗑', label: 'Clear Results', danger: true, action: () => dClearResultsBtn.click() });
    }

  } else if (pageLogs) {
    items.push({ icon: '🗑', label: 'Clear Logs', danger: true, action: () => dClearBtn.click() });

  } else if (pageSettings) {
    items.push({ icon: '💾', label: 'Save Settings', action: () => saveConfig() });

  } else if (pageHunt) {
    items.push({ icon: '🎯', label: 'Start Hunt',   action: () => dStartBtn.click() });
    items.push({ icon: '📊', label: 'View Results', action: () => navigateTo('results') });

  } else {
    items.push({ icon: '📊', label: 'View Results', action: () => navigateTo('results') });
    items.push({ icon: '🎯', label: 'Go to Hunt',   action: () => navigateTo('hunt') });
  }

  return items;
}

function hideContextMenu() {
  ctxMenu.classList.remove('open');
}

document.addEventListener('contextmenu', e => {
  e.preventDefault();
  const items = buildGenericCtxItems(e.target);
  if (items.length) showContextMenu(e, items);
});
document.addEventListener('click',   e => { if (!ctxMenu.contains(e.target)) hideContextMenu(); });
document.addEventListener('keydown',  e => { if (e.key === 'Escape') hideContextMenu(); });

// ── Utils ─────────────────────────────────────────────────────────────────────

function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function csvCell(val) {
  const s = String(val || '').replace(/"/g, '""');
  return (s.includes(',') || s.includes('"') || s.includes('\n')) ? `"${s}"` : s;
}

function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour12: false });
}
