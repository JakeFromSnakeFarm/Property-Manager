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
  const m = Metrics.computeMetrics(items, config);
  const done = items.filter(it => Metrics.isDone(it.status));
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

  const leadCost = m.netDailyCost < 0 ? Math.abs(m.netDailyCost) : m.costPerDay;
  const heroPerDay = document.getElementById('hero-perday');
  const heroPerDaySub = document.getElementById('hero-perday-sub');
  heroPerDay.textContent = fmt(leadCost);
  heroPerDaySub.textContent = m.netDailyCost < 0
    ? 'Net property gain per day after value added'
    : `${fmt(m.totalReimbursed)} total reimbursed · ${m.days} days tracked`;

  document.getElementById('hero-saved').textContent = fmt(m.totalSavings);
  document.getElementById('hero-saved-sub').textContent =
    `${fmt(m.totalSavings)} saved on ${fmt(m.contractorCostAvoided)} of completed contractor work`;

  renderSupporting(m, config);
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

function renderSupporting(m, config) {
  const el = document.getElementById('report-supporting');
  const tiles = [];

  tiles.push({
    label: 'Contractor Cost Handled',
    value: fmt(m.contractorCostAvoided),
    sub: 'market value of completed work',
  });

  if (m.savingsRate >= 30) {
    tiles.push({
      label: 'Savings Rate',
      value: fmtPct(m.savingsRate),
      sub: 'vs contractor pricing',
    });
  }

  if (m.valueAddedLowTotal > 0 || m.valueAddedHighTotal > 0) {
    tiles.push({
      label: 'Property Value Added',
      value: Metrics.formatValueRange(m.valueAddedLowTotal, m.valueAddedHighTotal),
      sub: 'estimated range',
    });
  }

  if (m.partsShare >= 60) {
    tiles.push({
      label: 'Parts Share',
      value: `${Math.round(m.partsShare)}%`,
      sub: 'of market cost was materials',
    });
  }

  tiles.push({
    label: m.netDailyCost < 0 ? 'Net Daily Gain' : 'Net Daily Cost',
    value: fmt(Math.abs(m.netDailyCost)),
    sub: 'after property value added',
  });

  if (m.handymanDaysEquivalent >= 1) {
    tiles.push({
      label: 'Handyman Days',
      value: `≈ ${Math.round(m.handymanDaysEquivalent)}`,
      sub: `saved at ${fmt(config.handyman_day_rate)}/day`,
    });
  }

  if (m.potentialSavingsTotal > 0) {
    tiles.push({
      label: 'Potential Savings',
      value: fmt(m.potentialSavingsTotal),
      sub: 'open work (not confirmed)',
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

    const thumb = Array.isArray(it.images) && it.images[0] ? it.images[0] : null;
    if (thumb) {
      const thumbWrap = document.createElement('div');
      thumbWrap.className = 'report-card-thumb';
      const img = document.createElement('img');
      img.src = thumb.thumb_url || thumb.url;
      img.alt = it.title || '';
      img.addEventListener('click', () => openViewer(thumb.url));
      thumbWrap.appendChild(img);
      card.appendChild(thumbWrap);
    }

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

    const saved = document.createElement('div');
    saved.className = 'report-card-saved';
    if (isPotential && im.potential > 0) {
      saved.textContent = `Potential savings ${fmt(im.potential)}`;
      saved.style.color = 'var(--warn)';
    } else if (im.saved > 0) {
      saved.textContent = `Saved ${fmt(im.saved)} vs contractor`;
    } else {
      saved.textContent = 'No savings recorded';
      saved.style.color = 'var(--subtle)';
    }
    body.appendChild(saved);

    if (im.reimbursed > 0) {
      const reimb = document.createElement('div');
      reimb.className = 'report-card-reimb';
      reimb.textContent = `Reimbursed ${fmt(im.reimbursed)}`;
      body.appendChild(reimb);
    }

    if (it.resolution) {
      const res = document.createElement('p');
      res.className = 'report-card-resolution';
      res.textContent = it.resolution;
      body.appendChild(res);
    }

    if (im.valLow > 0 || im.valHigh > 0) {
      const val = document.createElement('div');
      val.className = 'report-card-value';
      val.textContent = `+${Metrics.formatValueRange(im.valLow, im.valHigh)} property value`;
      body.appendChild(val);
    }

    if (it.value_added_rationale) {
      const rat = document.createElement('p');
      rat.className = 'report-card-resolution';
      rat.textContent = it.value_added_rationale;
      body.appendChild(rat);
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
  themeBtn.textContent = isDark ? 'Light' : 'Dark';
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
