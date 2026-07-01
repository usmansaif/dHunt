// dHunt — background service worker  v0.2.0

const STATE_KEY   = 'dhunt_state';
const HISTORY_KEY = 'dhunt_history';
const CONFIG_KEY  = 'dhunt_config';

const COOLDOWN_MS = 5 * 60 * 1000;
const MAX_HISTORY = 20;

const DEFAULT_STATE = {
  status: 'idle',       // idle | running | paused | complete | interrupted
  keyword: '',
  logs: [],
  results: [],
  progress: { current: 0, total: 0 },
  controlSignal: null,  // null | 'pause' | 'resume' | 'stop'
  huntTabId: null,
  lastHuntEndTime: null,
  // Resume support
  phase: null,          // null | 'search' | 'enrich'
  allListings: [],
  enrichedCount: 0,
  interrupted: false
};

const DEFAULT_CONFIG = {
  maxPages:       5,
  maxProducts:    80,
  sortBy:         'popularity',  // popularity | priceasc | pricedesc
  priceMin:       '',
  priceMax:       '',
  minRating:      0,
  minReviews:     0,
  brandFilter:    'any',         // any | branded | nobrand
  minImages:      0,
  freeShipping:   false,
  keywordInclude: '',
  keywordExclude: ''
};

// ── Storage helpers ───────────────────────────────────────────────────────────

async function getState() {
  const { [STATE_KEY]: s } = await chrome.storage.local.get(STATE_KEY);
  return s ? { ...DEFAULT_STATE, ...s } : { ...DEFAULT_STATE };
}

async function patchState(patch) {
  const state = await getState();
  const next = { ...state, ...patch };
  await chrome.storage.local.set({ [STATE_KEY]: next });
  return next;
}

async function addLog(text, level = '') {
  const state = await getState();
  const logs = [...(state.logs || []), { text, level, time: Date.now() }];
  await chrome.storage.local.set({ [STATE_KEY]: { ...state, logs } });
}

async function getConfig() {
  const { [CONFIG_KEY]: cfg } = await chrome.storage.local.get(CONFIG_KEY);
  return cfg ? { ...DEFAULT_CONFIG, ...cfg } : { ...DEFAULT_CONFIG };
}

// ── Keepalive (MV3 service worker health) ─────────────────────────────────────

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepAlive') chrome.storage.local.get(STATE_KEY);
});

function startKeepAlive() { chrome.alarms.create('keepAlive', { periodInMinutes: 0.4 }); }
function stopKeepAlive()  { chrome.alarms.clear('keepAlive'); }

// ── Detect interrupted hunt on browser restart ────────────────────────────────

chrome.runtime.onStartup.addListener(async () => {
  const state = await getState();
  if (state.status === 'running') {
    await patchState({
      status: 'interrupted',
      controlSignal: null,
      huntTabId: null,
      interrupted: true
    });
    stopKeepAlive();
  }
});

// ── Message router ────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  switch (msg.action) {
    case 'startHunt':
      handleHunt(msg.keyword, sendResponse, false);
      return true;
    case 'resumeInterrupted':
      handleResumeInterrupted(sendResponse);
      return true;
    case 'restartHunt':
      handleRestartHunt(msg.keyword, sendResponse);
      return true;
    case 'pauseHunt':
      patchState({ controlSignal: 'pause', status: 'paused' })
        .then(() => sendResponse({ ok: true }));
      return true;
    case 'resumeHunt':
      patchState({ controlSignal: 'resume', status: 'running' })
        .then(() => sendResponse({ ok: true }));
      return true;
    case 'stopHunt':
      patchState({ controlSignal: 'stop' })
        .then(() => sendResponse({ ok: true }));
      return true;
    case 'clearLogs':
      patchState({ logs: [] }).then(() => sendResponse({ ok: true }));
      return true;
    case 'openLogs':
      openLogsTab().then(() => sendResponse({ ok: true }));
      return true;
    case 'deleteHistory':
      deleteHistoryEntry(msg.id).then(() => sendResponse({ ok: true }));
      return true;
    case 'saveConfig':
      chrome.storage.local.set({ [CONFIG_KEY]: msg.config })
        .then(() => sendResponse({ ok: true }));
      return true;
  }
});

// Close hunt tab if user removes it manually
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const state = await getState();
  if (state.status === 'running' && state.huntTabId === tabId) {
    await addLog('Hunt tab closed — hunt stopped.', 'err');
    await patchState({ status: 'idle', controlSignal: 'stop', huntTabId: null });
    stopKeepAlive();
  }
});

// ── Logs tab ──────────────────────────────────────────────────────────────────

async function openLogsTab() {
  const url = chrome.runtime.getURL('dashboard.html');
  const existing = await chrome.tabs.query({ url });
  if (existing.length > 0) {
    await chrome.tabs.update(existing[0].id, { active: true });
    if (existing[0].windowId)
      await chrome.windows.update(existing[0].windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
}

// ── Navigation helpers ────────────────────────────────────────────────────────

function navigateAndWait(tabId, url, timeout = 45000) {
  return new Promise((resolve, reject) => {
    let seenLoading = false;
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('Page load timeout'));
    }, timeout);
    const listener = (id, info) => {
      if (id !== tabId) return;
      if (info.status === 'loading') seenLoading = true;
      if (info.status === 'complete' && seenLoading) {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.update(tabId, { url }).catch(err => {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      reject(err);
    });
  });
}

async function navigateWithRetry(tabId, url, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      await navigateAndWait(tabId, url);
      return;
    } catch (err) {
      if (attempt < retries) {
        await addLog(`⟳ Page slow — retrying (${attempt + 1}/${retries})…`, '');
        await new Promise(r => setTimeout(r, 4000));
      } else {
        throw new Error(`Page did not load after ${retries + 1} attempts. Check your connection.`);
      }
    }
  }
}

function randomDelay(minMs, maxMs) {
  const ms = minMs + Math.random() * (maxMs - minMs);
  return (async () => {
    let left = ms;
    while (left > 0) {
      const chunk = Math.min(left, 5000);
      await new Promise(r => setTimeout(r, chunk));
      await chrome.storage.local.get(STATE_KEY);
      left -= chunk;
    }
  })();
}

// ── Extraction with retry ─────────────────────────────────────────────────────

async function extractListings(tabId, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await chrome.tabs.sendMessage(tabId, { action: 'extractListings' });
      if (res && res.products && res.products.length > 0) return res;
    } catch (e) {}
    if (i < retries - 1) await randomDelay(2000, 3000);
  }
  return { products: [], count: 0 };
}

async function extractProductDetailsFromTab(tabId, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await chrome.tabs.sendMessage(tabId, { action: 'extractProductDetails' });
      if (res && res.title && res.title.length > 2) return res;
    } catch (e) {}
    if (i < retries - 1) await randomDelay(2500, 3500);
  }
  return {};
}

// ── Control signal check ──────────────────────────────────────────────────────

async function checkSignal() {
  let loggedPause = false;
  while (true) {
    const { controlSignal } = await getState();
    if (controlSignal === 'stop')   return 'stop';
    if (!controlSignal || controlSignal === 'resume') {
      if (controlSignal === 'resume') await patchState({ controlSignal: null });
      return 'continue';
    }
    if (controlSignal === 'pause') {
      if (!loggedPause) {
        await addLog('Hunt paused — click Resume to continue.', 'info');
        loggedPause = true;
      }
      await new Promise(r => setTimeout(r, 600));
    }
  }
}

// ── Product filter (config criteria applied post-enrichment) ──────────────────

function filterProduct(p, config) {
  if (config.priceMin !== '' || config.priceMax !== '') {
    const price = parseFloat((p.currentPrice || p.price || '').replace(/[^0-9.]/g, '')) || 0;
    if (config.priceMin !== '' && price > 0 && price < parseFloat(config.priceMin)) return false;
    if (config.priceMax !== '' && price > 0 && price > parseFloat(config.priceMax)) return false;
  }
  if (config.minRating > 0 && p.rating) {
    if ((parseFloat(p.rating) || 0) < config.minRating) return false;
  }
  if (config.minReviews > 0) {
    const rcRaw = (p.reviewCount || '').replace(/[^0-9]/g, '');
    if (rcRaw && parseInt(rcRaw) < config.minReviews) return false;
  }
  if (config.brandFilter === 'branded' && !p.brand) return false;
  if (config.brandFilter === 'nobrand' && p.brand) return false;
  if (config.minImages > 0 && p.imagesCount > 0 && p.imagesCount < config.minImages) return false;
  if (config.freeShipping && !p.freeShipping) return false;
  if (config.keywordInclude) {
    const lc = (p.title || '').toLowerCase();
    const terms = config.keywordInclude.toLowerCase().split(',').map(k => k.trim()).filter(Boolean);
    if (!terms.every(t => lc.includes(t))) return false;
  }
  if (config.keywordExclude) {
    const lc = (p.title || '').toLowerCase();
    const terms = config.keywordExclude.toLowerCase().split(',').map(k => k.trim()).filter(Boolean);
    if (terms.some(t => lc.includes(t))) return false;
  }
  return true;
}

// ── Demand score ──────────────────────────────────────────────────────────────

function calcScore(p) {
  let score = 0;
  const reviews = parseInt((p.reviewCount || '').replace(/[^0-9]/g, '') || '0');
  score += Math.min(reviews / 200, 1) * 50;

  const rating = parseFloat(p.rating || '0');
  if (rating > 0) score += (rating / 5) * 25;

  if ((p.stockStatus || '').includes('Low Stock')) score += 15;
  else if (p.stockStatus === 'In Stock')            score += 7;

  const disc = parseInt((p.discountPct || '0').replace(/[^0-9]/g, '') || '0');
  if (disc > 0) score += Math.min(disc / 20, 1) * 5;

  if (p.isMall) score += 5;

  return Math.round(Math.min(score, 100));
}

// ── History ───────────────────────────────────────────────────────────────────

async function saveToHistory(keyword, results) {
  const { [HISTORY_KEY]: history = [] } = await chrome.storage.local.get(HISTORY_KEY);
  const entry = {
    id: Date.now(),
    keyword,
    timestamp: Date.now(),
    count: results.length,
    topScore: results.reduce((m, p) => Math.max(m, p.demandScore || 0), 0),
    results
  };
  const trimmed = [entry, ...history].slice(0, MAX_HISTORY);
  await chrome.storage.local.set({ [HISTORY_KEY]: trimmed });
}

async function deleteHistoryEntry(id) {
  const { [HISTORY_KEY]: history = [] } = await chrome.storage.local.get(HISTORY_KEY);
  await chrome.storage.local.set({
    [HISTORY_KEY]: history.filter(h => String(h.id) !== String(id))
  });
}

// ── Resume / Restart after interruption ───────────────────────────────────────

async function handleResumeInterrupted(sendResponse) {
  const state = await getState();
  if (state.status !== 'interrupted') {
    sendResponse({ ok: false, status: 'No interrupted hunt to resume.' });
    return;
  }
  await handleHunt(state.keyword, sendResponse, true);
}

async function handleRestartHunt(keyword, sendResponse) {
  const state = await getState();
  const kw = keyword || state.keyword;
  await patchState({
    status: 'idle',
    interrupted: false,
    allListings: [],
    enrichedCount: 0,
    phase: null,
    controlSignal: null,
    results: [],
    logs: []
  });
  await handleHunt(kw, sendResponse, false);
}

// ── Main hunt handler ─────────────────────────────────────────────────────────

async function handleHunt(keyword, sendResponse, resumeMode) {
  const config = await getConfig();
  const prevState = await getState();

  // Cooldown (skip for resume)
  if (!resumeMode && prevState.lastHuntEndTime) {
    const elapsed = Date.now() - prevState.lastHuntEndTime;
    if (elapsed < COOLDOWN_MS) {
      const secs = Math.ceil((COOLDOWN_MS - elapsed) / 1000);
      sendResponse({ ok: false, status: `Cooldown active — wait ${secs}s.`, cooldownRemaining: secs });
      return;
    }
  }

  const maxProducts = Math.min(Math.max(1, config.maxProducts || 80), 200);
  const maxPages    = Math.min(Math.max(1, config.maxPages    || 5),  20);

  const SORT_MAP = { popularity: 'popularity', priceasc: 'priceasc', pricedesc: 'pricedesc' };
  const sortParam = SORT_MAP[config.sortBy] || 'popularity';

  // Resume checkpoint
  const canResume      = resumeMode && (prevState.allListings || []).length > 0;
  const resumeListings = canResume ? prevState.allListings    : [];
  const resumeIdx      = canResume ? (prevState.enrichedCount || 0) : 0;

  await patchState({
    status: 'running',
    keyword,
    logs:     canResume ? (prevState.logs    || []) : [],
    results:  canResume ? (prevState.results || []) : [],
    progress: { current: 0, total: 0 },
    controlSignal: null,
    huntTabId: null,
    interrupted: false,
    phase: canResume ? 'enrich' : 'search',
    allListings: resumeListings,
    enrichedCount: resumeIdx
  });

  if (canResume) {
    await addLog(`Resuming "${keyword}" — ${resumeListings.length} listings, from #${resumeIdx + 1}.`, 'info');
  } else {
    await addLog(`Hunt started: "${keyword}"`, 'info');
    await addLog(`Config: ${maxPages} pages · ${maxProducts} max products · sort=${sortParam}`, '');
  }

  startKeepAlive();
  let huntTab = null;

  try {
    let allListings = [...resumeListings];

    // Build a set of all product URLs already stored across all history entries
    // so we never collect the same product twice across different hunt runs.
    const { [HISTORY_KEY]: _history = [] } = await chrome.storage.local.get(HISTORY_KEY);
    const seenUrls = new Set(
      _history.flatMap(h => (h.results || []).map(p => p.url))
    );
    // Also seed with any URLs already in the current hunt's listings (resume case)
    for (const p of allListings) seenUrls.add(p.url);

    if (!canResume) {
      // ── Search phase ──────────────────────────────────────────────────────
      const searchUrl = `https://www.daraz.pk/catalog/?q=${encodeURIComponent(keyword)}&sort=${sortParam}`;

      huntTab = await chrome.tabs.create({ url: searchUrl, active: false });
      await patchState({ huntTabId: huntTab.id });
      await addLog(`Search tab opened (ID: ${huntTab.id})`, '');

      await navigateWithRetry(huntTab.id, searchUrl);
      await randomDelay(2500, 4000);

      let pageNum = 1;

      while (allListings.length < maxProducts && pageNum <= maxPages) {
        if (await checkSignal() === 'stop') { await addLog('Stopped during search.', 'err'); break; }

        await addLog(`Scanning page ${pageNum} / ${maxPages}…`, '');
        const result = await extractListings(huntTab.id);

        if (result.products.length === 0) {
          await addLog(pageNum === 1
            ? '⚠ 0 products on page 1 — selectors may need updating.'
            : 'No more products found.', pageNum === 1 ? 'err' : '');
          break;
        }

        let added = 0;
        for (const p of result.products) {
          if (!seenUrls.has(p.url)) {
            seenUrls.add(p.url);
            allListings.push(p);
            added++;
            if (allListings.length >= maxProducts) break;
          }
        }
        await addLog(`Page ${pageNum}: +${added} (total: ${allListings.length})`, 'ok');
        await patchState({
          allListings,
          progress: { current: allListings.length, total: allListings.length }
        });

        if (allListings.length >= maxProducts || pageNum >= maxPages) break;

        let nextUrl = null;
        try {
          const nr = await chrome.tabs.sendMessage(huntTab.id, { action: 'getNextPageUrl' });
          nextUrl = nr?.url || null;
        } catch (e) {}
        if (!nextUrl) { await addLog('No more pages.', ''); break; }

        await randomDelay(1500, 4500);
        await navigateWithRetry(huntTab.id, nextUrl);
        await randomDelay(2000, 3500);
        pageNum++;
      }

      if (allListings.length === 0) {
        await addLog('⚠ 0 products extracted — Daraz layout may have changed.', 'err');
        await patchState({ status: 'idle', lastHuntEndTime: Date.now(), allListings: [], enrichedCount: 0 });
        sendResponse({ ok: false, status: '0 products extracted. Daraz layout may have changed.' });
        return;
      }

      await patchState({ phase: 'enrich' });
    } else {
      // Resume: open a fresh tab for product detail pages
      huntTab = await chrome.tabs.create({ url: 'https://www.daraz.pk', active: false });
      await patchState({ huntTabId: huntTab.id });
      await navigateWithRetry(huntTab.id, 'https://www.daraz.pk');
      await randomDelay(1500, 2500);
    }

    const targetCount = allListings.length;
    await addLog(`${targetCount} listings — enriching from #${resumeIdx + 1}…`, 'info');
    await patchState({ progress: { current: resumeIdx, total: targetCount } });

    // ── Enrich phase ──────────────────────────────────────────────────────────
    const enriched = canResume ? [...(prevState.results || [])] : [];
    let enrichedCount = resumeIdx;

    for (let i = resumeIdx; i < targetCount; i++) {
      const signal = await checkSignal();
      if (signal === 'stop') { await addLog(`Stopped at ${i}/${targetCount}.`, 'err'); break; }

      const listing = allListings[i];
      enrichedCount = i + 1;
      await patchState({ enrichedCount, progress: { current: enrichedCount, total: targetCount } });
      await addLog(`[${enrichedCount}/${targetCount}] ${listing.title.substring(0, 55)}…`, '');

      try {
        await navigateWithRetry(huntTab.id, listing.url);
        await randomDelay(2500, 4000);

        const details = await extractProductDetailsFromTab(huntTab.id);
        const merged = { ...listing, ...details };

        if (!filterProduct(merged, config)) {
          await addLog(`⊘ Filtered: ${listing.title.substring(0, 45)}`, '');
          await randomDelay(800, 1500);
          continue;
        }

        merged.demandScore = calcScore(merged);
        enriched.push(merged);

        const partialSorted = [...enriched].sort((a, b) => (b.demandScore || 0) - (a.demandScore || 0));
        await patchState({ results: partialSorted, enrichedCount });

        await addLog(`✓ Score ${merged.demandScore} | ${listing.title.substring(0, 45)}`, 'ok');
      } catch (err) {
        await addLog(`✗ Skipped: ${listing.title.substring(0, 40)} — ${err.message}`, 'err');
      }

      await randomDelay(1000, 2500);
    }

    enriched.sort((a, b) => (b.demandScore || 0) - (a.demandScore || 0));
    await addLog(`✓ Hunt complete — ${enriched.length} products scored.`, 'ok');

    await saveToHistory(keyword, enriched);

    await patchState({
      status: 'complete',
      results: enriched,
      progress: { current: enriched.length, total: enriched.length },
      controlSignal: null,
      huntTabId: null,
      lastHuntEndTime: Date.now(),
      phase: null,
      allListings: [],
      enrichedCount: 0,
      interrupted: false
    });

    sendResponse({ ok: true, status: `Done — ${enriched.length} products scored.`, count: enriched.length });

  } catch (err) {
    await addLog('Fatal: ' + err.message, 'err');
    await patchState({ status: 'idle', controlSignal: null, huntTabId: null, lastHuntEndTime: Date.now() });
    sendResponse({ ok: false, status: 'Hunt failed: ' + err.message });
  } finally {
    if (huntTab) await chrome.tabs.remove(huntTab.id).catch(() => {});
    stopKeepAlive();
  }
}
