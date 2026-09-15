const API_URL = './api.php';

const PRIORITY_ORDER = { urgent: 0, high: 1, normal: 2, low: 3 };
const DONE_STATUS_SET = new Set(['completed','closed','won’t_fix',"won't_fix"]);
const STATUS_ORDER = ['new','triaged','scheduled','in_progress','awaiting_parts','on_hold'];

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
};

let items = [];
let currentId = null;
let autosaveTimer = null;
let isSaving = false;
let pendingSave = false;

function nowIso() {
  return new Date().toISOString();
}

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
    // Newest first otherwise
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
  const byStatus = new Map();
  for (const it of list) {
    const k = (it.status || 'new');
    if (!byStatus.has(k)) byStatus.set(k, []);
    byStatus.get(k).push(it);
  }
  const present = Array.from(byStatus.keys());
  present.sort((a, b) => groupOrder(a) - groupOrder(b));
  const tpl = document.getElementById('card-template');
  for (const status of present) {
    const group = document.createElement('section');
    group.className = 'status-group';
    const heading = document.createElement('h2');
    heading.className = 'status-heading';
    heading.innerHTML = `${toTitle(badgeText(status))}<span class="sub">${byStatus.get(status).length} items</span>`;
    group.appendChild(heading);
    const row = document.createElement('div');
    row.className = 'group-row';
    const itemsInGroup = byStatus.get(status);
    // Keep within-group order by priority, then updated_at desc
    itemsInGroup.sort((a, b) => {
      const pa = PRIORITY_ORDER[a.priority] ?? 9;
      const pb = PRIORITY_ORDER[b.priority] ?? 9;
      if (pa !== pb) return pa - pb;
      return new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime();
    });
    for (const it of itemsInGroup) {
      const node = tpl.content.firstElementChild.cloneNode(true);
      node.dataset.priority = it.priority || 'normal';
      const thumbWrap = node.querySelector('.card-thumb');
      const imgTag = thumbWrap?.querySelector('img');
      const firstImg = (Array.isArray(it.images) && it.images[0]) ? it.images[0] : null;
      if (firstImg && imgTag) {
        imgTag.src = firstImg.thumb_url || firstImg.url;
        imgTag.alt = it.title || 'Image';
        // Do not open viewer from card thumbnail; only inside modal
        thumbWrap.style.display = '';
      } else if (thumbWrap) {
        thumbWrap.style.display = 'none';
      }
      node.querySelector('.title').textContent = it.title || '';
      node.querySelector('.desc').textContent = it.description || '';
      const pEl = node.querySelector('.badge.priority');
      pEl.dataset.v = it.priority || 'normal';
      pEl.textContent = badgeText(it.priority);
      const sEl = node.querySelector('.badge.status');
      sEl.dataset.v = it.status || 'new';
      sEl.textContent = badgeText(it.status);
      const cEl = node.querySelector('.badge.category');
      cEl.textContent = badgeText(it.category || 'misc');
      node.querySelector('.room').textContent = it.room || '';
      node.querySelector('.due').textContent = it.due_by ? `Due: ${it.due_by}` : '';
      // Estimated price and reimbursement badge
      const est = estimatePrice(it);
      const estEl = node.querySelector('.est');
      if (estEl) estEl.textContent = isNaN(est) ? '' : `Est: ${formatCurrency(est)}`;
      const rb = node.querySelector('.reimb');
      if (rb) rb.style.display = it.asking_for_reimbursement ? '' : 'none';
      node.addEventListener('click', () => openModal(it.id));
      node.addEventListener('keypress', (e) => { if (e.key === 'Enter' || e.key === ' ') openModal(it.id); });
      row.appendChild(node);
    }
    group.appendChild(row);
    els.cards.appendChild(group);
  }
  updateMetrics();
}

function groupOrder(status) {
  const isDone = DONE_STATUS_SET.has(status);
  if (isDone) {
    // push done statuses after others, keep deterministic order inside
    const doneOrder = ['completed','closed','won’t_fix',"won't_fix"];
    const idx = doneOrder.indexOf(status);
    return 100 + (idx === -1 ? 99 : idx);
  }
  const idx = STATUS_ORDER.indexOf(status);
  return idx === -1 ? 50 : idx; // unknown active statuses in the middle
}

function toTitle(s) {
  return String(s || '').replace(/\b\w/g, c => c.toUpperCase());
}

// Theme toggle
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
  const cur = document.documentElement.getAttribute('data-theme') || 'light';
  const isDark = cur === 'dark';
  themeBtn.setAttribute('aria-pressed', String(isDark));
  themeBtn.textContent = isDark ? 'Light mode' : 'Dark mode';
}

// Image viewer
const viewer = document.getElementById('viewer');
const viewerImg = document.getElementById('viewer-img');
if (viewer) {
  viewer.addEventListener('click', (e) => { if (e.target.hasAttribute('data-close') || e.target.id === 'viewer-img') closeViewer(); });
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
function openModal(id = null) {
  currentId = id;
  const isNew = !id;
  els.modal.classList.add('open');
  els.modal.setAttribute('aria-hidden', 'false');
  els.modalTitle.textContent = isNew ? 'New Item' : 'Edit Item';
  // Clear form first
  els.form.reset();
  setFormValues({
    id: '', title: '', priority: 'normal', status: 'new', category: 'misc', room: '', reported_by: '', next_action: '', due_by: '', description: '', resolution: '', created_at: '', updated_at: ''
  });
  els.imageGrid.innerHTML = '';
  setIndicator('idle', '');
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
  toggleMyCost();
  updateEstimatedPrice();
}

function toggleResolutionVisibility() {
  const s = document.getElementById('status').value;
  const show = s === 'completed' || s === 'closed';
  if (els.resolutionWrap) {
    els.resolutionWrap.style.display = show ? '' : 'none';
  }
}

function updateEstimatedPrice() {
  const est = estimatePrice(getFormValues());
  const out = document.getElementById('estimated_price');
  if (out) out.value = isNaN(est) ? '' : formatCurrency(est);
}

function estimatePrice(it) {
  const laborTime = parseFloat(it.labor_time ?? 0) || 0;
  const laborRate = parseFloat(it.labor_cost_estimate ?? 0) || 0;
  const parts = parseFloat(it.parts_cost ?? 0) || 0;
  return laborTime * laborRate + parts;
}

function formatCurrency(n) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
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
    imgtag.style.cursor = 'zoom-in';
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
  currentId = updated.id;
  document.getElementById('item-id').value = updated.id;
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

// Autosave wiring
const fieldIds = ['title','description','status','priority','category','room','reported_by','next_action','due_by','resolution','labor_time','labor_cost_estimate','parts_cost','asking_for_reimbursement','my_cost'];
for (const id of fieldIds) {
  const el = document.getElementById(id);
  if (!el) continue;
  const isSelectLike = el.tagName === 'SELECT' || el.type === 'date';
  el.addEventListener(isSelectLike ? 'change' : 'input', () => {
    if (id === 'status') toggleResolutionVisibility();
    if (id === 'labor_time' || id === 'labor_cost_estimate' || id === 'parts_cost') updateEstimatedPrice();
    if (id === 'asking_for_reimbursement') onReimbToggle();
    scheduleAutosave(isSelectLike ? 300 : 600);
  });
}

function onReimbToggle() {
  const checked = document.getElementById('asking_for_reimbursement').checked;
  const wrap = document.getElementById('my_cost_wrap');
  if (wrap) wrap.style.display = checked ? '' : 'none';
  if (checked) {
    const myCostEl = document.getElementById('my_cost');
    const current = parseFloat(myCostEl.value || '0') || 0;
    if (!current) {
      const est = estimatePrice(getFormValues());
      myCostEl.value = isNaN(est) ? '0' : String(est.toFixed(2));
    }
  }
}

function toggleMyCost() {
  const checked = document.getElementById('asking_for_reimbursement').checked;
  const wrap = document.getElementById('my_cost_wrap');
  if (wrap) wrap.style.display = checked ? '' : 'none';
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
      // Merge into item
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
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, w, h);
  const webpBlob = await new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('WebP failed')), 'image/webp', 0.85));
  // Thumb
  const tw = 320; const tscale = Math.min(1, tw / w);
  const tw2 = Math.round(w * tscale); const th2 = Math.round(h * tscale);
  const tcan = document.createElement('canvas'); tcan.width = tw2; tcan.height = th2;
  const tctx = tcan.getContext('2d'); tctx.drawImage(canvas, 0, 0, tw2, th2);
  const thumbBlob = await new Promise((resolve, reject) => tcan.toBlob(b => b ? resolve(b) : reject(new Error('Thumb failed')), 'image/webp', 0.8));
  return { webpBlob, thumbBlob, width: w, height: h, takenAt: null };
}

// Initial load
loadItems().catch(err => console.error(err));

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
  // Require a title to create a new item
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
  el.classList.remove('saving','saved','error');
  if (state && state !== 'idle') el.classList.add(state);
  el.textContent = text || '';
}

// Metrics
function updateMetrics() {
  // Compute across ALL items, not filtered
  let totalEst = 0;
  let totalMyCost = 0;
  for (const it of items) {
    const est = estimatePrice(it);
    if (!isNaN(est)) totalEst += est;
    if (it.asking_for_reimbursement) {
      const mc = parseFloat(it.my_cost ?? 0) || 0;
      totalMyCost += mc;
    }
  }
  const saved = Math.max(0, totalEst - totalMyCost);
  const start = new Date('2025-10-01T00:00:00Z');
  const now = new Date();
  const days = Math.max(1, Math.ceil((now.getTime() - start.getTime()) / (1000*60*60*24)));
  const perDay = totalMyCost / days;
  const savedEl = document.getElementById('metric-saved');
  const perDayEl = document.getElementById('metric-perday');
  if (savedEl) savedEl.textContent = formatCurrency(saved);
  if (perDayEl) perDayEl.textContent = formatCurrency(perDay);
}


