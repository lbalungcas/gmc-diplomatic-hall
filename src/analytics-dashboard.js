import boothsData from './data/booths.json';

const TOKEN_KEY = 'yim_analytics_token';
const LOCAL_DEFAULT_TOKEN = 'gmc-dev';

const boothNames = Object.fromEntries(
  (Array.isArray(boothsData) ? boothsData : []).map((b) => [Number(b.id), b.name || `Booth ${b.id}`])
);

let lastData = null;
let lastFetchMs = 0;
let selectedTrendMetric = 'pageViews';

const TREND_METRICS = [
  { key: 'pageViews', label: 'Page views', color: '#5b9bd5' },
  { key: 'opens', label: 'Booth opens', color: '#4fa69c' },
  { key: 'intros', label: 'Intro watches', color: '#f4b400' },
  { key: 'quizPlays', label: 'Quiz plays', color: '#e2603c' },
  { key: 'quizPasses', label: 'Quiz passes', color: '#e2603c' },
  { key: 'passports', label: 'Passport badges', color: '#a78bfa' },
];

function resolveAnalyticsBase() {
  const configured = import.meta.env?.VITE_ANALYTICS_URL || import.meta.env?.VITE_WS_URL;
  if (configured) {
    const base = String(configured).replace(/\/+$/, '').replace(/\/presence$/, '');
    return base.replace(/^ws/i, 'http');
  }
  return '';
}

function getToken() {
  const fromQuery = new URLSearchParams(window.location.search).get('token');
  if (fromQuery) { sessionStorage.setItem(TOKEN_KEY, fromQuery); return fromQuery; }
  const stored = sessionStorage.getItem(TOKEN_KEY);
  if (stored != null) return stored;
  return LOCAL_DEFAULT_TOKEN;
}

function setToken(token) {
  sessionStorage.setItem(TOKEN_KEY, token);
  if (els.tokenInput) els.tokenInput.value = token;
}

const els = {
  status: document.getElementById('status'),
  statusText: document.getElementById('statusText') || document.getElementById('status'),
  liveDot: document.getElementById('liveDot'),
  cards: document.getElementById('cards'),
  trendPanel: document.getElementById('trendPanel'),
  trendPills: document.getElementById('trendPills'),
  trendChart: document.getElementById('trendChart'),
  trendNote: document.getElementById('trendNote'),
  countriesPanel: document.getElementById('countriesPanel'),
  countriesChart: document.getElementById('countriesChart'),
  countriesPie: document.getElementById('countriesPie'),
  countriesNote: document.getElementById('countriesNote'),
  sparkPageViews: document.getElementById('sparkPageViews'),
  sparkOpens: document.getElementById('sparkOpens'),
  boothPanel: document.getElementById('boothPanel'),
  commentPanel: document.getElementById('commentPanel'),
  boothRows: document.getElementById('boothRows'),
  boothEmpty: document.getElementById('boothEmpty'),
  recent: document.getElementById('recentComments'),
  onlineNow: document.getElementById('onlineNow'),
  peak: document.getElementById('peak'),
  pageViews: document.getElementById('pageViews'),
  uniques: document.getElementById('uniques'),
  opens: document.getElementById('opens'),
  tokenInput: document.getElementById('tokenInput'),
  exportPdf: document.getElementById('exportPdf'),
  exportJson: document.getElementById('exportJson'),
};

if (els.tokenInput) els.tokenInput.value = getToken();

function setStatus(text, { live = false } = {}) {
  if (els.statusText) els.statusText.textContent = text;
  else if (els.status) els.status.textContent = text;
  if (els.liveDot) els.liveDot.hidden = !live;
}

function relativeTime(ts) {
  if (!ts) return '';
  const diff = Math.max(0, Math.floor((Date.now() - new Date(ts).getTime()) / 1000));
  if (diff < 5) return 'just now';
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

let relativeTimerHandle = 0;
function startRelativeTimer() {
  clearInterval(relativeTimerHandle);
  relativeTimerHandle = setInterval(() => {
    if (!lastData) return;
    const when = relativeTime(lastData.generatedAt || lastFetchMs);
    const base = resolveAnalyticsBase() || window.location.origin;
    setStatus(`Updated ${when} · ${base}`, { live: true });
  }, 1000);
}

async function fetchAnalytics(token) {
  const base = resolveAnalyticsBase();
  const qs = token ? `?token=${encodeURIComponent(token)}` : '';
  const url = `${base}/analytics${qs}`;
  const res = await fetch(url);
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  return { res, data, base, url };
}

function failureHint(err, url) {
  return [
    `Could not load analytics: ${err.message}`,
    `Tried ${url || '/analytics'}`,
    'Is the presence server running? Locally use npm run dev and token gmc-dev.',
    'Production builds need VITE_WS_URL or VITE_ANALYTICS_URL pointing at the presence host.',
  ].join(' ');
}

function passPct(plays, passes) {
  const p = Number(plays) || 0;
  if (!p) return '—';
  return `${Math.round((100 * (Number(passes) || 0)) / p)}%`;
}

async function load() {
  setStatus('Loading…', { live: false });
  let lastUrl = '';

  try {
    let token = getToken();
    let { res, data, base, url } = await fetchAnalytics(token);
    lastUrl = url;

    if (res.status === 401 && token) {
      ({ res, data, base, url } = await fetchAnalytics(''));
      lastUrl = url;
      if (res.ok && data?.ok) { setToken(''); token = ''; }
    }

    if (!res.ok || !data?.ok) {
      const reason = data?.error || (data == null ? 'non-JSON response (is presence up?)' : `HTTP ${res.status}`);
      if (res.status === 401) throw new Error(`${reason} — save a token below (local default is gmc-dev)`);
      throw new Error(reason);
    }

    lastData = data;
    lastFetchMs = Date.now();
    render(data);
    showExportButtons(true);
    startRelativeTimer();
    const when = relativeTime(data.generatedAt || lastFetchMs);
    const source = base || window.location.origin;
    setStatus(`Updated ${when} · ${source}`, { live: true });
  } catch (err) {
    setStatus(failureHint(err, lastUrl), { live: false });
    els.cards.hidden = true;
    if (els.trendPanel) els.trendPanel.hidden = true;
    if (els.countriesPanel) els.countriesPanel.hidden = true;
    els.boothPanel.hidden = true;
    els.commentPanel.hidden = true;
    showExportButtons(false);
  }
}

function showExportButtons(show) {
  if (els.exportPdf) els.exportPdf.hidden = !show;
  if (els.exportJson) els.exportJson.hidden = !show;
}

function render(data) {
  els.cards.hidden = false;
  els.boothPanel.hidden = false;
  els.commentPanel.hidden = false;
  if (els.trendPanel) els.trendPanel.hidden = false;
  if (els.countriesPanel) els.countriesPanel.hidden = false;

  els.onlineNow.textContent = fmt(data.onlineNow);
  els.peak.textContent = fmt(data.peakConcurrent);
  if (els.pageViews) els.pageViews.textContent = fmt(data.pageViews);
  els.uniques.textContent = fmt(data.uniqueVisitors);
  els.opens.textContent = fmt(data.totalOpens);

  renderTrendPills();
  renderTrend(data);
  renderSparklines(data);
  renderCountries(data);
  renderBoothTable(data);
  renderComments(data);
}

function fmt(v) { return String(v ?? 0); }

function trendMetricConfig(key) {
  return TREND_METRICS.find((m) => m.key === key) || TREND_METRICS[0];
}

function renderTrendPills() {
  const el = els.trendPills;
  if (!el) return;
  el.innerHTML = TREND_METRICS.map((m) => (
    `<button type="button" class="trend-pill${m.key === selectedTrendMetric ? ' is-active' : ''}" role="tab" aria-selected="${m.key === selectedTrendMetric}" data-metric="${m.key}">${escapeHtml(m.label)}</button>`
  )).join('');
}

function initTrendPills() {
  els.trendPills?.addEventListener('click', (e) => {
    const btn = e.target.closest('.trend-pill');
    if (!btn?.dataset.metric) return;
    selectedTrendMetric = btn.dataset.metric;
    renderTrendPills();
    if (lastData) renderTrend(lastData);
  });
  renderTrendPills();
}

function niceMax(n) {
  if (n <= 0) return 1;
  const exp = 10 ** Math.floor(Math.log10(n));
  const m = n / exp;
  const nice = m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10;
  return nice * exp;
}

function trendPoints(series, key, innerW, innerH, padL, padT, max) {
  const n = series.length;
  return series.map((d, i) => {
    const v = Number(d[key]) || 0;
    const x = padL + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
    const y = padT + innerH - (v / max) * innerH;
    return { x, y, v, date: d.date };
  });
}

function renderTrend(data) {
  const el = els.trendChart;
  if (!el) return;
  const series = Array.isArray(data.trend) ? data.trend : [];
  const metric = trendMetricConfig(selectedTrendMetric);
  if (!series.length) {
    if (els.trendNote) {
      els.trendNote.textContent = 'No 30-day series yet — set DATABASE_URL on the presence host (Neon). Totals above still come from JSON counters.';
    }
    el.innerHTML = '<p class="trend-empty">Trend unavailable until Neon is connected.</p>';
    return;
  }

  const values = series.map((d) => Number(d[metric.key]) || 0);
  const max = niceMax(Math.max(1, ...values));
  const w = 960;
  const h = 220;
  const padL = 40;
  const padR = 16;
  const padT = 16;
  const padB = 28;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;
  const pts = trendPoints(series, metric.key, innerW, innerH, padL, padT, max);
  const baseline = padT + innerH;
  const lineD = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const areaD = `${lineD} L${pts[pts.length - 1].x.toFixed(1)} ${baseline} L${pts[0].x.toFixed(1)} ${baseline} Z`;

  const yTicks = [0, max / 2, max];
  const grid = yTicks.map((t) => {
    const y = padT + innerH - (t / max) * innerH;
    const label = Number.isInteger(t) ? String(t) : t.toFixed(1);
    return `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${w - padR}" y2="${y.toFixed(1)}" stroke="#243152" stroke-width="1"/>`
      + `<text x="${padL - 6}" y="${(y + 3).toFixed(1)}" fill="#9aa8c7" font-size="10" font-family="IBM Plex Mono, monospace" text-anchor="end">${escapeHtml(label)}</text>`;
  }).join('');

  const xIdx = [...new Set([0, Math.floor((series.length - 1) / 3), Math.floor(((series.length - 1) * 2) / 3), series.length - 1])];
  const xLabels = xIdx.map((i) => {
    const p = pts[i];
    const label = String(series[i].date || '').slice(5);
    return `<text x="${p.x.toFixed(1)}" y="${h - 8}" fill="#9aa8c7" font-size="10" font-family="IBM Plex Mono, monospace" text-anchor="middle">${escapeHtml(label)}</text>`;
  }).join('');

  const dots = pts.map((p) => {
    const title = `${p.date}: ${p.v} ${metric.label.toLowerCase()}`;
    return `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.2" fill="#4fa69c" stroke="#0b1226" stroke-width="1.5"><title>${escapeHtml(title)}</title></circle>`;
  }).join('');

  const first = series[0]?.date || '';
  const last = series[series.length - 1]?.date || '';
  if (els.trendNote) {
    els.trendNote.textContent = `${metric.label} by day (UTC) · ${first} → ${last}`;
  }

  el.innerHTML = `<svg class="trend-svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="${escapeHtml(metric.label)} over the last 30 days">
    <defs>
      <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#f4b400" stop-opacity="0.32"/>
        <stop offset="100%" stop-color="#f4b400" stop-opacity="0"/>
      </linearGradient>
    </defs>
    ${grid}
    <path d="${areaD}" fill="url(#trendFill)"/>
    <path d="${lineD}" fill="none" stroke="#4fa69c" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>
    ${dots}
    ${xLabels}
  </svg>`;
}

function sparklineSvg(values, color) {
  const w = 96;
  const h = 28;
  const pad = 2;
  const series = Array.isArray(values) && values.length ? values : [0, 0];
  const max = Math.max(1, ...series.map((v) => Number(v) || 0));
  const n = series.length;
  const pts = series.map((raw, i) => {
    const v = Number(raw) || 0;
    const x = pad + (n === 1 ? (w - pad * 2) / 2 : (i / (n - 1)) * (w - pad * 2));
    const y = pad + (h - pad * 2) - (v / max) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return `<svg class="spark-svg" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" points="${pts}"/></svg>`;
}

function renderSparklines(data) {
  const series = Array.isArray(data.trend) ? data.trend : [];
  const pick = (key) => series.map((d) => Number(d[key]) || 0);
  const slots = [
    [els.sparkPageViews, pick('pageViews'), '#4fa69c'],
    [els.sparkOpens, pick('opens'), '#4fa69c'],
  ];
  for (const [el, values, color] of slots) {
    if (!el) continue;
    el.innerHTML = sparklineSvg(values, color);
  }
}

const PIE_COLORS = ['#4fa69c', '#f4b400', '#e2603c', '#5b9bd5', '#a78bfa', '#7eb8a8', '#6b7a99'];

function polar(cx, cy, r, angleDeg) {
  const a = ((angleDeg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

function donutSlice(cx, cy, rInner, rOuter, startDeg, endDeg) {
  const sweep = endDeg - startDeg;
  if (sweep <= 0.02) return '';
  if (sweep >= 359.99) {
    const [ox1, oy1] = polar(cx, cy, rOuter, 0);
    const [ox2, oy2] = polar(cx, cy, rOuter, 180);
    const [ix1, iy1] = polar(cx, cy, rInner, 180);
    const [ix2, iy2] = polar(cx, cy, rInner, 0);
    return `M${ox1.toFixed(2)} ${oy1.toFixed(2)} A${rOuter} ${rOuter} 0 1 1 ${ox2.toFixed(2)} ${oy2.toFixed(2)} A${rOuter} ${rOuter} 0 1 1 ${ox1.toFixed(2)} ${oy1.toFixed(2)} L${ix2.toFixed(2)} ${iy2.toFixed(2)} A${rInner} ${rInner} 0 1 0 ${ix1.toFixed(2)} ${iy1.toFixed(2)} A${rInner} ${rInner} 0 1 0 ${ix2.toFixed(2)} ${iy2.toFixed(2)} Z`;
  }
  const large = sweep > 180 ? 1 : 0;
  const [ox1, oy1] = polar(cx, cy, rOuter, startDeg);
  const [ox2, oy2] = polar(cx, cy, rOuter, endDeg);
  const [ix1, iy1] = polar(cx, cy, rInner, endDeg);
  const [ix2, iy2] = polar(cx, cy, rInner, startDeg);
  return `M${ox1.toFixed(2)} ${oy1.toFixed(2)} A${rOuter} ${rOuter} 0 ${large} 1 ${ox2.toFixed(2)} ${oy2.toFixed(2)} L${ix1.toFixed(2)} ${iy1.toFixed(2)} A${rInner} ${rInner} 0 ${large} 0 ${ix2.toFixed(2)} ${iy2.toFixed(2)} Z`;
}

function renderCountries(data) {
  const el = els.countriesChart;
  const pieEl = els.countriesPie;
  const split = el?.closest('.countries-split');
  if (!el) return;
  const rows = Array.isArray(data.countries) ? data.countries.slice(0, 15) : [];
  if (split) split.classList.toggle('is-empty', !rows.length);
  if (!rows.length) {
    if (els.countriesNote) {
      els.countriesNote.textContent = 'Distinct hall visitors by country (from IP, approximate). Data appears after Neon is connected and visitors arrive.';
    }
    el.innerHTML = '<p class="countries-empty">No country data yet — visits after deploy will populate this panel.</p>';
    if (pieEl) {
      pieEl.hidden = true;
      pieEl.innerHTML = '';
    }
    return;
  }

  const max = Math.max(1, ...rows.map((r) => Number(r.visitors) || 0));
  if (els.countriesNote) {
    els.countriesNote.textContent = `Top ${rows.length} countries · distinct hall visitors (approximate from IP)`;
  }
  el.innerHTML = rows.map((r, i) => {
    const pct = Math.round(((Number(r.visitors) || 0) / max) * 100);
    const label = r.name || r.code || 'Unknown';
    const color = PIE_COLORS[i % PIE_COLORS.length];
    return `<div class="country-row"><span class="country-swatch" style="background:${color}"></span><span class="country-name" title="${escapeHtml(r.code || '')}">${escapeHtml(label)}</span><div class="country-bar-wrap"><div class="country-bar" style="width:${pct}%;background:${color}"></div></div><span class="country-count">${Number(r.visitors) || 0}</span></div>`;
  }).join('');

  if (pieEl) {
    pieEl.hidden = false;
    pieEl.innerHTML = countriesPieSvg(rows);
  }
}

function countriesPieSvg(rows) {
  const total = rows.reduce((sum, r) => sum + (Number(r.visitors) || 0), 0);
  if (!total) return '';
  const top = rows.slice(0, 6);
  const rest = rows.slice(6).reduce((sum, r) => sum + (Number(r.visitors) || 0), 0);
  const slices = top.map((r, i) => ({
    label: r.name || r.code || 'Unknown',
    visitors: Number(r.visitors) || 0,
    color: PIE_COLORS[i],
  }));
  if (rest > 0) slices.push({ label: 'Other', visitors: rest, color: PIE_COLORS[6] });

  const cx = 90;
  const cy = 90;
  const rOuter = 78;
  const rInner = 44;
  let angle = 0;
  const paths = slices.map((s) => {
    const sweep = (s.visitors / total) * 360;
    const start = angle;
    const end = angle + sweep;
    angle = end;
    const d = donutSlice(cx, cy, rInner, rOuter, start, end);
    if (!d) return '';
    const pct = Math.round((s.visitors / total) * 100);
    return `<path d="${d}" fill="${s.color}"><title>${escapeHtml(`${s.label}: ${s.visitors} (${pct}%)`)}</title></path>`;
  }).join('');

  const legend = slices.map((s) => {
    const pct = Math.round((s.visitors / total) * 100);
    return `<div class="pie-legend-row"><span class="country-swatch" style="background:${s.color}"></span><span>${escapeHtml(s.label)}</span><span class="country-count">${pct}%</span></div>`;
  }).join('');

  return `<svg class="pie-svg" viewBox="0 0 180 180" role="img" aria-label="Visitor countries">${paths}<text x="${cx}" y="${cy - 4}" text-anchor="middle" fill="#e8eefc" font-size="18" font-family="Space Grotesk, sans-serif" font-weight="700">${total}</text><text x="${cx}" y="${cy + 14}" text-anchor="middle" fill="#9aa8c7" font-size="9" font-family="IBM Plex Mono, monospace">visitors</text></svg><div class="pie-legend">${legend}</div>`;
}

function renderBoothTable(data) {
  els.boothRows.innerHTML = '';
  const booths = data.booths || {};
  const ids = Object.keys(booths).map(Number).sort((a, b) => {
    const diff = (Number(booths[b]?.opens) || 0) - (Number(booths[a]?.opens) || 0);
    return diff || a - b;
  });

  const anyOpens = ids.some((id) => (Number(booths[id]?.opens) || 0) > 0);
  if (els.boothEmpty) els.boothEmpty.hidden = anyOpens;
  const tableWrap = els.boothRows?.closest('.table-wrap');
  if (tableWrap) tableWrap.hidden = !anyOpens;

  if (!anyOpens) return;

  ids.forEach((id, rank) => {
    const row = booths[id];
    const tr = document.createElement('tr');
    if (rank < 3) tr.classList.add('row-top');
    const name = boothNames[id] || `Booth ${String(id).padStart(2, '0')}`;
    const plays = Number(row.quizPlays) || 0;
    const passes = Number(row.quizPasses) || 0;
    tr.innerHTML = `
      <td>${rank + 1}</td>
      <td>${String(id).padStart(2, '0')}</td>
      <td>${escapeHtml(name)}</td>
      <td>${row.opens || 0}</td>
      <td>${row.introPlays || 0}</td>
      <td>${plays}</td>
      <td>${passes}</td>
      <td>${passPct(plays, passes)}</td>
      <td>${row.hearts || 0}</td>
      <td>${row.comments || 0}</td>
    `;
    els.boothRows.appendChild(tr);
  });
}

function renderComments(data) {
  els.recent.innerHTML = '';
  const comments = Array.isArray(data.recentComments) ? data.recentComments : [];

  if (!comments.length) {
    els.recent.innerHTML = '<p class="comment-empty">No comments yet.</p>';
    return;
  }

  comments.forEach((c) => {
    const boothNum = String(c.boothId ?? '').padStart(2, '0');
    const name = boothNames[Number(c.boothId)] || `Booth ${boothNum}`;
    const ago = relativeTime(c.ts);
    const visitor = escapeHtml(c.name || 'Visitor');

    const card = document.createElement('div');
    card.className = 'comment-card';
    card.innerHTML = `
      <div class="comment-badge">${boothNum}</div>
      <div class="comment-body">
        <div class="comment-meta">${escapeHtml(name)} · ${visitor}${ago ? ` · ${ago}` : ''}</div>
        <p class="comment-text"></p>
      </div>
    `;
    card.querySelector('.comment-text').textContent = c.text || '';
    els.recent.appendChild(card);
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/* ---------- Export ---------- */

function todayStamp() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function nowStamp() {
  const d = new Date();
  return `${todayStamp()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 200);
}

function exportJson() {
  if (!lastData) return;
  const blob = new Blob([JSON.stringify(lastData, null, 2)], { type: 'application/json' });
  downloadBlob(blob, `yim-analytics-${todayStamp()}.json`);
}

const COL = {
  bg: [11, 18, 38],
  panel: [18, 27, 51],
  line: [36, 49, 82],
  text: [232, 238, 252],
  muted: [154, 168, 199],
  yellow: [244, 180, 0],
  teal: [79, 166, 156],
  danger: [226, 96, 60],
  white: [255, 255, 255],
};

async function exportPdf() {
  if (!lastData) return;

  const jsPDFModule = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;
  const { jsPDF } = jsPDFModule;

  const d = lastData;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const margin = 16;
  const usableW = W - margin * 2;
  const genStamp = nowStamp();
  // Reserve space at the bottom for the footer so content never overlaps/cuts off.
  const footerReserve = 12;
  const contentMaxY = H - footerReserve;

  function bg() {
    doc.setFillColor(...COL.bg);
    doc.rect(0, 0, W, H, 'F');
  }

  function drawGoldBar() {
    doc.setFillColor(...COL.yellow);
    doc.rect(0, 0, W, 4, 'F');
  }

  function footer(pageNum, totalPages) {
    doc.setFontSize(7);
    doc.setTextColor(...COL.muted);
    doc.text(
      `YIM Analytics  ·  Page ${pageNum} of ${totalPages}  ·  Generated ${genStamp}`,
      W / 2, H - 8, { align: 'center' }
    );
  }

  function statCard(x, y, w, h, value, label, accent) {
    doc.setFillColor(...COL.panel);
    doc.roundedRect(x, y, w, h, 2, 2, 'F');
    doc.setFillColor(...accent);
    doc.rect(x, y, 3, h, 'F');

    doc.setFontSize(18);
    doc.setTextColor(...COL.white);
    doc.text(String(value ?? 0), x + 9, y + 12);

    doc.setFontSize(7);
    doc.setTextColor(...COL.muted);
    const labelLines = doc.splitTextToSize(String(label ?? ''), w - 10);
    doc.text(labelLines, x + 6, y + h - 5);
  }

  function groupHeader(y, title, accent) {
    doc.setFillColor(...accent);
    doc.rect(margin, y, usableW, 7, 'F');
    doc.setTextColor(...COL.white);
    doc.setFontSize(9);
    doc.text(String(title).toUpperCase(), margin + 8, y + 5.5);
    return y + 10;
  }

  function renderGroup(y, title, items, accent) {
    // items: [{ value, label }]
    let cursorY = groupHeader(y, title, accent);
    const cols = 2;
    const gap = 6;
    const cardW = (usableW - gap) / 2;
    const cardH = 26;
    const rowH = cardH + 5;
    const rows = Math.ceil(items.length / cols);

    for (let i = 0; i < items.length; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = margin + col * (cardW + gap);
      const cy = cursorY + row * rowH;
      const it = items[i];
      statCard(x, cy, cardW, cardH, it.value, it.label, accent);
    }
    return cursorY + rows * rowH;
  }

  function mostVisitedBooth() {
    const booths = d.booths || {};
    const ids = Object.keys(booths).map(Number);
    if (!ids.length) return null;
    ids.sort((a, b) => (Number(booths[b]?.opens) || 0) - (Number(booths[a]?.opens) || 0));
    const id = ids[0];
    return { id, name: boothNames[id] || `Booth ${String(id).padStart(2, '0')}`, opens: Number(booths[id]?.opens) || 0 };
  }

  const booths = d.booths || {};
  const mvp = mostVisitedBooth();
  const totalOpens = Number(d.totalOpens) || 0;
  const totalHearts = Number(d.totalHearts) || 0;
  const engagementRate = totalOpens > 0 ? (100 * totalHearts) / totalOpens : 0;

  // ---------------- Page 1: Cover + Summary (compact, footer-safe) ----------------
  bg();
  drawGoldBar();

  doc.setFontSize(8);
  doc.setTextColor(...COL.yellow);
  doc.text('YOUTH INNOVATIONS MARKETPLACE', margin, 20);

  doc.setFontSize(20);
  doc.setTextColor(...COL.white);
  doc.text('Analytics Report', margin, 31);

  doc.setFontSize(9);
  doc.setTextColor(...COL.muted);
  doc.text(`Generated ${genStamp}`, margin, 40);

  doc.setDrawColor(...COL.line);
  doc.setLineWidth(0.3);
  doc.line(margin, 46, W - margin, 46);

  function renderKVSection(y, title, items, accent) {
    doc.setFillColor(...accent);
    doc.rect(margin, y, usableW, 6, 'F');
    doc.setTextColor(...COL.white);
    doc.setFontSize(8.5);
    doc.text(String(title).toUpperCase(), margin + 8, y + 4.6);
    y += 10;

    const cols = 2;
    const gapX = 10;
    const colW = (usableW - gapX) / 2;
    const rowH = 6.2;
    const rows = Math.ceil(items.length / cols);

    doc.setTextColor(...COL.muted);
    doc.setFontSize(8);
    items.forEach((it, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const x = margin + col * (colW + gapX);
      const vy = y + row * rowH;
      doc.text(String(it.label), x, vy);

      doc.setTextColor(...accent);
      doc.setFontSize(11);
      doc.text(String(it.value ?? 0), x, vy + 4.2);

      doc.setTextColor(...COL.muted);
      doc.setFontSize(8);
    });

    return y + rows * rowH + 7;
  }

  let y = 52;
  y = renderKVSection(
    y,
    'Hall Traffic',
    [
      { value: d.onlineNow, label: 'Online now' },
      { value: d.peakConcurrent, label: 'Peak concurrent' },
      { value: d.pageViews, label: 'Page loads' },
      { value: d.uniqueVisitors, label: 'Unique visitors' },
      { value: d.totalOpens, label: 'Impressions' },
    ],
    COL.teal
  );

  y = renderKVSection(
    y,
    'Engagement',
    [
      { value: d.totalHearts, label: 'Hearts' },
      { value: d.totalComments, label: 'Comments' },
      { value: d.totalIntroPlays, label: 'Intro watches' },
    ],
    COL.yellow
  );

  y = renderKVSection(
    y,
    'Learning / Passport',
    [
      { value: d.totalQuizPlays, label: 'Quiz plays' },
      { value: d.totalQuizPasses, label: 'Quiz passes' },
      { value: d.passportCompletions, label: 'Passport badges' },
    ],
    COL.danger
  );

  // Key highlights: compact lines, clamped to footer-safe space.
  if (y > contentMaxY - 24) y = contentMaxY - 24;
  doc.setDrawColor(...COL.line);
  doc.setLineWidth(0.2);
  doc.line(margin, y, W - margin, y);

  doc.setTextColor(...COL.yellow);
  doc.setFontSize(9);
  doc.text('Key highlights', margin, y + 6);

  doc.setTextColor(...COL.muted);
  doc.setFontSize(8);
  const highlight1 = `Total impressions: ${totalOpens}`;
  const highlight2 = `Most visited: ${mvp ? `${String(mvp.id).padStart(2, '0')} — ${mvp.name}` : '—'}`;
  const highlight3 = `Engagement rate: ${engagementRate.toFixed(1)}%`;
  doc.text(highlight1, margin, y + 12);
  doc.text(highlight2, margin, y + 17.2);
  doc.text(highlight3, margin, y + 22.4);

  const trend = Array.isArray(d.trend) ? d.trend : [];
  const pdfMetric = trendMetricConfig(selectedTrendMetric);
  if (trend.length) {
    const chartY = y + 28;
    const chartH = 32;
    if (chartY + chartH < contentMaxY) {
      doc.setTextColor(...COL.yellow);
      doc.setFontSize(8);
      doc.text(`${pdfMetric.label} · last 30 days (UTC)`, margin, chartY);
      const values = trend.map((row) => Number(row[pdfMetric.key]) || 0);
      const max = Math.max(1, ...values);
      const barGap = 0.4;
      const barW = Math.max(0.8, usableW / trend.length - barGap);
      const baseY = chartY + 4;
      trend.forEach((row, i) => {
        const v = Number(row[pdfMetric.key]) || 0;
        const bh = (v / max) * chartH;
        const x = margin + i * (usableW / trend.length);
        doc.setFillColor(...COL.teal);
        doc.rect(x, baseY + chartH - bh, barW, Math.max(0.4, bh), 'F');
      });
      doc.setTextColor(...COL.muted);
      doc.setFontSize(7);
      doc.text(String(trend[0].date || '').slice(5), margin, baseY + chartH + 6);
      doc.text(String(trend[trend.length - 1].date || '').slice(5), W - margin, baseY + chartH + 6, { align: 'right' });
    }
  }

  const countries = Array.isArray(d.countries) ? d.countries.slice(0, 10) : [];
  if (countries.length && y + 70 < contentMaxY) {
    let cy = y + (trend.length ? 72 : 28);
    if (cy > contentMaxY - 40) cy = contentMaxY - 40;
    doc.setTextColor(...COL.yellow);
    doc.setFontSize(8);
    doc.text('Visitor countries (top 10)', margin, cy);
    autoTable(doc, {
      startY: cy + 3,
      margin: { left: margin, right: margin },
      head: [['Country', 'Visitors']],
      body: countries.map((c) => [c.name || c.code || 'Unknown', String(c.visitors || 0)]),
      theme: 'plain',
      styles: { fontSize: 7.5, cellPadding: 1.5, textColor: COL.text },
      headStyles: { fillColor: COL.panel, textColor: COL.yellow, fontSize: 7.5 },
      alternateRowStyles: { fillColor: [14, 22, 44] },
    });
  }

  // ---------------- Page 2: Booth table ----------------
  doc.addPage();
  bg();
  drawGoldBar();

  doc.setFontSize(16);
  doc.setTextColor(...COL.white);
  doc.text('Per-booth breakdown', margin, 18);

  doc.setFontSize(8);
  doc.setTextColor(...COL.muted);
  doc.text('Sorted by impressions (highest first). Top 3 highlighted in gold.', margin, 25);

  const ids = Object.keys(booths)
    .map(Number)
    .sort((a, b) => {
      const diff = (Number(booths[b]?.opens) || 0) - (Number(booths[a]?.opens) || 0);
      return diff || a - b;
    });

  const tableRows = ids.map((id, rank) => {
    const r = booths[id] || {};
    const plays = Number(r.quizPlays) || 0;
    const passes = Number(r.quizPasses) || 0;
    const name = boothNames[id] || `Booth ${String(id).padStart(2, '0')}`;
    return {
      cells: [
        String(rank + 1),
        String(id).padStart(2, '0'),
        name,
        String(r.opens || 0),
        String(r.introPlays || 0),
        String(plays),
        String(passes),
        passPct(plays, passes),
        String(r.hearts || 0),
        String(r.comments || 0),
      ],
    };
  });

  autoTable(doc, {
    startY: 30,
    margin: { left: margin, right: margin, bottom: footerReserve + 2 },
    head: [['#', 'ID', 'Name', 'Opens', 'Intros', 'Quiz', 'Pass', 'Rate', 'Hearts', 'Cmts']],
    body: tableRows.map((r) => r.cells),
    styles: {
      fillColor: COL.panel,
      textColor: COL.text,
      fontSize: 7.5,
      cellPadding: 2,
      lineColor: COL.line,
      lineWidth: 0.2,
    },
    headStyles: {
      fillColor: COL.line,
      textColor: COL.muted,
      fontSize: 6.5,
      fontStyle: 'bold',
      halign: 'left',
    },
    alternateRowStyles: {
      fillColor: [15, 23, 43],
    },
    didParseCell(data) {
      if (data.section === 'body' && data.row.index < 3) {
        data.cell.styles.fillColor = COL.yellow;
        data.cell.styles.textColor = COL.bg;
        data.cell.styles.fontStyle = 'bold';
      }
    },
  });

  // ---------------- Page 3: Comments (only if any) ----------------
  const comments = Array.isArray(d.recentComments) ? d.recentComments : [];
  if (comments.length) {
    doc.addPage();
    bg();
    drawGoldBar();

    doc.setFontSize(16);
    doc.setTextColor(...COL.white);
    doc.text('Recent comments', margin, 18);

    doc.setFontSize(8);
    doc.setTextColor(...COL.muted);
    doc.text(`${comments.length} most recent visitor comments`, margin, 25);

    let cy = 32;
    comments.forEach((c) => {
      const boothNum = String(c.boothId ?? '').padStart(2, '0');
      const name = boothNames[Number(c.boothId)] || `Booth ${boothNum}`;
      const visitor = c.name || 'Visitor';
      const time = c.ts ? new Date(c.ts).toLocaleString() : '';
      const text = c.text || '';

      // Pre-compute wrapped text + approximate height so we never draw into the footer zone.
      doc.setFontSize(8.5);
      const lines = doc.splitTextToSize(text, usableW - 16);
      const approxBlockH = 10 /*badge*/ + 4 /*meta*/ + 9 /*padding*/ + lines.length * 3.7 + 4 /*bottom padding*/;
      if (cy + approxBlockH > contentMaxY) {
        doc.addPage();
        bg();
        drawGoldBar();
        cy = 18;
      }

      // Badge
      doc.setFillColor(...COL.panel);
      doc.roundedRect(margin, cy, 12, 10, 1.5, 1.5, 'F');
      doc.setDrawColor(...COL.yellow);
      doc.roundedRect(margin, cy, 12, 10, 1.5, 1.5, 'S');
      doc.setFontSize(7);
      doc.setTextColor(...COL.yellow);
      doc.text(boothNum, margin + 6, cy + 6.5, { align: 'center' });

      // Meta line
      doc.setFontSize(7);
      doc.setTextColor(...COL.muted);
      doc.text(`${name}  ·  ${visitor}  ·  ${time}`, margin + 16, cy + 4);

      // Comment text (wrap)
      doc.setFontSize(8.5);
      doc.setTextColor(...COL.text);
      doc.text(lines, margin + 16, cy + 9);
      cy += 10 + lines.length * 3.9 + 4;
    });
  }

  // Draw footers once (no duplicates)
  const totalPages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    footer(i, totalPages);
  }

  doc.save(`yim-analytics-${todayStamp()}.pdf`);
}

/* ---------- Token & init ---------- */

function saveTokenFromField() {
  const next = (els.tokenInput?.value || '').trim();
  setToken(next);
  load();
}

document.getElementById('refreshBtn')?.addEventListener('click', load);
document.getElementById('tokenSave')?.addEventListener('click', saveTokenFromField);
els.tokenInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); saveTokenFromField(); }
});
document.getElementById('tokenBtn')?.addEventListener('click', () => {
  const next = window.prompt('Analytics token (local default: gmc-dev)', getToken() || LOCAL_DEFAULT_TOKEN);
  if (next == null) return;
  setToken(next.trim());
  load();
});
els.exportPdf?.addEventListener('click', exportPdf);
els.exportJson?.addEventListener('click', exportJson);

initTrendPills();
load();
setInterval(load, 10_000);
