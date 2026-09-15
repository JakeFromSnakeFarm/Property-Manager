const API_URL = './api.php';
const { Metrics } = window;

const fmt = Metrics.formatCurrency;
const fmtPct = Metrics.formatPercent;

function adaptReportItem(r) {
  const market = r.market_estimate || 0;
  const lt = r.labor_time || 0;
  const parts = r.parts_cost || 0;
  const laborComponent = Math.max(0, market - parts);
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    resolution: r.resolution,
    status: r.status,
    category: r.category,
    room: r.room,
    images: r.images || [],
    labor_time: lt,
    labor_cost_estimate: lt > 0 ? laborComponent / lt : laborComponent,
    parts_cost: parts,
    my_cost: r.amount_reimbursed || 0,
    asking_for_reimbursement: !!r.asking_for_reimbursement,
    value_added_low: r.value_added_low || 0,
    value_added_high: r.value_added_high || 0,
    value_added_confidence: r.value_added_confidence || '',
    value_added_rationale: r.value_added_rationale || '',
    value_added_sources: r.value_added_sources || '',
    include_in_value_total: !!r.include_in_value_total,
    updated_at: r.updated_at,
    created_at: r.created_at,
  };
}

async function loadReport() {
  const res = await fetch(`${API_URL}?action=report`);
  if (!res.ok) throw new Error('Failed to load report');
  const data = await res.json();
  const config = Metrics.mergeConfig(data.config);
  const items = (data.items || []).map(adaptReportItem);
  renderReport(items, config, data.generated_at);
}

function renderReport(items, config, generatedAt) {
  const legacy = Metrics.computeLegacyMetrics(items, config);
  const m = Metrics.computeMetrics(items, config);
  const done = items.filter(it => Metrics.isDone(it.status));
  done.sort((a, b) => {
    const savingsDiff = Metrics.itemSavings(b) - Metrics.itemSavings(a);
    if (savingsDiff !== 0) return savingsDiff;
    return new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime();
  });
  const open = items.filter(it => Metrics.isOpen(it.status));

  document.getElementById('report-title').textContent = config.report_title;
  document.getElementById('report-title-print').textContent = config.report_title;
  document.getElementById('report-subtitle').textContent = config.property_label || 'Maintenance impact summary';
  document.getElementById('report-period-print').textContent =
    `Tracking since ${config.tracking_start} · ${m.days} days`;

  const updatedEl = document.getElementById('report-updated');
  if (updatedEl) {
    updatedEl.textContent = generatedAt
      ? `Live data · last updated ${new Date(generatedAt).toLocaleString()}`
      : 'Live data';
  }

  const heroPerDay = document.getElementById('hero-perday');
  const heroPerDaySub = document.getElementById('hero-perday-sub');
  heroPerDay.textContent = fmt(m.costPerDay);
  heroPerDaySub.textContent =
    `${fmt(m.totalReimbursed)} completed reimbursements · ${m.days} days tracked`;

  document.getElementById('hero-saved').textContent = fmt(legacy.moneySaved);
  document.getElementById('hero-saved-sub').textContent =
    `${fmt(legacy.totalMarketAll)} contractor est − ${fmt(legacy.totalReimbFlagged)} reimbursed · past & future`;

  const hoursEl = document.getElementById('hero-hours');
  const hoursSub = document.getElementById('hero-hours-sub');
  if (hoursEl) hoursEl.textContent = Metrics.formatHours(m.totalHoursAll);
  if (hoursSub) {
    hoursSub.textContent = `${Metrics.formatHours(m.totalLaborHours)} completed · ${Metrics.formatHours(m.totalHoursAll - m.totalLaborHours)} open`;
  }

  renderSupporting(m, legacy, config);
  renderCarousel('completed-carousel', done, config, false);
  document.getElementById('completed-count').textContent = `(${done.length})`;
  document.getElementById('completed-empty').hidden = done.length > 0;

  const upcomingSection = document.getElementById('upcoming-section');
  if (open.length) {
    upcomingSection.hidden = false;
    renderCarousel('upcoming-carousel', open, config, true);
  } else {
    upcomingSection.hidden = true;
  }

  document.getElementById('report-methodology').textContent =
    'Savings compare completed work to typical contractor market pricing. Cost per day spreads reimbursed amounts over the tracking period. Property value estimates are manual ranges included only when marked for the total. Open/upcoming work is shown separately and is not counted in confirmed savings.';

  document.getElementById('report-generated-at').textContent =
    `Report generated ${new Date(generatedAt || Date.now()).toLocaleString()}`;
}

function renderSupporting(m, legacy, config) {
  const el = document.getElementById('report-supporting');
  const tiles = [];

  if (legacy.totalMarketAll > 0) {
    tiles.push({
      label: 'Your Savings',
      value: fmtPct(legacy.cheaperThanContractorsPct),
      sub: 'cheaper than contractors',
    });
  }

  if (m.valueAddedLowTotal > 0 || m.valueAddedHighTotal > 0) {
    tiles.push({
      label: 'Property Value Added',
      value: Metrics.formatValueRange(m.valueAddedLowTotal, m.valueAddedHighTotal),
      sub: 'estimated range',
    });
  }

  if (m.completedCount > 0) {
    tiles.push({
      label: 'Savings on Completed Work',
      value: fmt(m.totalSavings),
      sub: `${m.completedCount} repair${m.completedCount === 1 ? '' : 's'} · money already saved vs contractor est`,
    });
  }

  el.innerHTML = tiles.map(t => `
    <div class="support-tile">
      <div class="label">${t.label}</div>
      <div class="value">${t.value}</div>
      ${t.sub ? `<div class="sub">${t.sub}</div>` : ''}
    </div>
  `).join('');
}

function renderCarousel(containerId, list, config, isPotential) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';

  for (const it of list) {
    const im = Metrics.itemMetrics(it, config);
    const card = document.createElement('article');
    card.className = 'report-card';

    const thumbWrap = document.createElement('div');
    thumbWrap.className = 'report-card-thumb';
    const thumb = Array.isArray(it.images) && it.images[0] ? it.images[0] : null;
    if (thumb) {
      const img = document.createElement('img');
      img.src = thumb.thumb_url || thumb.url;
      img.alt = it.title || '';
      img.addEventListener('click', () => openViewer(thumb.url));
      thumbWrap.appendChild(img);
    } else {
      thumbWrap.classList.add('is-empty');
      thumbWrap.innerHTML = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/></svg>';
    }
    card.appendChild(thumbWrap);

    const body = document.createElement('div');
    body.className = 'report-card-body';

    const title = document.createElement('h3');
    title.className = 'report-card-title';
    title.textContent = it.title || 'Untitled';
    body.appendChild(title);

    const meta = document.createElement('div');
    meta.className = 'report-card-meta';
    const parts = [it.room, it.category, it.status?.replace(/_/g, ' ')].filter(Boolean);
    meta.textContent = parts.join(' · ');
    body.appendChild(meta);

    const res = document.createElement('p');
    res.className = 'report-card-resolution';
    res.textContent = it.resolution || it.description || ' ';
    body.appendChild(res);

    if (isPotential && im.potential > 0) {
      const saved = document.createElement('div');
      saved.className = 'report-card-saved-banner is-est';
      saved.innerHTML = `<div class="report-card-saved-amount">Est. ${fmt(im.potential)}</div>
        <div class="report-card-saved-breakdown">${fmt(im.market)} contractor − ${fmt(im.reimbursed)} billed</div>`;
      body.appendChild(saved);
    } else if (!isPotential && im.market > 0) {
      const banner = document.createElement('div');
      banner.className = 'report-card-saved-banner';
      const amount = document.createElement('div');
      amount.className = 'report-card-saved-amount';
      amount.textContent = `Saved ${fmt(im.saved)}`;
      const breakdown = document.createElement('div');
      breakdown.className = 'report-card-saved-breakdown';
      breakdown.textContent = `${fmt(im.market)} contractor − ${fmt(im.reimbursed)} reimbursed`;
      banner.appendChild(amount);
      banner.appendChild(breakdown);
      body.appendChild(banner);
    } else {
      const banner = document.createElement('div');
      banner.className = 'report-card-saved-banner is-muted';
      banner.innerHTML = `<div class="report-card-saved-amount">${im.done ? 'No savings recorded' : 'Estimate pending'}</div>`;
      body.appendChild(banner);
    }

    card.appendChild(body);
    container.appendChild(card);
  }
}

// Theme
const themeBtn = document.getElementById('theme-toggle');
const savedTheme = localStorage.getItem('pm_theme');
if (savedTheme) document.documentElement.setAttribute('data-theme', savedTheme);
if (themeBtn) {
  updateThemeButton();
  themeBtn.addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme') || 'light';
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('pm_theme', next);
    updateThemeButton();
  });
}

function updateThemeButton() {
  if (!themeBtn) return;
  const isDark = (document.documentElement.getAttribute('data-theme') || 'light') === 'dark';
  themeBtn.setAttribute('aria-pressed', String(isDark));
  themeBtn.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
}

// Print
document.getElementById('btn-print')?.addEventListener('click', () => window.print());

// Viewer
const viewer = document.getElementById('viewer');
const viewerImg = document.getElementById('viewer-img');
if (viewer) {
  viewer.addEventListener('click', (e) => {
    if (e.target.hasAttribute('data-close') || e.target.id === 'viewer-img') closeViewer();
  });
}

function openViewer(url) {
  viewerImg.src = url;
  viewer.classList.add('open');
  viewer.setAttribute('aria-hidden', 'false');
  document.addEventListener('keydown', onViewerKey);
}

function closeViewer() {
  viewer.classList.remove('open');
  viewer.setAttribute('aria-hidden', 'true');
  viewerImg.src = '';
  document.removeEventListener('keydown', onViewerKey);
}

function onViewerKey(e) {
  if (e.key === 'Escape') closeViewer();
}

loadReport().catch(err => {
  console.error(err);
  document.querySelector('.report-main').innerHTML =
    '<div class="empty-state">Failed to load report. Is the PHP server running?</div>';
});
