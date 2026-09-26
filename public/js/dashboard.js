(() => {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const BASE = `${window.location.origin}/api`;
  const PAGE_SIZE = 200;

  const root = $('#groups-root');
  const statusEl = $('#status-text');
  const tabsEl = $('#date-tabs');
  const fMinChange = $('#f-min-change');
  const fMinVol = $('#f-min-vol');
  const fSector = $('#f-sector');
  const fType = $('#f-type');
  const fSort = $('#f-sort');
  const btnRefresh = $('#btn-refresh');

  const state = {
    dates: [],
    date: '',
    raw: [],
    delayDays: 30,
    minChange: 5,
    minVol: 0,
    sector: '',
    type: '',
    sort: 'score'
  };

  function tickClock() {
    try {
      const now = new Date();
      if ($('#ist-time')) {
        $('#ist-time').textContent = new Intl.DateTimeFormat('en-IN', {
          timeZone: 'Asia/Kolkata',
          hour12: false,
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        }).format(now);
      }
      const h = Number(
        new Intl.DateTimeFormat('en-IN', {
          timeZone: 'Asia/Kolkata',
          hour12: false,
          hour: 'numeric'
        }).format(now)
      );
      let win = 'Pre-market';
      if (h >= 9 && h < 10) win = 'Open drive';
      else if (h >= 10 && h < 13) win = 'Mid-morning';
      else if (h >= 13 && h < 15) win = 'Afternoon';
      else if (h >= 15 && h <= 16) win = 'Close drive';
      else if (h > 16) win = 'After hours';
      if ($('#ist-window')) $('#ist-window').textContent = win;
    } catch (_) {}
  }

  function fmtVol(v) {
    v = Number(v) || 0;
    if (v >= 1e7) return (v / 1e7).toFixed(2) + ' Cr';
    if (v >= 1e5) return (v / 1e5).toFixed(2) + ' L';
    if (v >= 1e3) return (v / 1e3).toFixed(1) + ' K';
    return String(v);
  }

  function fmtDelta(pct) {
    const n = Number(pct) || 0;
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }

  function fmtTime(iso) {
    if (!iso) return '--:--';
    try {
      return new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      }).format(new Date(iso));
    } catch (_) {
      return '--:--';
    }
  }

  function sessionDay(item) {
    const src = item.triggerEndTime || item.generatedTime;
    if (!src) return '';
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).format(new Date(src));
    } catch (_) {
      return '';
    }
  }

  function scoreOf(item) {
    const abs = Math.abs(Number(item.changePercent) || 0);
    const vol = Number(item.volume) || 0;
    return abs * Math.log10(Math.max(vol, 10));
  }

  function sparkSVG(seq, up) {
    const pts = Array.isArray(seq)
      ? seq.filter((n) => Number.isFinite(+n)).map(Number)
      : [];
    if (!pts.length || pts.every((p) => p === pts[0])) {
      return '<svg class="sp-spark" viewBox="0 0 120 28" preserveAspectRatio="none" aria-hidden="true"><path class="line" d="M0 14 H120"/></svg>';
    }
    const min = Math.min(...pts);
    const max = Math.max(...pts);
    const range = max - min || 1;
    const w = 120;
    const h = 28;
    const pad = 2;
    const step = pts.length > 1 ? w / (pts.length - 1) : w;
    let d = '';
    for (let i = 0; i < pts.length; i++) {
      const x = i * step;
      const y = h - pad - ((pts[i] - min) / range) * (h - pad * 2);
      d += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1) + ' ';
    }
    return `<svg class="sp-spark ${up ? 'up' : 'down'}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><path class="line" d="${d.trim()}"/></svg>`;
  }

  function fillSectors(rows) {
    if (!fSector) return;
    const current = fSector.value;
    const set = new Set(rows.map((r) => r.instrumentSector).filter(Boolean));
    fSector.innerHTML =
      '<option value="">All</option>' +
      [...set].sort().map((s) => `<option value="${s}">${s}</option>`).join('');
    fSector.value = current || '';
  }

  function renderDateTabs() {
    if (!tabsEl) return;
    const total = state.dates.reduce((s, d) => s + (Number(d.count) || 0), 0);
    const tabs = [{ date: '', count: total, label: `All public (${total})` }].concat(
      state.dates.map((d) => ({
        date: d.date,
        count: d.count,
        label: `${d.date} (${d.count})`
      }))
    );
    tabsEl.innerHTML = tabs
      .map(
        (t) =>
          `<button type="button" class="sp-date-tab${t.date === state.date ? ' active' : ''}" data-date="${t.date}">${t.label}</button>`
      )
      .join('');
    tabsEl.querySelectorAll('.sp-date-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.date = btn.getAttribute('data-date') || '';
        renderDateTabs();
        render(filtered());
      });
    });
  }

  function filtered() {
    return state.raw.filter((row) => {
      if (Math.abs(Number(row.changePercent) || 0) < state.minChange) return false;
      if ((Number(row.volume) || 0) < state.minVol) return false;
      if (state.sector && row.instrumentSector !== state.sector) return false;
      if (state.type && row.optionType !== state.type) return false;
      if (state.date && sessionDay(row) !== state.date) return false;
      return true;
    });
  }

  function sorted(rows) {
    const copy = rows.slice();
    if (state.sort === 'volume') {
      copy.sort((a, b) => (Number(b.volume) || 0) - (Number(a.volume) || 0));
    } else if (state.sort === 'time') {
      copy.sort(
        (a, b) =>
          new Date(b.triggerEndTime || b.generatedTime || 0) -
          new Date(a.triggerEndTime || a.generatedTime || 0)
      );
    } else if (state.sort === 'abs') {
      copy.sort(
        (a, b) =>
          Math.abs(Number(b.changePercent) || 0) -
          Math.abs(Number(a.changePercent) || 0)
      );
    } else {
      copy.sort((a, b) => scoreOf(b) - scoreOf(a));
    }
    return copy;
  }

  function render(rows) {
    const list = sorted(rows);
    const symbols = new Set(list.map((r) => r.symbol || r.instrumentName));
    const ce = list.filter((r) => r.optionType === 'CE').length;
    const pe = list.filter((r) => r.optionType === 'PE').length;
    const vol = list.reduce((s, r) => s + (Number(r.volume) || 0), 0);

    if ($('#m-symbols')) $('#m-symbols').textContent = String(symbols.size);
    if ($('#m-triggers')) $('#m-triggers').textContent = String(list.length);
    if ($('#m-volume')) $('#m-volume').textContent = fmtVol(vol);
    if ($('#m-ce')) $('#m-ce').textContent = String(ce);
    if ($('#m-pe')) $('#m-pe').textContent = String(pe);

    const top = $('#top-list');
    if (top) {
      top.innerHTML = list
        .slice(0, 5)
        .map((item, i) => {
          const up = Number(item.changePercent) >= 0;
          const kind = String(item.optionType || '').toLowerCase();
          return `<li class="sp-top-item">
            <span class="sp-rank">${i + 1}</span>
            <span>
              <strong>${item.symbol}</strong>
              <span class="sp-badge ${kind}">${item.optionType}</span>
              <span>${item.strikePrice}</span>
            </span>
            <span class="sp-chg ${up ? 'up' : 'down'}">${fmtDelta(item.changePercent)}</span>
            ${sparkSVG(item.priceSequence, up)}
          </li>`;
        })
        .join('');
    }

    if (!root) return;
    if (!list.length) {
      root.innerHTML = '<p class="sp-empty">No public triggers for this filter.</p>';
    } else {
      const groups = {};
      for (const item of list) {
        const key = item.symbol || item.instrumentName || 'UNKNOWN';
        if (!groups[key]) groups[key] = [];
        groups[key].push(item);
      }
      root.innerHTML = Object.keys(groups)
        .sort()
        .map((symbol) => {
          const items = groups[symbol];
          const rowsHtml = items
            .map((item) => {
              const up = Number(item.changePercent) >= 0;
              const kind = String(item.optionType || '').toLowerCase();
              return `<div class="sp-row">
                <span>${item.strikePrice}</span>
                <span class="sp-badge ${kind}">${item.optionType}</span>
                <span>${fmtTime(item.triggerStartTime)}–${fmtTime(item.triggerEndTime)}</span>
                <span>${Number(item.triggerStartPrice).toFixed(2)} → ${Number(item.triggerEndPrice).toFixed(2)}</span>
                <span class="sp-chg-pill ${up ? 'up' : 'down'}">${fmtDelta(item.changePercent)}</span>
                <span>${fmtVol(item.volume)}</span>
                ${sparkSVG(item.priceSequence, up)}
              </div>`;
            })
            .join('');
          return `<section class="sp-group">
            <h3>${symbol} <small>${items[0].instrumentSector || ''}</small></h3>
            <div class="sp-rows">${rowsHtml}</div>
          </section>`;
        })
        .join('');
    }

    if (statusEl) {
      const days = state.dates.map((d) => d.date).join(', ') || 'none';
      statusEl.textContent = `Public archive · ${state.delayDays}-day delay · showing ${list.length} of ${state.raw.length} · ${days}`;
    }
  }

  async function fetchJson(url) {
    const res = await fetch(url);
    const json = await res.json();
    if (!json.status) throw new Error(json.message || url);
    return json;
  }

  async function fetchAllPages(date) {
    const rows = [];
    let page = 1;
    let total = Infinity;
    while ((page - 1) * PAGE_SIZE < total) {
      const qs = new URLSearchParams({
        minChange: String(state.minChange),
        limit: String(PAGE_SIZE),
        page: String(page)
      });
      if (date) qs.set('date', date);
      const json = await fetchJson(`${BASE}/triggers?${qs.toString()}`);
      const batch = json.data || [];
      total = Number(json.total != null ? json.total : batch.length);
      rows.push(...batch);
      if (!batch.length) break;
      page += 1;
      if (page > 50) break;
    }
    return rows;
  }

  async function loadAllPublicTriggers() {
    if (statusEl) statusEl.textContent = 'Loading public archive…';
    const datesJson = await fetchJson(
      `${BASE}/triggers/dates?minChange=${encodeURIComponent(state.minChange)}`
    );
    state.delayDays = datesJson.delayDays || 30;
    state.dates = datesJson.dates || [];
    renderDateTabs();

    const all = [];
    for (const day of state.dates) {
      if (statusEl) statusEl.textContent = `Loading ${day.date}…`;
      all.push(...(await fetchAllPages(day.date)));
    }

    const seen = new Set();
    state.raw = all.filter((row) => {
      const id = String(row._id || `${row.symbol}-${row.strikePrice}-${row.triggerEndTime}`);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });

    fillSectors(state.raw);
    render(filtered());
  }

  function readFilters() {
    state.minChange = Number(fMinChange && fMinChange.value) || 5;
    state.minVol = Number(fMinVol && fMinVol.value) || 0;
    state.sector = (fSector && fSector.value) || '';
    state.type = (fType && fType.value) || '';
    state.sort = (fSort && fSort.value) || 'score';
  }

  async function boot() {
    tickClock();
    setInterval(tickClock, 1000);
    try {
      readFilters();
      await loadAllPublicTriggers();
    } catch (err) {
      if (statusEl) statusEl.textContent = 'Could not load triggers: ' + err.message;
    }
  }

  if (btnRefresh) {
    btnRefresh.addEventListener('click', async () => {
      readFilters();
      try {
        await loadAllPublicTriggers();
      } catch (err) {
        if (statusEl) statusEl.textContent = err.message;
      }
    });
  }

  [fMinChange, fMinVol, fSector, fType, fSort].forEach((el) => {
    if (!el) return;
    el.addEventListener('change', () => {
      readFilters();
      render(filtered());
    });
  });

  boot();
})();
