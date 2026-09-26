(() => {
  'use strict';

  const BASE = window.location.origin;
  const PAGE_SIZE = 40;

  const $ = (sel, root = document) => root.querySelector(sel);

  const el = {
    dateTabs: $('#date-tabs'),
    topList: $('#top-list'),
    groupsRoot: $('#groups-root'),
    status: $('#status-text'),
    loadedCount: $('#loaded-count'),
    btnLoadMore: $('#btn-load-more'),
    btnRefresh: $('#btn-refresh'),
    btnRun: $('#btn-run-triggers'),
    btnClearKey: $('#btn-clear-key'),
    fMinChange: $('#f-min-change'),
    fMinVol: $('#f-min-vol'),
    fSector: $('#f-sector'),
    fType: $('#f-type'),
    fSort: $('#f-sort'),
    mSymbols: $('#m-symbols'),
    mTriggers: $('#m-triggers'),
    mVolume: $('#m-volume'),
    mCe: $('#m-ce'),
    mPe: $('#m-pe'),
    istTime: $('#ist-time'),
    istWindow: $('#ist-window')
  };

  const state = {
    activeDate: null,
    page: 1,
    total: 0,
    items: [],
    loading: false
  };

  // ── Admin key ──────────────────────────────────────────
  function getAdminKey() {
    let key = sessionStorage.getItem('adminKey');
    if (!key) {
      key = window.prompt('Admin key');
      if (!key) return null;
      sessionStorage.setItem('adminKey', key.trim());
    }
    return sessionStorage.getItem('adminKey');
  }

  async function adminFetch(url, options = {}) {
    const key = getAdminKey();
    if (!key) throw new Error('Admin key required');

    const res = await fetch(url, {
      ...options,
      headers: {
        'X-Admin-Key': key,
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });

    if (res.status === 401) {
      sessionStorage.removeItem('adminKey');
      throw new Error('Invalid admin key');
    }

    const json = await res.json();
    if (!json.status && json.status !== true) {
      // allow status:true only
      if (json.status === false) throw new Error(json.message || 'Request failed');
    }
    if (json.status === false) throw new Error(json.message || 'Request failed');
    return json;
  }

  // ── IST clock ──────────────────────────────────────────
  function tickClock() {
    const now = new Date();
    el.istTime.textContent = new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    }).format(now);

    const h = Number(
      new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        hour12: false,
        hour: 'numeric'
      }).format(now)
    );
    let win = 'Closed';
    if (h >= 9 && h < 10) win = 'Open drive';
    else if (h >= 10 && h < 13) win = 'Mid-morning';
    else if (h >= 13 && h < 15) win = 'Afternoon';
    else if (h >= 15 && h <= 16) win = 'Close drive';
    el.istWindow.textContent = win;
  }
  setInterval(tickClock, 1000);
  tickClock();

  // ── Helpers ────────────────────────────────────────────
  function score(item) {
    const pct = Math.abs(Number(item.changePercent) || 0);
    const vol = Number(item.volume) || 0;
    return pct * Math.log10(vol + 10);
  }

  function fmtVol(v) {
    v = Number(v) || 0;
    if (v >= 1e7) return (v / 1e7).toFixed(2) + ' Cr';
    if (v >= 1e5) return (v / 1e5).toFixed(2) + ' L';
    if (v >= 1e3) return (v / 1e3).toFixed(1) + ' K';
    return String(v);
  }

  function fmtTime(value) {
    if (!value) return '--';
    return new Date(value).toLocaleTimeString('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
  }

  function sparkSVG(seq, up) {
    const pts = (Array.isArray(seq) ? seq : [])
      .map(Number)
      .filter((n) => Number.isFinite(n));
    if (pts.length < 2) {
      return '<svg class="sp-spark" viewBox="0 0 80 28" aria-hidden="true"><path class="line" d="M0 14 H80"/></svg>';
    }
    const min = Math.min(...pts);
    const max = Math.max(...pts);
    const range = max - min || 1;
    const w = 80;
    const h = 28;
    const pad = 2;
    const step = w / (pts.length - 1);
    let d = '';
    pts.forEach((p, i) => {
      const x = i * step;
      const y = h - pad - ((p - min) / range) * (h - pad * 2);
      d += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1) + ' ';
    });
    return `<svg class="sp-spark ${up ? 'up' : 'down'}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><path class="line" d="${d}" fill="none" stroke-width="1.5"/></svg>`;
  }

  function filteredItems() {
    const minChange = Number(el.fMinChange.value) || 0;
    const minVol = Number(el.fMinVol.value) || 0;
    const sector = el.fSector.value;
    const type = el.fType.value;
    const sortKey = el.fSort.value;

    let list = state.items.filter((t) => {
      const pct = Math.abs(Number(t.changePercent) || 0);
      if (pct < minChange) return false;
      if ((Number(t.volume) || 0) < minVol) return false;
      if (sector && t.instrumentSector !== sector) return false;
      if (type && t.optionType !== type) return false;
      return true;
    });

    list.sort((a, b) => {
      if (sortKey === 'volume') return (b.volume || 0) - (a.volume || 0);
      if (sortKey === 'time') {
        return new Date(b.triggerEndTime || b.generatedTime) - new Date(a.triggerEndTime || a.generatedTime);
      }
      if (sortKey === 'abs') {
        return Math.abs(b.changePercent) - Math.abs(a.changePercent);
      }
      return score(b) - score(a);
    });

    return list;
  }

  // ── Render ─────────────────────────────────────────────
  function renderMetrics(list) {
    const symbols = new Set(list.map((t) => t.symbol));
    let vol = 0;
    let ce = 0;
    let pe = 0;
    list.forEach((t) => {
      vol += Number(t.volume) || 0;
      if (t.optionType === 'CE') ce++;
      if (t.optionType === 'PE') pe++;
    });
    el.mSymbols.textContent = symbols.size;
    el.mTriggers.textContent = list.length;
    el.mVolume.textContent = fmtVol(vol);
    el.mCe.textContent = ce;
    el.mPe.textContent = pe;
  }

  function renderTop5(list) {
    const top = [...list].sort((a, b) => score(b) - score(a)).slice(0, 5);
    el.topList.innerHTML = top
      .map((t, i) => {
        const up = Number(t.changePercent) >= 0;
        return `<li class="sp-top-item">
          <span class="sp-top-rank">${i + 1}</span>
          <span class="sp-top-sym">${t.symbol}</span>
          <span class="sp-type ${t.optionType === 'CE' ? 'ce' : 'pe'}">${t.optionType}</span>
          <span>${sparkSVG(t.priceSequence, up)}</span>
          <span class="sp-delta ${up ? 'up' : 'down'}">${up ? '+' : ''}${Number(t.changePercent).toFixed(1)}%</span>
          <span class="sp-vol">${fmtVol(t.volume)}</span>
        </li>`;
      })
      .join('');
  }

  function renderGroups(list) {
    const map = new Map();
    list.forEach((t) => {
      const k = t.symbol || t.instrumentName;
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(t);
    });

    const groups = [...map.entries()].sort(
      (a, b) => score(b[1][0]) - score(a[1][0])
    );

    if (!groups.length) {
      el.groupsRoot.innerHTML = '<p class="sp-empty">No triggers for filters / date</p>';
      return;
    }

    el.groupsRoot.innerHTML = groups
      .map(([symbol, rows]) => {
        const sector = rows[0].instrumentSector || 'Others';
        const peak = rows.reduce(
          (m, r) => Math.max(m, Math.abs(r.changePercent)),
          0
        );
        const body = rows
          .map((t) => {
            const up = Number(t.changePercent) >= 0;
            const thin =
              Number(t.triggerEndPrice) < 2 || Number(t.volume) < 50000
                ? '<span class="sp-chip">Thin</span>'
                : '';
            return `<div class="sp-row ${t.optionType === 'CE' ? 'ce' : 'pe'}">
              <span class="sp-strike">${t.strikePrice}</span>
              <span class="sp-type ${t.optionType === 'CE' ? 'ce' : 'pe'}">${t.optionType}</span>
              <span class="sp-win">${fmtTime(t.triggerStartTime)}–${fmtTime(t.triggerEndTime)}</span>
              <span class="sp-px">${Number(t.triggerStartPrice).toFixed(2)}→${Number(t.triggerEndPrice).toFixed(2)}</span>
              <span class="sp-delta ${up ? 'up' : 'down'}">${up ? '+' : ''}${Number(t.changePercent).toFixed(2)}%</span>
              <span class="sp-vol">${fmtVol(t.volume)}</span>
              ${thin}
              <span>${sparkSVG(t.priceSequence, up)}</span>
            </div>`;
          })
          .join('');

        return `<article class="sp-symbol">
          <header class="sp-symbol-head">
            <div><span class="sp-symbol-name">${symbol}</span>
              <span class="sp-sector">${sector}</span></div>
            <div class="sp-counts">
              <span class="sp-chip">${rows.length} signals</span>
              <span class="sp-chip">peak ${peak.toFixed(1)}%</span>
            </div>
          </header>
          <div class="sp-symbol-body">${body}</div>
        </article>`;
      })
      .join('');
  }

  function renderAll() {
    const list = filteredItems();
    renderMetrics(list);
    renderTop5(list);
    renderGroups(list);
    el.loadedCount.textContent = `${state.items.length} / ${state.total} loaded`;
    const hasMore = state.items.length < state.total;
    el.btnLoadMore.hidden = !hasMore;
    el.btnLoadMore.textContent = hasMore
      ? `Load more (${state.items.length}/${state.total})`
      : '';
  }

  function fillSectors() {
    const set = new Set(
      state.items.map((t) => t.instrumentSector).filter(Boolean)
    );
    const cur = el.fSector.value;
    el.fSector.innerHTML =
      '<option value="">All</option>' +
      [...set]
        .sort()
        .map((s) => `<option value="${s}">${s}</option>`)
        .join('');
    if ([...set].includes(cur)) el.fSector.value = cur;
  }

  // ── Data load ──────────────────────────────────────────
  async function loadPage(reset) {
    if (!state.activeDate || state.loading) return;
    state.loading = true;
    el.btnLoadMore.disabled = true;
    el.status.textContent = 'Loading…';

    if (reset) {
      state.page = 1;
      state.items = [];
      state.total = 0;
    }

    try {
      const minChange = Number(el.fMinChange.value) || 5;
      const url =
        `${BASE}/api/admin/triggers?minChange=${minChange}` +
        `&limit=${PAGE_SIZE}&page=${state.page}` +
        `&date=${encodeURIComponent(state.activeDate)}`;

      const json = await adminFetch(url);
      const batch = json.data || [];
      state.total = json.total || 0;
      state.items = state.items.concat(batch);
      state.page += 1;

      fillSectors();
      renderAll();
      el.status.textContent = `ADMIN · ${state.activeDate}`;
    } catch (err) {
      el.status.textContent = err.message;
      el.groupsRoot.innerHTML = `<p class="sp-empty">${err.message}</p>`;
    } finally {
      state.loading = false;
      el.btnLoadMore.disabled = false;
    }
  }

  async function loadDates() {
    el.dateTabs.innerHTML = '';
    try {
      const minChange = Number(el.fMinChange.value) || 5;
      const json = await adminFetch(
        `${BASE}/api/admin/triggers/dates?minChange=${minChange}`
      );
      const dates = json.dates || [];
      if (!dates.length) {
        el.status.textContent = 'No days in DB';
        el.groupsRoot.innerHTML = '<p class="sp-empty">No triggers yet</p>';
        return;
      }

      dates.forEach((d, i) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'sp-date-tab' + (i === 0 ? ' active' : '');
        btn.textContent = `${d.date} (${d.count})`;
        btn.onclick = () => {
          document
            .querySelectorAll('.sp-date-tab')
            .forEach((t) => t.classList.remove('active'));
          btn.classList.add('active');
          state.activeDate = d.date;
          loadPage(true);
        };
        el.dateTabs.appendChild(btn);
      });

      state.activeDate = dates[0].date;
      await loadPage(true);
    } catch (err) {
      el.status.textContent = err.message;
      el.groupsRoot.innerHTML = `<p class="sp-empty">${err.message}</p>`;
    }
  }

  // ── Events ─────────────────────────────────────────────
  el.btnRefresh?.addEventListener('click', () => loadPage(true));
  el.btnLoadMore?.addEventListener('click', () => loadPage(false));
  el.btnClearKey?.addEventListener('click', () => {
    sessionStorage.removeItem('adminKey');
    location.reload();
  });

  el.btnRun?.addEventListener('click', async () => {
    try {
      el.status.textContent = 'Starting trigger job…';
      await adminFetch(`${BASE}/api/test/run-triggers`, {
        method: 'POST',
        body: JSON.stringify({})
      });
      el.status.textContent = 'Job started — check PM2 logs';
    } catch (err) {
      // run-triggers may not require admin key in your app
      try {
        const res = await fetch(`${BASE}/api/test/run-triggers`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}'
        });
        const json = await res.json();
        el.status.textContent = json.message || 'Job started';
      } catch (e2) {
        el.status.textContent = err.message;
      }
    }
  });

  ['change', 'input'].forEach((ev) => {
    el.fMinChange?.addEventListener(ev, () => renderAll());
    el.fMinVol?.addEventListener(ev, () => renderAll());
    el.fSector?.addEventListener(ev, () => renderAll());
    el.fType?.addEventListener(ev, () => renderAll());
    el.fSort?.addEventListener(ev, () => renderAll());
  });

  loadDates();
})();