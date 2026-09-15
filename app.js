const API_URL = './api.php';
const { Metrics } = window;

const PRIORITY_ORDER = { urgent: 0, high: 1, normal: 2, low: 3 };
const DONE_STATUS_SET = Metrics.DONE_STATUSES;
const STATUS_ORDER = ['new', 'triaged', 'scheduled', 'in_progress', 'awaiting_parts', 'on_hold'];

const els = {
  cards: document.getElementById('cards'),
  btnNew: document.getElementById('btn-new'),
  modal: document.getElementById('modal'),
  modalTitle: document.getElementById('modal-title'),
  form: document.getElementById('item-form'),
  btnClose: document.getElementById('btn-close'),
  btnDelete: document.getElementById('btn-delete'),
  imageInput: document.getElementById('image-input'),
  imageGrid: document.getElementById('image-grid'),
  filterStatus: document.getElementById('filter-status'),
  filterCategory: document.getElementById('filter-category'),
  filterPriority: document.getElementById('filter-priority'),
  resolutionWrap: document.getElementById('resolution-wrap'),
  saveIndicator: document.getElementById('save-indicator'),
  btnToggleFilters: document.getElementById('btn-toggle-filters'),
  filtersPanel: document.getElementById('filters-panel'),
  dataQuality: document.getElementById('data-quality'),
};

let items = [];
let config = Metrics.DEFAULT_CONFIG;
let currentId = null;
let autosaveTimer = null;
let isSaving = false;
let pendingSave = false;

const fmt = Metrics.formatCurrency;
const fmtPct = Metrics.formatPercent;

async function api(action, { method = 'GET', body = null, isForm = false } = {}) {
  const url = `${API_URL}?action=${encodeURIComponent(action)}`;
  const headers = isForm ? {} : { 'Content-Type': 'application/json' };
  const res = await fetch(url, { method, headers, body });
  if (!res.ok) throw new Error(`API ${action} failed: ${res.status}`);
  return await res.json();
}

async function loadItems() {
  const data = await api('list');
  items = data.items || [];
  config = Metrics.mergeConfig(data.config);
  renderCards();
}

function filteredItems() {
  const s = els.filterStatus.value || '';
  const c = els.filterCategory.value || '';
  const p = els.filterPriority.value || '';
  let list = items.slice();
  if (s) list = list.filter(it => it.status === s);
  if (c) list = list.filter(it => it.category === c);
  if (p) list = list.filter(it => it.priority === p);
  list.sort((a, b) => {
    const pa = PRIORITY_ORDER[a.priority] ?? 9;
    const pb = PRIORITY_ORDER[b.priority] ?? 9;
    if (pa !== pb) return pa - pb;
    return new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime();
  });
  return list;
}

function badgeText(text) {
  return String(text || '').replace(/_/g, ' ');
}

function renderCards() {
  const list = filteredItems();
  els.cards.innerHTML = '';

  if (!list.length) {
    els.cards.innerHTML = '<div class="empty-state">No items match the current filters.</div>';
    updateMetrics();
    return;
  }

  const byStatus = new Map();
  for (const it of list) {
    const k = it.status || 'new';
    if (!byStatus.has(k)) byStatus.set(k, []);
    byStatus.get(k).push(it);
  }

  const present = Array.from(byStatus.keys()).sort((a, b) => groupOrder(a) - groupOrder(b));
  const tpl = document.getElementById('card-template');

  for (const status of present) {
    const group = document.createElement('section');
    group.className = 'status-group';
    const heading = document.createElement('h2');
    heading.className = 'status-heading';
    const count = byStatus.get(status).length;
    heading.innerHTML = `${toTitle(badgeText(status))}<span class="sub">${count} item${count === 1 ? '' : 's'}</span>`;
    group.appendChild(heading);

    const row = document.createElement('div');
    row.className = 'group-row';
    const itemsInGroup = byStatus.get(status);
    itemsInGroup.sort((a, b) => {
      const pa = PRIORITY_ORDER[a.priority] ?? 9;
      const pb = PRIORITY_ORDER[b.priority] ?? 9;
      if (pa !== pb) return pa - pb;
      return new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime();
    });

    for (const it of itemsInGroup) {
      const node = tpl.content.firstElementChild.cloneNode(true);
      const im = Metrics.itemMetrics(it, config);
      node.dataset.priority = it.priority || 'normal';

      const thumbWrap = node.querySelector('.card-thumb');
      const imgTag = thumbWrap?.querySelector('img');
      const firstImg = Array.isArray(it.images) && it.images[0] ? it.images[0] : null;
      if (firstImg && imgTag) {
        imgTag.src = firstImg.thumb_url || firstImg.url;
        imgTag.alt = it.title || 'Image';
        thumbWrap.hidden = false;
      } else if (thumbWrap) {
        thumbWrap.hidden = true;
      }

      node.querySelector('.title').textContent = it.title || '';
      node.querySelector('.desc').textContent = it.description || '';
      const pEl = node.querySelector('.badge.priority');
      pEl.dataset.v = it.priority || 'normal';
      pEl.textContent = badgeText(it.priority);
      node.querySelector('.badge.category').textContent = badgeText(it.category || 'misc');
      node.querySelector('.room').textContent = it.room || '';
      node.querySelector('.due').textContent = it.due_by ? `Due ${it.due_by}` : '';

      const savedEl = node.querySelector('.card-saved');
      const reimbEl = node.querySelector('.card-reimb');
      if (im.done && im.saved > 0) {
        savedEl.textContent = `Saved ${fmt(im.saved)}`;
        savedEl.hidden = false;
      } else if (!im.done && im.potential > 0) {
        savedEl.textContent = `Potential ${fmt(im.potential)}`;
        savedEl.style.color = 'var(--warn)';
        savedEl.hidden = false;
      } else {
        savedEl.hidden = true;
      }

      if (im.reimbursed > 0) {
        reimbEl.textContent = `Reimb ${fmt(im.reimbursed)}`;
        reimbEl.hidden = false;
      } else {
        reimbEl.hidden = true;
      }

      const valChip = node.querySelector('.value-chip');
      if (im.valLow > 0 || im.valHigh > 0) {
        valChip.textContent = `+${Metrics.formatValueRange(im.valLow, im.valHigh)} value`;
        valChip.hidden = false;
      } else {
        valChip.hidden = true;
      }

      node.addEventListener('click', () => openModal(it.id));
      node.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openModal(it.id);
        }
      });
      row.appendChild(node);
    }

    group.appendChild(row);
    els.cards.appendChild(group);
  }

  updateMetrics();
  updateDataQuality();
}

function groupOrder(status) {
  if (DONE_STATUS_SET.has(status)) {
    const doneOrder = ['completed', 'closed', 'won’t_fix', "won't_fix"];
    const idx = doneOrder.indexOf(status);
    return 100 + (idx === -1 ? 99 : idx);
  }
  const idx = STATUS_ORDER.indexOf(status);
  return idx === -1 ? 50 : idx;
}

function toTitle(s) {
  return String(s || '').replace(/\b\w/g, c => c.toUpperCase());
}

function updateMetrics() {
  const m = Metrics.computeMetrics(items, config);

  const perDayEl = document.getElementById('metric-perday');
  const perDaySub = document.getElementById('metric-perday-sub');
  const savedEl = document.getElementById('metric-saved');
  const savedSub = document.getElementById('metric-saved-sub');
  const valueEl = document.getElementById('metric-value-added');
  const rateWrap = document.getElementById('metric-rate-wrap');
  const rateEl = document.getElementById('metric-rate');
  const completedEl = document.getElementById('metric-completed');
  const openSub = document.getElementById('metric-open-sub');

  const leadCost = m.netDailyCost < 0 ? m.netDailyCost : m.costPerDay;
  const leadCostLabel = m.netDailyCost < 0 ? 'Net gain per day' : 'Cost per day';

  if (perDayEl) perDayEl.textContent = fmt(Math.abs(leadCost));
  if (perDaySub) {
    perDaySub.textContent = m.netDailyCost < 0
      ? `${leadCostLabel} · property gained more than reimbursed`
      : `${fmt(m.totalReimbursed)} total reimbursed · ${m.days} days`;
  }

  if (savedEl) savedEl.textContent = fmt(m.totalSavings);
  if (savedSub) {
    savedSub.textContent = m.contractorCostAvoided > 0
      ? `${fmt(m.totalSavings)} saved on ${fmt(m.contractorCostAvoided)} of contractor work`
      : 'Completed repairs vs market pricing';
  }

  if (valueEl) {
    valueEl.textContent = Metrics.formatValueRange(m.valueAddedLowTotal, m.valueAddedHighTotal);
  }

  if (rateWrap && rateEl) {
    if (m.savingsRate >= 30) {
      rateWrap.hidden = false;
      rateEl.textContent = fmtPct(m.savingsRate);
    } else {
      rateWrap.hidden = true;
    }
  }

  if (completedEl) completedEl.textContent = String(m.completedCount);
  if (openSub) openSub.textContent = `${m.openCount} open · ${fmt(m.potentialSavingsTotal)} potential savings`;

  const partsEl = document.getElementById('insight-parts');
  const netEl = document.getElementById('insight-net-daily');
  const contractorEl = document.getElementById('insight-contractor');
  const handymanEl = document.getElementById('insight-handyman');
  const potentialEl = document.getElementById('insight-potential');

  if (partsEl) {
    if (m.partsShare >= 60) {
      partsEl.hidden = false;
      partsEl.textContent = `Parts were ${Math.round(m.partsShare)}% of market cost`;
    } else {
      partsEl.hidden = true;
    }
  }

  if (netEl) {
    netEl.textContent = m.netDailyCost < 0
      ? `Net daily: ${fmt(Math.abs(m.netDailyCost))} property gain`
      : `Net daily cost: ${fmt(m.netDailyCost)} after value added`;
  }

  if (contractorEl) {
    contractorEl.textContent = `${fmt(m.contractorCostAvoided)} contractor cost handled`;
  }

  if (handymanEl) {
    handymanEl.textContent = m.handymanDaysEquivalent >= 1
      ? `≈ ${Math.round(m.handymanDaysEquivalent)} handyman days saved`
      : `Effective rate: ${fmt(m.effectiveHourlyRate)}/hr vs ${fmt(config.handyman_hourly_rate)}/hr`;
  }

  if (potentialEl) {
    if (m.potentialSavingsTotal > 0) {
      potentialEl.hidden = false;
      potentialEl.textContent = `Potential savings (open): ${fmt(m.potentialSavingsTotal)}`;
    } else {
      potentialEl.hidden = true;
    }
  }
}

function updateDataQuality() {
  if (!els.dataQuality) return;
  const flagged = items.filter(Metrics.needsDataReview);
  if (!flagged.length) {
    els.dataQuality.hidden = true;
    return;
  }
  els.dataQuality.hidden = false;
  els.dataQuality.textContent = `${flagged.length} item${flagged.length === 1 ? '' : 's'} may need cost review (missing fields or estimate in description only).`;
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

// Filters toggle
if (els.btnToggleFilters && els.filtersPanel) {
  els.btnToggleFilters.addEventListener('click', () => {
    const open = els.filtersPanel.hidden;
    els.filtersPanel.hidden = !open;
    els.btnToggleFilters.setAttribute('aria-expanded', String(open));
  });
}

// Image viewer
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

function onModalKey(e) {
  if (e.key === 'Escape') closeModal();
}

function openModal(id = null) {
  currentId = id;
  const isNew = !id;
  els.modal.classList.add('open');
  els.modal.setAttribute('aria-hidden', 'false');
  els.modalTitle.textContent = isNew ? 'New Item' : 'Edit Item';
  els.form.reset();
  setFormValues({
    id: '', title: '', priority: 'normal', status: 'new', category: 'misc',
    room: '', reported_by: '', next_action: '', due_by: '', description: '', resolution: '',
    created_at: '', updated_at: '', labor_time: 0, labor_cost_estimate: 0, parts_cost: 0,
    asking_for_reimbursement: false, my_cost: 0, value_added_low: 0, value_added_high: 0,
    value_added_confidence: '', value_added_rationale: '', value_added_sources: '',
    include_in_value_total: false,
  });
  els.imageGrid.innerHTML = '';
  setIndicator('idle', '');
  document.addEventListener('keydown', onModalKey);

  if (!isNew) {
    const it = items.find(x => x.id === id);
    if (it) {
      setFormValues(it);
      renderImages(it);
    }
  } else {
    document.getElementById('created_at').textContent = '—';
    document.getElementById('updated_at').textContent = '—';
  }
}

function closeModal() {
  els.modal.classList.remove('open');
  els.modal.setAttribute('aria-hidden', 'true');
  currentId = null;
  document.removeEventListener('keydown', onModalKey);
}

function getFormValues() {
  return {
    id: document.getElementById('item-id').value.trim() || null,
    title: document.getElementById('title').value.trim(),
    description: document.getElementById('description').value.trim(),
    resolution: document.getElementById('resolution')?.value.trim() || '',
    status: document.getElementById('status').value,
    priority: document.getElementById('priority').value,
    category: document.getElementById('category').value,
    room: document.getElementById('room').value.trim(),
    reported_by: document.getElementById('reported_by').value.trim(),
    next_action: document.getElementById('next_action').value.trim(),
    due_by: document.getElementById('due_by').value || null,
    labor_time: parseFloat(document.getElementById('labor_time').value || '0') || 0,
    labor_cost_estimate: parseFloat(document.getElementById('labor_cost_estimate').value || '0') || 0,
    parts_cost: parseFloat(document.getElementById('parts_cost').value || '0') || 0,
    asking_for_reimbursement: !!document.getElementById('asking_for_reimbursement').checked,
    my_cost: parseFloat(document.getElementById('my_cost').value || '0') || 0,
    value_added_low: parseFloat(document.getElementById('value_added_low').value || '0') || 0,
    value_added_high: parseFloat(document.getElementById('value_added_high').value || '0') || 0,
    value_added_confidence: document.getElementById('value_added_confidence').value,
    value_added_rationale: document.getElementById('value_added_rationale').value.trim(),
    value_added_sources: document.getElementById('value_added_sources').value.trim(),
    include_in_value_total: !!document.getElementById('include_in_value_total').checked,
  };
}

function setFormValues(it) {
  document.getElementById('item-id').value = it.id || '';
  document.getElementById('title').value = it.title || '';
  document.getElementById('description').value = it.description || '';
  const resEl = document.getElementById('resolution');
  if (resEl) resEl.value = it.resolution || '';
  document.getElementById('status').value = it.status || 'new';
  document.getElementById('priority').value = it.priority || 'normal';
  document.getElementById('category').value = it.category || 'misc';
  document.getElementById('room').value = it.room || '';
  document.getElementById('reported_by').value = it.reported_by || '';
  document.getElementById('next_action').value = it.next_action || '';
  document.getElementById('due_by').value = it.due_by || '';
  document.getElementById('created_at').textContent = it.created_at || '';
  document.getElementById('updated_at').textContent = it.updated_at || '';
  toggleResolutionVisibility();
  document.getElementById('labor_time').value = (it.labor_time ?? 0).toString();
  document.getElementById('labor_cost_estimate').value = (it.labor_cost_estimate ?? 0).toString();
  document.getElementById('parts_cost').value = (it.parts_cost ?? 0).toString();
  document.getElementById('asking_for_reimbursement').checked = !!it.asking_for_reimbursement;
  document.getElementById('my_cost').value = (it.my_cost ?? 0).toString();
  document.getElementById('value_added_low').value = (it.value_added_low ?? 0).toString();
  document.getElementById('value_added_high').value = (it.value_added_high ?? 0).toString();
  document.getElementById('value_added_confidence').value = it.value_added_confidence || '';
  document.getElementById('value_added_rationale').value = it.value_added_rationale || '';
  document.getElementById('value_added_sources').value = it.value_added_sources || '';
  document.getElementById('include_in_value_total').checked = !!it.include_in_value_total;
  toggleMyCost();
  updateEstimatedPrice();
  updateFormSavingsPreview();
}

function toggleResolutionVisibility() {
  const s = document.getElementById('status').value;
  const show = s === 'completed' || s === 'closed';
  if (els.resolutionWrap) els.resolutionWrap.hidden = !show;
}

function updateEstimatedPrice() {
  const est = Metrics.marketEstimate(getFormValues());
  const out = document.getElementById('estimated_price');
  if (out) out.value = fmt(est);
  updateFormSavingsPreview();
}

function updateFormSavingsPreview() {
  const preview = document.getElementById('form-savings-preview');
  if (!preview) return;
  const vals = getFormValues();
  const market = Metrics.marketEstimate(vals);
  const reimb = Metrics.amountReimbursed(vals);
  const saved = Math.max(0, market - reimb);
  if (market > 0) {
    preview.hidden = false;
    preview.textContent = Metrics.isDone(vals.status)
      ? `Homeowner saves ${fmt(saved)} vs contractor estimate of ${fmt(market)}`
      : `Potential savings: ${fmt(saved)} vs contractor estimate of ${fmt(market)}`;
  } else {
    preview.hidden = true;
  }
}

function renderImages(it) {
  els.imageGrid.innerHTML = '';
  const images = Array.isArray(it.images) ? it.images : [];
  for (const img of images) {
    const tile = document.createElement('div');
    tile.className = 'image-tile';
    const imgtag = document.createElement('img');
    imgtag.src = img.thumb_url || img.url;
    imgtag.alt = img.meta?.original_filename || 'Image';
    imgtag.addEventListener('click', (e) => { e.stopPropagation(); openViewer(img.url); });
    const del = document.createElement('button');
    del.className = 'btn btn-danger';
    del.type = 'button';
    del.textContent = '×';
    del.title = 'Remove image';
    del.addEventListener('click', async (e) => {
      e.stopPropagation();
      await deleteImage(currentId, img);
    });
    tile.appendChild(imgtag);
    tile.appendChild(del);
    els.imageGrid.appendChild(tile);
  }
}

async function saveItem(e) {
  if (e) e.preventDefault();
  cancelAutosave();
  const payload = getFormValues();
  if (!payload.title) { alert('Title is required'); return; }
  let result;
  if (currentId) {
    payload.id = currentId;
    result = await api('update', { method: 'PUT', body: JSON.stringify(payload) });
  } else {
    result = await api('create', { method: 'POST', body: JSON.stringify(payload) });
  }
  const updated = result.item;
  const idx = items.findIndex(x => x.id === updated.id);
  if (idx >= 0) items[idx] = updated; else items.push(updated);
  closeModal();
  renderCards();
}

async function deleteItem() {
  if (!currentId) return;
  if (!confirm('Delete this item? This cannot be undone.')) return;
  await api('delete', { method: 'DELETE', body: JSON.stringify({ id: currentId }) });
  items = items.filter(x => x.id !== currentId);
  closeModal();
  renderCards();
}

async function deleteImage(itemId, img) {
  await api('delete_image', { method: 'POST', body: JSON.stringify({ item_id: itemId, url: img.url, thumb_url: img.thumb_url }) });
  const it = items.find(x => x.id === itemId);
  if (it) {
    it.images = (it.images || []).filter(i => i.url !== img.url);
    renderImages(it);
    renderCards();
  }
}

els.btnNew.addEventListener('click', () => openModal(null));
els.btnClose.addEventListener('click', closeModal);
els.modal.addEventListener('click', (e) => { if (e.target.hasAttribute('data-close')) closeModal(); });
els.form.addEventListener('submit', saveItem);
els.btnDelete.addEventListener('click', deleteItem);
els.filterStatus.addEventListener('change', renderCards);
els.filterCategory.addEventListener('change', renderCards);
els.filterPriority.addEventListener('change', renderCards);

const fieldIds = [
  'title', 'description', 'status', 'priority', 'category', 'room', 'reported_by',
  'next_action', 'due_by', 'resolution', 'labor_time', 'labor_cost_estimate', 'parts_cost',
  'asking_for_reimbursement', 'my_cost', 'value_added_low', 'value_added_high',
  'value_added_confidence', 'value_added_rationale', 'value_added_sources', 'include_in_value_total',
];

for (const id of fieldIds) {
  const el = document.getElementById(id);
  if (!el) continue;
  const isSelectLike = el.tagName === 'SELECT' || el.type === 'date' || el.type === 'checkbox';
  el.addEventListener(isSelectLike ? 'change' : 'input', () => {
    if (id === 'status') toggleResolutionVisibility();
    if (['labor_time', 'labor_cost_estimate', 'parts_cost', 'my_cost'].includes(id)) updateEstimatedPrice();
    if (id === 'asking_for_reimbursement') onReimbToggle();
    if (['status', 'my_cost', 'labor_time', 'labor_cost_estimate', 'parts_cost'].includes(id)) updateFormSavingsPreview();
    scheduleAutosave(isSelectLike ? 300 : 600);
  });
}

function onReimbToggle() {
  const checked = document.getElementById('asking_for_reimbursement').checked;
  const wrap = document.getElementById('my_cost_wrap');
  if (wrap) wrap.hidden = !checked;
  if (checked) {
    const myCostEl = document.getElementById('my_cost');
    const current = parseFloat(myCostEl.value || '0') || 0;
    if (!current) {
      const est = Metrics.marketEstimate(getFormValues());
      myCostEl.value = String(est.toFixed(2));
    }
  }
  updateFormSavingsPreview();
}

function toggleMyCost() {
  const checked = document.getElementById('asking_for_reimbursement').checked;
  const wrap = document.getElementById('my_cost_wrap');
  if (wrap) wrap.hidden = !checked;
}

els.imageInput.addEventListener('change', async (e) => {
  if (!currentId) { alert('Save the item first before adding images.'); e.target.value = ''; return; }
  const files = Array.from(e.target.files || []);
  for (const f of files) {
    try {
      const processed = await processImageForWebp(f);
      const fd = new FormData();
      fd.append('item_id', currentId);
      fd.append('original_filename', f.name);
      fd.append('width', String(processed.width));
      fd.append('height', String(processed.height));
      fd.append('size', String(processed.webpBlob.size));
      fd.append('taken_at', processed.takenAt || '');
      fd.append('image', processed.webpBlob, toSafeWebpName(f.name));
      fd.append('thumb', processed.thumbBlob, toSafeWebpName('thumb-' + f.name));
      const res = await api('upload_image', { method: 'POST', body: fd, isForm: true });
      const it = items.find(x => x.id === currentId);
      if (it) {
        it.images = it.images || [];
        it.images.push(res.image);
        renderImages(it);
        renderCards();
      }
    } catch (err) {
      console.error(err);
      alert('Failed to upload image');
    }
  }
  e.target.value = '';
});

function toSafeWebpName(name) {
  const base = name.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9._-]/g, '');
  return base.replace(/\.[^.]+$/, '') + '.webp';
}

async function processImageForWebp(file) {
  const bitmap = await createImageBitmap(file);
  const maxW = 1600;
  const scale = Math.min(1, maxW / bitmap.width);
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, w, h);
  const webpBlob = await new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('WebP failed')), 'image/webp', 0.85));
  const tw = 320;
  const tscale = Math.min(1, tw / w);
  const tw2 = Math.round(w * tscale);
  const th2 = Math.round(h * tscale);
  const tcan = document.createElement('canvas');
  tcan.width = tw2;
  tcan.height = th2;
  const tctx = tcan.getContext('2d');
  tctx.drawImage(canvas, 0, 0, tw2, th2);
  const thumbBlob = await new Promise((resolve, reject) => tcan.toBlob(b => b ? resolve(b) : reject(new Error('Thumb failed')), 'image/webp', 0.8));
  return { webpBlob, thumbBlob, width: w, height: h, takenAt: null };
}

loadItems().catch(err => {
  console.error(err);
  if (els.cards) els.cards.innerHTML = '<div class="empty-state">Failed to load items. Is the PHP server running?</div>';
});

function scheduleAutosave(delay) {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(performAutosave, delay);
}

function cancelAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = null;
}

async function performAutosave() {
  if (isSaving) { pendingSave = true; return; }
  const payload = getFormValues();
  if (!currentId && !payload.title) return;
  try {
    isSaving = true;
    setIndicator('saving', 'Saving…');
    let result;
    if (currentId) {
      payload.id = currentId;
      result = await api('update', { method: 'PUT', body: JSON.stringify(payload) });
    } else {
      result = await api('create', { method: 'POST', body: JSON.stringify(payload) });
    }
    const updated = result.item;
    const idx = items.findIndex(x => x.id === updated.id);
    if (idx >= 0) items[idx] = updated; else items.push(updated);
    currentId = updated.id;
    document.getElementById('item-id').value = updated.id;
    document.getElementById('created_at').textContent = updated.created_at || '';
    document.getElementById('updated_at').textContent = updated.updated_at || '';
    setIndicator('saved', 'Saved');
    renderCards();
  } catch (err) {
    console.error(err);
    setIndicator('error', 'Save failed');
  } finally {
    isSaving = false;
    if (pendingSave) { pendingSave = false; performAutosave(); }
  }
}

function setIndicator(state, text) {
  const el = els.saveIndicator;
  if (!el) return;
  el.classList.remove('saving', 'saved', 'error');
  if (state && state !== 'idle') el.classList.add(state);
  el.textContent = text || '';
}
