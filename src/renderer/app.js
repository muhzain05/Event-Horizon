/* Event Horizon — renderer logic */
const N = window.horizon;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* Hardware compatibility: which parts of the catalog apply to the detected machine. */
function compat(sc) {
  const gpu = sc.nvidia?.name || sc.gpus?.[0]?.name || '';
  const nvidia = /nvidia/i.test(gpu);
  const ram = Math.round(sc.ram.totalGB);
  const win11 = Number(sc.os.build) >= 22000;
  const sysDisk = sc.disks.find(d => (d.letters || '').includes('C:'));
  const ssd = sysDisk ? /ssd/i.test(sysDisk.media) : null;
  return {
    gpu, nvidia, ram, win11, ssd,
    checks: [
      ['Graphics', gpu || 'Unknown', nvidia, nvidia ? 'NVIDIA driver tweaks available' : 'NVIDIA-only tweaks will be disabled'],
      ['Memory', ram + ' GB', ram >= 16, ram >= 16 ? 'Memory-compression tweaks recommended' : 'Keep memory compression on below 16 GB'],
      ['Windows', `build ${sc.os.build}`, win11, win11 ? 'Windows 11 feature set' : 'Some Windows 11 tweaks will not apply'],
      ['System drive', sysDisk ? `${sysDisk.media} (${sysDisk.bus})` : 'Unknown', ssd !== false, ssd ? 'SSD tweaks apply' : 'Keep Prefetch and SysMain on for HDDs'],
    ],
  };
}

const S = {
  statusReady: false, info: null, tweaks: [], cats: {}, presets: {}, status: {}, busy: new Set(), rebootPending: false,
  boosts: [], boostOut: {}, scan: null, stats: [], prevProcs: null, programs: null, progTab: 'programs',
  catFilter: 'all', boostFilter: 'recommended', history: [], iconCache: {},
};
const RECO_BOOSTS = ['temp_clean', 'shader_cache', 'standby_list', 'dns_flush', 'prefetch_clean'];

/* ───────────── UI helpers ───────────── */
function toast(msg, kind = '', ms = 4200) {
  const el = document.createElement('div'); el.className = `toast ${kind}`; el.innerHTML = msg;
  $('#toasts').appendChild(el); setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, ms);
}
function confirmModal(title, body, okText = 'Continue') {
  return new Promise((res) => {
    $('#modal-title').textContent = title; $('#modal-body').textContent = body; $('#modal-ok').textContent = okText;
    $('#modal').classList.remove('hidden');
    const done = (v) => { $('#modal').classList.add('hidden'); $('#modal-ok').onclick = $('#modal-cancel').onclick = null; res(v); };
    $('#modal-ok').onclick = () => done(true); $('#modal-cancel').onclick = () => done(false);
  });
}
function go(page) {
  $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.page === page));
  $$('.page').forEach(p => p.classList.toggle('active', p.id === `page-${page}`));
  $('#content').scrollTop = 0;
  if (page === 'programs' && !S.programs) loadPrograms();
  if (page === 'settings') loadHistory();
}
function fmtMB(mb) { if (mb == null) return '—'; return mb >= 1024 ? (mb / 1024).toFixed(2) + ' GB' : mb.toFixed(0) + ' MB'; }
function timeAgo(iso) { const d = (Date.now() - new Date(iso)) / 1000; if (d < 60) return 'just now'; if (d < 3600) return Math.floor(d / 60) + 'm ago'; if (d < 86400) return Math.floor(d / 3600) + 'h ago'; return Math.floor(d / 86400) + 'd ago'; }

/* ───────────── rings & chart ───────────── */
function drawRing(id, pct, color) {
  const c = $(`#${id}`); const ctx = c.getContext('2d'); const w = c.width, h = c.height, r = w / 2 - 10;
  ctx.clearRect(0, 0, w, h);
  ctx.lineWidth = 9; ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(255,255,255,.07)'; ctx.beginPath(); ctx.arc(w / 2, h / 2, r, 0, Math.PI * 2); ctx.stroke();
  const g = ctx.createLinearGradient(0, 0, w, h); g.addColorStop(0, color[0]); g.addColorStop(1, color[1]);
  ctx.strokeStyle = g; ctx.shadowBlur = 14; ctx.shadowColor = color[0];
  ctx.beginPath(); ctx.arc(w / 2, h / 2, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0.01, pct / 100)); ctx.stroke();
}
function drawCpuChart() {
  const c = $('#cpu-chart'); const ctx = c.getContext('2d'); const w = c.width, h = c.height;
  ctx.clearRect(0, 0, w, h);
  const pts = S.stats.slice(-60).map(s => s.cpu.load ?? 0);
  ctx.strokeStyle = 'rgba(255,255,255,.06)'; ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) { const y = 10 + (h - 20) * i / 4; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
  if (pts.length < 2) return;
  const sx = w / 59, toY = v => h - 10 - (h - 20) * v / 100;
  const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, 'rgba(34,197,94,.35)'); g.addColorStop(1, 'rgba(34,197,94,0)');
  ctx.beginPath(); ctx.moveTo((60 - pts.length) * sx, toY(pts[0]));
  pts.forEach((v, i) => ctx.lineTo((60 - pts.length + i) * sx, toY(v)));
  ctx.lineTo((59) * sx, h); ctx.lineTo((60 - pts.length) * sx, h); ctx.closePath(); ctx.fillStyle = g; ctx.fill();
  ctx.beginPath(); pts.forEach((v, i) => { const x = (60 - pts.length + i) * sx; i ? ctx.lineTo(x, toY(v)) : ctx.moveTo(x, toY(v)); });
  ctx.strokeStyle = '#22c55e'; ctx.lineWidth = 2; ctx.shadowBlur = 8; ctx.shadowColor = '#22c55e'; ctx.stroke(); ctx.shadowBlur = 0;
  const lx = 59 * sx, ly = toY(pts[pts.length - 1]);
  ctx.fillStyle = '#22c55e'; ctx.beginPath(); ctx.arc(lx, ly, 4, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#04040c'; ctx.beginPath(); ctx.arc(lx, ly, 2, 0, Math.PI * 2); ctx.fill();
}

/* ───────────── live stats ───────────── */
function onStats(s) {
  try {
    S.stats.push(s); if (S.stats.length > 120) S.stats.shift();
    const cpu = s.cpu.load ?? 0; drawRing('ring-cpu', cpu, ['#22c55e', '#4ade80']); $('#ring-cpu-val').textContent = cpu + '%';
    $('#cpu-clock').textContent = `${(s.cpu.mhz / 1000).toFixed(2)} GHz · ${s.cpu.threads} threads${s.cpu.temp ? ' · ' + s.cpu.temp + '°C' : ''}`;
    drawCpuChart();
    const used = s.ram.totalMB - s.ram.freeMB, rp = Math.round(used / s.ram.totalMB * 100);
    drawRing('ring-ram', rp, ['#f5a524', '#ffcf6b']); $('#ring-ram-val').textContent = rp + '%';
    $('#ram-txt').textContent = `${(used / 1024).toFixed(1)} / ${(s.ram.totalMB / 1024).toFixed(0)} GB`;
    $('#ram-mini').innerHTML = `<div>In use <b>${(used / 1024).toFixed(1)} GB</b></div><div>Free <b>${(s.ram.freeMB / 1024).toFixed(1)} GB</b></div>`;
    if (s.gpu) {
      drawRing('ring-gpu', s.gpu.util, ['#3b82f6', '#22d3ee']); $('#ring-gpu-val').textContent = s.gpu.util + '%';
      $('#gpu-temp').textContent = `${Math.round(s.gpu.temp)}°C · ${Math.round(s.gpu.powerW)} W`;
      $('#gpu-mini').innerHTML = `<div>VRAM <b>${(s.gpu.memUsed / 1024).toFixed(1)} / ${(s.gpu.memTotal / 1024).toFixed(0)} GB</b></div><div>Core <b>${s.gpu.coreMHz} MHz</b></div><div>Memory <b>${s.gpu.memMHz} MHz</b></div><div>Fan <b>${s.gpu.fan ?? '—'}%</b></div>`;
    } else { $('#gpu-temp').textContent = 'nvidia-smi unavailable'; }
    // processes: CPU% from delta of CPU seconds
    const now = {}; s.procs.forEach(p => now[p.pid] = p);
    if (S.prevProcs) {
      const dt = (s.t - S.prevProcs.t) / 1000; const rows = [];
      for (const p of s.procs) { const prev = S.prevProcs.map[p.pid]; const pct = prev ? Math.max(0, (p.cpu - prev.cpu) / dt / s.cpu.threads * 100) : 0; rows.push({ ...p, pct }); }
      rows.sort((a, b) => b.pct - a.pct || b.memMB - a.memMB);
      $('#proc-list').innerHTML = rows.slice(0, 8).map(p => `<div class="prow"><span class="pn"><i style="background:${p.pct > 10 ? '#f5a524' : '#8b5cf6'}"></i>${esc(p.name)}</span><span class="pc ${p.pct > 10 ? 'hot' : ''}">${p.pct.toFixed(1)}%</span><span class="pm">${fmtMB(p.memMB)}</span></div>`).join('');
    }
    S.prevProcs = { t: s.t, map: now }; $('#proc-count').textContent = `${s.procCount} processes`;
  } catch (e) { /* ignore transient */ }
}

/* ───────────── profile ───────────── */
function renderProfile() {
  const sc = S.scan; const g = $('#profile-grid');
  if (!sc) { g.innerHTML = '<div class="pg"><span class="k">Status</span><span class="v">Scanning hardware…</span></div>'; return; }
  const c = compat(sc); const gpu = c.gpu || '—';
  const cpuOk = true, gpuOk = c.nvidia, ramOk = c.ram >= 16;
  const full = c.checks.every(x => x[2]);
  const pm = $('#profile-match'); pm.textContent = full ? '✓ Fully supported' : 'Partially supported'; pm.className = 'chip ' + (full ? 'chip-ok' : 'chip-warn');
  const sysVol = sc.volumes.find(v => v.letter === 'C:');
  g.innerHTML = [
    ['Processor', sc.cpu.name, cpuOk], ['Graphics', gpu + (sc.nvidia ? ` (${sc.nvidia.vramMB / 1024 | 0} GB)` : ''), gpuOk],
    ['Memory', `${sc.ram.totalGB} GB ${sc.ram.modules?.[0]?.speed ? '@ ' + sc.ram.modules[0].speed + ' MT/s' : ''}`, ramOk],
    ['Storage', sysVol ? `${sysVol.letter} ${(sysVol.sizeGB - sysVol.freeGB).toFixed(0)} / ${sysVol.sizeGB.toFixed(0)} GB used` : '—', null],
    ['Windows', `${sc.os.name.replace('Microsoft ', '')} · build ${sc.os.build}`, null],
    ['Power plan', sc.state.powerPlan, /Ultimate/.test(sc.state.powerPlan)],
    ['Driver', sc.nvidia?.driver ? `NVIDIA ${sc.nvidia.driver}` : sc.gpus?.[0]?.driver || '—', null],
    ['Security layers', `VBS ${sc.state.vbsRunning ? 'on' : 'off'} · HVCI ${sc.state.hvciRunning ? 'on' : 'off'} · HAGS ${sc.state.hags ? 'on' : 'off'}`, !sc.state.vbsRunning && sc.state.hags],
  ].map(([k, v, ok]) => `<div class="pg"><span class="k">${k}</span><span class="v ${ok ? 'ok' : ''}">${esc(v)}</span></div>`).join('');
  $('#dash-greeting').textContent = S.info?.demo ? 'Welcome back, Commander. Your system is in orbit.' : `Welcome back, ${sc.host.user}. ${sc.host.name} has been up ${sc.os.uptimeHours} h.`;
}
async function runScan(force) {
  if (!force) { S.scan = await N.scan.cached(); if (S.scan) { renderProfile(); renderScanPage(); } }
  try { S.scan = await N.scan.full(); renderProfile(); renderScanPage(); }
  catch (e) { toast('Scan failed: ' + esc(e.message), 'err'); }
}

/* ───────────── tweaks ───────────── */
function tweakState(id) { return !!S.status[id]; }
function updateTiles() {
  const active = S.tweaks.filter(t => tweakState(t.id)).length;
  const pending = S.tweaks.filter(t => t.recommended && !tweakState(t.id)).length;
  if (!S.statusReady) { $('#t-active').textContent = '…'; $('#t-pending').textContent = '…'; }
  else { $('#t-active').textContent = `${active} / ${S.tweaks.length}`; $('#t-pending').textContent = pending; }
  $('#t-boosts').textContent = S.history.filter(h => h.type === 'boost').length;
  const list = S.tweaks.filter(t => t.recommended).slice(0, 6);
  $('#dash-tweak-list').innerHTML = list.map(t => `<div class="row"><div><b>${esc(t.name)}</b><p>${esc(t.desc)}</p></div>${toggleHTML(t)}</div>`).join('');
}
function unsupported(t) { return t.requires === 'nvidia' && S.scan && !compat(S.scan).nvidia; }
function toggleHTML(t) { const on = tweakState(t.id); if (unsupported(t) && !on) return '<span class="lbl">Requires NVIDIA GPU</span>'; return `<button class="toggle ${on ? 'on' : ''} ${S.busy.has(t.id) ? 'busy' : ''}" data-toggle="${t.id}" title="${on ? 'Revert' : 'Apply'}"></button>`; }
function renderPresets() {
  const icons = { lite: '🌱', power: '⚡', max: '🕳' };
  $('#presets').innerHTML = Object.entries(S.presets).map(([k, p]) => {
    const done = p.ids.filter(id => tweakState(id)).length;
    return `<div class="preset glass ${k}"><div class="p-ico">${icons[k]}</div><div><b>${p.name} preset</b><p>${esc(p.blurb)}</p><div class="p-cnt">${done} / ${p.ids.length} applied</div></div><button class="btn btn-sm ${k === 'max' ? 'btn-danger' : 'btn-gold'}" data-preset="${k}">Apply</button></div>`;
  }).join('');
}
function renderCatChips() {
  const all = `<button class="chip-btn ${S.catFilter === 'all' ? 'active' : ''}" data-cat="all">All <span class="cnt">${S.tweaks.length}</span></button>`;
  $('#cat-chips').innerHTML = all + Object.entries(S.cats).map(([k, c]) => `<button class="chip-btn ${S.catFilter === k ? 'active' : ''}" data-cat="${k}">${c.glyph} ${c.name} <span class="cnt">${S.tweaks.filter(t => t.cat === k).length}</span></button>`).join('');
}
function renderTweaks() {
  const q = $('#f-search').value.trim().toLowerCase(), risk = $('#f-risk').value, reco = $('#f-reco').checked;
  const list = S.tweaks.filter(t => (S.catFilter === 'all' || t.cat === S.catFilter) && (!risk || t.risk === risk) && (!reco || t.recommended) && (!q || (t.name + ' ' + t.desc).toLowerCase().includes(q)));
  $('#tweak-grid').innerHTML = list.length ? list.map(t => `
    <div class="tcard glass ${tweakState(t.id) ? 'on' : ''}" data-card="${t.id}">
      <div class="tags"><span class="tag">${S.cats[t.cat].glyph} ${S.cats[t.cat].name}</span><span class="tag ${t.risk}">${t.risk} risk</span>${t.reboot ? '<span class="tag reboot">reboot</span>' : ''}${t.recommended ? '<span class="tag reco">★ recommended</span>' : ''}</div>
      <h3>${esc(t.name)}</h3><small class="muted tweak-id">ID: ${esc(t.id)}</small><p>${esc(t.desc)}</p>
      <div class="foot"><span class="lbl">${tweakState(t.id) ? 'Applied' : 'Not applied'}</span><div style="display:flex;align-items:center;gap:8px"><span class="lbl">${tweakState(t.id) ? 'Revert' : 'Activate'}</span>${toggleHTML(t)}</div></div>
    </div>`).join('') : '<div class="empty">No tweaks match.</div>';
  $('#reboot-banner').classList.toggle('hidden', !S.rebootPending);
}
function refreshTweakUI() { renderTweaks(); renderPresets(); updateTiles(); }

async function toggleTweak(id) {
  if (S.busy.has(id)) return;
  const t = S.tweaks.find(x => x.id === id); const on = tweakState(id);
  if (!S.info?.isAdmin && !t.userScope) { toast('Administrator rights are required. Relaunch as admin from the title bar.', 'warn'); return; }
  if (!on && t.risk === 'high') {
    const ok = await confirmModal(`High-risk tweak: ${t.name}`, `${t.desc}\n\nThis reduces Windows security isolation. Create a restore point first if you haven't. Continue?`, 'Apply anyway');
    if (!ok) return;
  }
  S.busy.add(id); refreshTweakUI();
  const r = await (on ? N.tweaks.revert(id) : N.tweaks.apply(id));
  S.busy.delete(id);
  if (r.ok) { S.status[id] = r.applied; toast(`${on ? 'Reverted' : 'Applied'}: <b>${esc(t.name)}</b>${t.reboot ? ' · reboot required' : ''}`, 'ok'); if (t.reboot) S.rebootPending = true; }
  else { S.status[id] = r.applied; toast(`Failed: <b>${esc(t.name)}</b><br><small>${esc(r.error || r.stderr || 'state did not change').slice(0, 200)}</small>`, 'err', 7000); }
  refreshTweakUI();
}
async function applyPreset(key) {
  const p = S.presets[key]; const todo = p.ids.filter(id => !tweakState(id));
  if (!todo.length) { toast('Preset already fully applied.', 'ok'); return; }
  const hasHigh = todo.some(id => S.tweaks.find(t => t.id === id).risk === 'high');
  const ok = await confirmModal(`Apply ${p.name} preset`, `${todo.length} tweaks will be applied.${hasHigh ? '\n\nIncludes HIGH-risk tweaks (VBS / HVCI / CPU mitigations). A restore point is strongly recommended.' : ''}`, `Apply ${todo.length} tweaks`);
  if (!ok) return;
  let n = 0;
  for (const id of todo) {
    S.busy.add(id); refreshTweakUI();
    const r = await N.tweaks.apply(id); S.busy.delete(id);
    S.status[id] = r.applied; if (r.ok) n++; if (r.ok && S.tweaks.find(t => t.id === id).reboot) S.rebootPending = true;
    refreshTweakUI();
  }
  toast(`${p.name} preset: ${n}/${todo.length} applied.`, n === todo.length ? 'ok' : 'warn');
}
async function revertAll() {
  const on = S.tweaks.filter(t => tweakState(t.id));
  if (!on.length) { toast('Nothing to revert.', 'ok'); return; }
  if (!await confirmModal('Revert all tweaks', `${on.length} tweaks will be reverted to Windows defaults.`, 'Revert all')) return;
  for (const t of on) { S.busy.add(t.id); refreshTweakUI(); const r = await N.tweaks.revert(t.id); S.busy.delete(t.id); S.status[t.id] = r.applied; refreshTweakUI(); }
  S.rebootPending = true; toast('All tweaks reverted. Reboot recommended.', 'ok');
}
async function loadTweaks() {
  const d = await N.tweaks.list(); S.tweaks = d.tweaks; S.cats = d.categories; S.presets = d.presets;
  renderCatChips(); refreshTweakUI();
  toast('Reading current tweak state from the registry, services and power settings…', '', 6000);
  try { S.status = await N.tweaks.checkAll(); S.statusReady = true; } catch (e) { toast('State check failed: ' + esc(e.message), 'err', 8000); }
  refreshTweakUI();
}

/* ───────────── boosts ───────────── */
function renderBoosts() {
  const cats = ['recommended', 'system', 'gaming', 'network', 'hardware'];
  $('#boost-chips').innerHTML = cats.map(c => `<button class="chip-btn ${S.boostFilter === c ? 'active' : ''}" data-bcat="${c}">${c[0].toUpperCase() + c.slice(1)}</button>`).join('');
  const list = S.boosts.filter(b => S.boostFilter === 'recommended' ? RECO_BOOSTS.includes(b.id) : b.cat === S.boostFilter);
  $('#boost-grid').innerHTML = list.map(b => {
    const last = S.history.find(h => h.type === 'boost' && h.id === b.id); const out = S.boostOut[b.id];
    return `<div class="bcard glass"><div class="b-top"><div class="b-ico">${b.glyph}</div><div><h3>${esc(b.name)}</h3><div class="b-cat">${b.cat}</div></div></div><p>${esc(b.desc)}</p>
      ${out ? `<div class="b-out ${out.ok ? '' : 'err'}">${esc(out.output || out.error)}</div>` : ''}
      <div class="foot"><span class="last">${last ? 'Last run ' + timeAgo(last.at) : 'Never run'}</span><button class="btn btn-sm btn-gold" data-run="${b.id}" ${S.busy.has('b:' + b.id) ? 'disabled' : ''}>${S.busy.has('b:' + b.id) ? 'Running…' : 'Run'}</button></div></div>`;
  }).join('');
}
async function runBoost(id) {
  if (S.busy.has('b:' + id)) return;
  const b = S.boosts.find(x => x.id === id);
  if (['event_logs', 'wu_cache', 'recycle_bin'].includes(id) && !await confirmModal(b.name, b.desc + '\n\nThis cannot be undone.', 'Run')) return;
  S.busy.add('b:' + id); renderBoosts(); toast(`Running <b>${esc(b.name)}</b>…`, '', 2500);
  const r = await N.boosts.run(id); S.busy.delete('b:' + id); S.boostOut[id] = r;
  S.history = await N.sys.history(); renderBoosts(); updateTiles();
  toast(`<b>${esc(b.name)}</b><br>${esc(r.output || r.error)}`, r.ok ? 'ok' : 'err', 6000);
}

/* ───────────── programs ───────────── */
async function loadPrograms() {
  $('#prog-table').innerHTML = '<div class="empty"><div class="spinner"></div>Enumerating installed software…</div>';
  try { S.programs = await N.programs.list(); } catch (e) { $('#prog-table').innerHTML = `<div class="empty">Failed: ${esc(e.message)}</div>`; return; }
  $('#cnt-programs').textContent = S.programs.programs.length; $('#cnt-apps').textContent = S.programs.apps.length; $('#cnt-startup').textContent = S.programs.startup.length;
  const total = S.programs.programs.reduce((a, p) => a + (p.sizeMB || 0), 0);
  $('#prog-summary').textContent = `${S.programs.programs.length} programs (${fmtMB(total)}), ${S.programs.apps.length} Store apps, ${S.programs.startup.length} startup entries.`;
  renderPrograms(); loadIcons();
}
async function loadIcons() {
  const want = [...new Set(S.programs.programs.map(p => p.icon).filter(Boolean))].filter(p => !(p in S.iconCache));
  for (let i = 0; i < want.length; i += 60) {
    const got = await N.programs.icons(want.slice(i, i + 60)); Object.assign(S.iconCache, got);
    $$('[data-icon]').forEach(el => { const src = S.iconCache[el.dataset.icon]; if (src && !el.querySelector('img')) el.innerHTML = `<img src="${src}">`; });
  }
}
function sorted(list, key) {
  const s = $('#prog-sort').value;
  return [...list].sort((a, b) => s === 'size' ? (b.sizeMB || 0) - (a.sizeMB || 0) : s === 'date' ? String(b.installDate || '').localeCompare(String(a.installDate || '')) : s === 'publisher' ? String(a.publisher).localeCompare(String(b.publisher)) : String(a[key]).localeCompare(String(b[key])));
}
function renderPrograms() {
  if (!S.programs) return;
  const q = $('#prog-search').value.trim().toLowerCase(); const el = $('#prog-table');
  if (S.progTab === 'programs') {
    const list = sorted(S.programs.programs, 'name').filter(p => !q || (p.name + p.publisher).toLowerCase().includes(q));
    el.innerHTML = `<div class="prow-h"><span></span><span>Name</span><span>Publisher</span><span>Version</span><span>Size</span><span>Installed</span><span></span></div>` +
      list.map((p, i) => `<div class="prow2"><div class="ic" data-icon="${esc(p.icon)}">${S.iconCache[p.icon] ? `<img src="${S.iconCache[p.icon]}">` : esc(p.name[0])}</div>
        <div class="nm">${esc(p.name)}<small>${p.hive === 'user' ? 'Current user' : 'All users'}${p.wow64 ? ' · 32-bit' : ''}</small></div><div class="mono">${esc(p.publisher || '—')}</div><div class="mono">${esc(p.version || '—')}</div><div class="mono">${fmtMB(p.sizeMB)}</div><div class="mono">${esc(p.installDate || '—')}</div>
        <div class="acts">${p.location ? `<button class="btn btn-ghost" data-open="${esc(p.location)}">Folder</button>` : ''}${p.quietUninstall || /msiexec/i.test(p.uninstall) ? `<button class="btn btn-ghost" data-uninst="${i}" data-silent="1">Silent</button>` : ''}<button class="btn btn-danger" data-uninst="${i}">Uninstall</button></div></div>`).join('');
    el._list = list;
  } else if (S.progTab === 'apps') {
    const list = sorted(S.programs.apps, 'display').filter(p => !q || (p.display + p.name + p.publisher).toLowerCase().includes(q));
    el.innerHTML = `<div class="prow-h"><span></span><span>App</span><span>Publisher</span><span>Version</span><span>Size</span><span>Package</span><span></span></div>` +
      list.map((p, i) => `<div class="prow2"><div class="ic">${p.logo ? `<img src="file:///${esc(p.logo.replace(/\\/g, '/'))}">` : esc(p.display[0])}</div>
        <div class="nm">${esc(p.display)}${p.bloat ? '<span class="badge-bloat">BLOAT</span>' : ''}<small>${esc(p.name)}</small></div><div class="mono">${esc(p.publisher)}</div><div class="mono">${esc(p.version)}</div><div class="mono">${fmtMB(p.sizeMB)}</div><div class="mono">${esc(p.fullName.split('_').pop())}</div>
        <div class="acts">${p.location ? `<button class="btn btn-ghost" data-open="${esc(p.location)}">Folder</button>` : ''}<button class="btn btn-danger" data-appx="${i}" ${p.nonRemovable ? 'disabled title="Marked non-removable by Windows"' : ''}>Remove</button></div></div>`).join('');
    el._list = list;
  } else {
    const list = [...S.programs.startup].filter(p => !q || (p.name + p.command).toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name));
    el.innerHTML = `<div class="prow-h startup"><span></span><span>Entry</span><span>Command</span><span>Scope</span><span></span></div>` +
      list.map((p, i) => `<div class="prow2 startup"><div class="ic">${p.source === 'Scheduled Task' ? '⏱' : p.source === 'Folder' ? '📁' : '✦'}</div><div class="nm">${esc(p.name)}<small>${esc(p.source)}</small></div><div class="mono" title="${esc(p.command)}">${esc(p.command)}</div><div class="mono">${esc(p.scope)}</div>
        <div class="acts"><button class="toggle ${p.enabled ? 'on' : ''}" data-startup="${i}"></button><button class="btn btn-danger" data-rmstart="${i}">Remove</button></div></div>`).join('');
    el._list = list;
  }
  if (!el._list.length) el.innerHTML += '<div class="empty">Nothing here.</div>';
}

/* ───────────── scan page ───────────── */
function renderScanPage() {
  const sc = S.scan; const el = $('#scan-body');
  if (!sc) { el.innerHTML = '<div class="glass panel wide empty"><div class="spinner"></div>Run a deep scan to inventory this machine.</div>'; return; }
  const gpu = sc.nvidia?.name || sc.gpus?.[0]?.name || '—';
  const kv = (rows) => `<div class="kv">${rows.map(([k, v]) => `<span class="k">${k}</span><span class="v">${esc(v ?? '—')}</span>`).join('')}</div>`;
  const panel = (title, body, wide) => `<div class="glass panel ${wide ? 'wide' : ''}"><div class="panel-head"><span class="ph-title">${title}</span></div>${body}</div>`;
  const m = (k, exp, got, ok) => `<div class="match ${ok ? 'ok' : 'no'}"><div class="k">${k}</div><div class="exp">Expected: ${esc(exp)}</div><div class="got">${esc(got)}</div></div>`;
  el.innerHTML =
    panel('◉ Hardware compatibility', `<div class="match-grid four">${compat(sc).checks.map(([k, v, ok, note]) => `<div class="match ${ok ? 'ok' : 'no'}"><div class="k">${k}</div><div class="got">${esc(v)}</div><div class="exp">${esc(note)}</div></div>`).join('')}</div>`, true) +
    panel('☀ Processor', kv([['Model', sc.cpu.name], ['Cores / threads', `${sc.cpu.cores} / ${sc.cpu.threads}`], ['Base clock', sc.cpu.baseMHz + ' MHz'], ['L2 / L3 cache', `${sc.cpu.l2KB / 1024} MB / ${sc.cpu.l3KB / 1024} MB`], ['Socket', sc.cpu.socket], ['Virtualization', sc.cpu.virt ? 'Enabled in firmware' : 'Disabled']])) +
    panel('◈ Graphics', kv([['GPU', gpu], ['VRAM', sc.nvidia ? sc.nvidia.vramMB + ' MB' : sc.gpus?.[0]?.vramMB + ' MB'], ['Driver', sc.nvidia?.driver || sc.gpus?.[0]?.driver], ['Driver date', sc.gpus?.[0]?.driverDate], ['PCIe', sc.nvidia ? `Gen ${sc.nvidia.pcieGen} x${sc.nvidia.pcieWidth}` : '—'], ['Power limit', sc.nvidia ? sc.nvidia.powerLimitW + ' W' : '—'], ['Max clocks', sc.nvidia ? `${sc.nvidia.maxCoreMHz} / ${sc.nvidia.maxMemMHz} MHz` : '—'], ['Display', `${sc.gpus?.[0]?.resolution} @ ${sc.gpus?.[0]?.refresh} Hz`], ['Monitors', sc.monitors.map(x => x.name).filter(Boolean).join(', ') || '—']])) +
    panel('▤ Memory', `<div class="list-rows">${sc.ram.modules.map(r => `<div class="lr"><b>${esc(r.bank)} — ${r.sizeGB} GB @ ${r.speed} MT/s</b><span>${esc(r.maker)} ${esc(r.part)}</span></div>`).join('')}</div>`) +
    panel('▣ Storage', `<div class="list-rows">${sc.disks.map(d => `<div class="lr"><b>${esc(d.model)} — ${d.sizeGB} GB ${esc(d.media)} (${esc(d.bus)})</b><span>${esc(d.letters)} · health ${esc(d.health)}</span></div>`).join('')}${sc.volumes.map(v => { const p = Math.round((v.sizeGB - v.freeGB) / v.sizeGB * 100); return `<div class="lr"><b>${v.letter} ${esc(v.label)} · ${v.freeGB} GB free of ${v.sizeGB} GB</b><div class="bar"><i class="${p > 90 ? 'warn' : ''}" style="width:${p}%"></i></div></div>`; }).join('')}</div>`) +
    panel('⟁ Network', `<div class="list-rows">${sc.nics.map(n => `<div class="lr"><b>${esc(n.name)} · ${esc(n.status)} · ${esc(n.speed)}</b><span>${esc(n.desc)} · ${esc(n.mac)}</span></div>`).join('') || '—'}</div>`) +
    panel('✦ System', kv([['Computer', sc.host.name], ['Motherboard', sc.host.board], ['BIOS', sc.host.bios], ['Windows', `${sc.os.name} ${sc.os.version}`], ['Installed', sc.os.installDate], ['Uptime', sc.os.uptimeHours + ' h'], ['Power plan', sc.state.powerPlan]])) +
    panel('🛡 Security & scheduler state', `<div class="state-chips">${[['VBS', sc.state.vbsRunning, true], ['HVCI (Memory Integrity)', sc.state.hvciRunning, true], ['HAGS', sc.state.hags, false], ['Game Mode', sc.state.gameMode, false], ['Secure Boot', sc.state.secureBoot, null], ['TPM', sc.state.tpm, null]].map(([k, v, badIfOn]) => `<span class="chip ${badIfOn === null ? '' : (v === badIfOn ? 'chip-warn' : 'chip-ok')}">${k}: ${v ? 'on' : 'off'}</span>`).join('')}</div><p class="muted" style="margin-top:10px">VBS and HVCI on = FPS left on the table. HAGS and Game Mode off = latency left on the table. The Optimizations page fixes all four.</p>`, true);
}

/* ───────────── settings ───────────── */
async function loadHistory() {
  S.history = await N.sys.history();
  $('#history').innerHTML = S.history.length ? S.history.slice(0, 80).map(h => `<div class="h"><time>${new Date(h.at).toLocaleString()}</time><i class="${h.ok === false ? 'bad' : ''}">${h.ok === false ? '✕' : '✓'}</i><span>${esc(h.type)} · ${esc(h.name)}${h.action ? ' · ' + h.action : ''}${h.output ? ' · ' + esc(h.output) : ''}</span></div>`).join('') : '<div class="empty">No activity yet.</div>';
  $('#set-admin').textContent = S.info?.isAdmin ? 'Elevated ✓' : 'Not elevated'; $('#set-admin').className = 'chip ' + (S.info?.isAdmin ? 'chip-ok' : 'chip-bad');
  updateTiles();
}

/* ───────────── events ───────────── */
document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-page],[data-go],[data-toggle],[data-preset],[data-cat],[data-bcat],[data-run],[data-boost],[data-tab],[data-uninst],[data-appx],[data-startup],[data-rmstart],[data-open]');
  if (!t) return;
  if (t.dataset.page) go(t.dataset.page);
  else if (t.dataset.go) go(t.dataset.go);
  else if (t.dataset.toggle) toggleTweak(t.dataset.toggle);
  else if (t.dataset.preset) applyPreset(t.dataset.preset);
  else if (t.dataset.cat) { S.catFilter = t.dataset.cat; renderCatChips(); renderTweaks(); }
  else if (t.dataset.bcat) { S.boostFilter = t.dataset.bcat; renderBoosts(); }
  else if (t.dataset.run) runBoost(t.dataset.run);
  else if (t.dataset.boost) { go('boosts'); runBoost(t.dataset.boost); }
  else if (t.dataset.tab) { S.progTab = t.dataset.tab; $$('#prog-tabs .chip-btn').forEach(b => b.classList.toggle('active', b === t)); renderPrograms(); }
  else if (t.dataset.open) N.programs.openLocation(t.dataset.open);
  else if (t.dataset.uninst) {
    const p = $('#prog-table')._list[+t.dataset.uninst]; const silent = !!t.dataset.silent;
    if (!await confirmModal(`Uninstall ${p.name}`, silent ? 'Runs the uninstaller silently with no prompts.' : 'The program\'s own uninstaller will open.', 'Uninstall')) return;
    t.disabled = true; t.textContent = 'Running…'; const r = await N.programs.uninstall(p, { silent });
    toast(r.ok ? `Uninstaller finished for <b>${esc(p.name)}</b>` : `Uninstall failed: ${esc(r.error)}`, r.ok ? 'ok' : 'err'); loadPrograms();
  } else if (t.dataset.appx) {
    const p = $('#prog-table')._list[+t.dataset.appx];
    if (!await confirmModal(`Remove ${p.display}`, 'Removes this Store app for the current user. It can be reinstalled from the Microsoft Store.', 'Remove')) return;
    t.disabled = true; const r = await N.programs.removeAppx(p.fullName);
    toast(r.ok ? `Removed <b>${esc(p.display)}</b>` : `Failed: ${esc(r.error)}`, r.ok ? 'ok' : 'err'); loadPrograms();
  } else if (t.dataset.startup) {
    const p = $('#prog-table')._list[+t.dataset.startup]; t.classList.add('busy');
    const r = await N.programs.setStartup(p, !p.enabled); if (r.ok) { p.enabled = !p.enabled; } else toast('Failed: ' + esc(r.error), 'err');
    renderPrograms();
  } else if (t.dataset.rmstart) {
    const p = $('#prog-table')._list[+t.dataset.rmstart];
    if (!await confirmModal(`Remove startup entry`, `${p.name}\n${p.command}\n\nThe program itself is not uninstalled.`, 'Remove')) return;
    const r = await N.programs.removeStartup(p); toast(r.ok ? 'Startup entry removed' : 'Failed: ' + esc(r.error), r.ok ? 'ok' : 'err'); loadPrograms();
  }
});
$('#f-search').addEventListener('input', renderTweaks); $('#f-risk').addEventListener('change', renderTweaks); $('#f-reco').addEventListener('change', renderTweaks);
$('#prog-search').addEventListener('input', renderPrograms); $('#prog-sort').addEventListener('change', renderPrograms);
$('#prog-refresh').onclick = loadPrograms;
$('#tweaks-recheck').onclick = async () => { toast('Re-checking tweak state…'); S.status = await N.tweaks.checkAll(); refreshTweakUI(); toast('State refreshed.', 'ok'); };
$('#dash-rescan').onclick = () => runScan(true); $('#scan-run').onclick = () => runScan(true);
$('#dash-apply-lite').onclick = () => applyPreset('lite');
$('#boost-all').onclick = async () => { for (const id of RECO_BOOSTS) await runBoost(id); };
$('#btn-reboot').onclick = $('#set-reboot').onclick = async () => { if (await confirmModal('Reboot now?', 'Windows will restart in 5 seconds.', 'Reboot')) N.sys.reboot(); };
$('#set-revert-all').onclick = revertAll; $('#set-refresh-log').onclick = loadHistory;
$('#set-open-data').onclick = () => N.sys.openPath(S.info.userData);
$('#btn-elevate').onclick = async () => { const ok = await N.sys.relaunchAdmin(); if (!ok) toast('Elevation was cancelled.', 'warn'); };
$('#win-min').onclick = () => N.win.minimize(); $('#win-max').onclick = () => N.win.maximize(); $('#win-close').onclick = () => N.win.close();
N.win.onState(s => $('#win-max').innerHTML = s.maximized ? '&#10697;' : '&#9633;');

/* ───────────── boot ───────────── */
(async () => {
  S.info = await N.sys.info(); $('#about-ver').textContent = 'v' + S.info.version;
  $('#admin-chip').classList.toggle('hidden', S.info.isAdmin || S.info.demo);
  S.boosts = await N.boosts.list(); S.history = await N.sys.history(); renderBoosts();
  renderProfile(); renderScanPage();
  N.stats.onTick(onStats);
  setTimeout(() => { if (!S.stats.length) { $('#cpu-clock').textContent = 'stats worker not responding'; toast('Live stats worker did not start. Check stats-worker.log in the data folder (Settings).', 'warn', 8000); } }, 12000);
  loadTweaks();
  runScan(false);
})();
