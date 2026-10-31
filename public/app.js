// Precog front end. No framework; every value from the network is inserted as text, never HTML.
const $ = (s) => document.querySelector(s);
const SVG = 'http://www.w3.org/2000/svg';
function h(tag, attrs = {}, ...kids) {
  const svg = ['svg', 'g', 'circle', 'line', 'path', 'text', 'rect', 'polyline', 'defs', 'radialGradient', 'linearGradient', 'stop'].includes(tag);
  const n = svg ? document.createElementNS(SVG, tag) : document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') for (const [p, x] of Object.entries(v)) p.startsWith('--') ? n.style.setProperty(p, x) : (n.style[p] = x);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) n.append(c instanceof Node ? c : String(c));
  return n;
}
const fmt = new Intl.NumberFormat();
const n0 = (x) => (x == null ? '–' : fmt.format(Math.round(x)));
const bytes = (b) => { if (!b && b !== 0) return '–'; const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; while (b >= 1024 && i < 4) { b /= 1024; i++; } return `${b.toFixed(b < 10 && i ? 1 : 0)} ${u[i]}`; };
const ago = (ts) => { if (!ts) return '–'; const s = Date.now() / 1000 - ts; if (s < 90) return 'just now'; if (s < 3600) return `${Math.round(s / 60)} min ago`; if (s < 172800) return `${Math.round(s / 3600)} h ago`; return `${Math.round(s / 86400)} days ago`; };
const dur = (s) => { if (!s) return '–'; const d = Math.floor(s / 86400), h_ = Math.floor(s % 86400 / 3600); return d ? `${d}d ${h_}h` : `${h_}h ${Math.floor(s % 3600 / 60)}m`; };
const hhmm = (ts) => new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const keySel = (id) => (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(id); } };
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const short = (n) => n.replace(/\.(lan|home|local|home\.arpa)$/, '');

const KCOLOR = {
  gateway: '#ffffff', network: '#b9a7ff', dns: '#6cf0ff', hypervisor: '#ffb54d', container: '#ffd59a', vm: '#ffc46b',
  phone: '#6cf0ff', tablet: '#6fd3f2', laptop: '#9fd9ff', tv: '#ff9fd2', speaker: '#d6a6ff', iot: '#4dff9d',
  printer: '#c7d3dd', console: '#ff8f70', server: '#ffe08a', unknown: '#4f6f84',
};
const GLYPH = { gateway: '◇', network: '⌁', dns: '◎', hypervisor: '▣', container: '▢', vm: '▤', phone: '▯', tablet: '▭', laptop: '⌨', tv: '▬', speaker: '◉', iot: '✳', printer: '⎙', console: '◈', server: '▥', unknown: '?' };
const BLOCKED = /GRAVITY|REGEX|DENYLIST|BLOCKED|SPECIAL/;
const C = 500; // map centre
const VB0 = { x: -20, y: -20, w: 1040 };

const S = { state: null, sel: null, kinds: new Set(), q: '', sort: { k: 'queries24h', dir: -1 }, pos: new Map(), byIp: new Map(), lastLive: 0, paused: false, pulses: [], vb: { ...VB0 }, view: 'map', dragged: false };

// ---------- data ----------
async function load() {
  try {
    const r = await fetch('api/state', { cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    S.state = await r.json();
    S.byIp = new Map();
    for (const d of S.state.devices) for (const ip of d.ips) S.byIp.set(ip, d);
    render();
    boot(S.state);
  } catch (e) {
    boot(null, e.message);
    $('#sources').replaceChildren(h('span', { class: 'src error' }, h('i'), `precog unreachable: ${e.message}`));
  }
}
async function live() {
  if (S.paused) return;
  try {
    const r = await (await fetch(`api/live?after=${S.lastLive}`, { cache: 'no-store' })).json();
    if (!r.rows?.length) return;
    S.lastLive = r.rows[r.rows.length - 1].id;
    const list = $('#stream');
    for (const q of r.rows.slice(-40)) {
      const d = S.byIp.get(q.ip);
      list.prepend(h('li', { class: BLOCKED.test(q.status || '') ? 'b' : '' }, h('span', { class: 't' }, hhmm(q.time)), h('span', { class: 'd', title: q.domain }, q.domain), h('span', { class: 'c' }, d?.name || q.name || q.ip)));
      pulse(q.ip, BLOCKED.test(q.status || ''));
    }
    while (list.children.length > 200) list.lastChild.remove();
  } catch { /* transient */ }
}

// ---------- boot sequence ----------
let booted = false;
function boot(st, err) {
  if (booted) return;
  booted = true;
  const box = $('#boot'), log = $('#bootlog');
  const done = () => { box.classList.add('done'); setTimeout(() => box.remove(), 500); };
  box.addEventListener('click', done);
  let seen = false;
  try { seen = sessionStorage.getItem('precog-booted') === '1'; sessionStorage.setItem('precog-booted', '1'); } catch { /* storage blocked */ }
  if (reduced || (seen && !err)) return box.remove();
  const lines = st ? [
    'PRECOG v0.1 // curvefive homelab sight',
    `> mode ${st.demo ? 'DEMO · synthetic homelab' : 'LIVE'} · read-only`,
    ...Object.entries(st.sources).map(([k, v]) => [`> uplink ${k.padEnd(8)} ${v.status === 'off' ? 'skipped' : v.status === 'error' ? `FAILED  ${v.error}` : `OK      ${v.ms} ms`}`, v.status === 'error']),
    `> fused ${st.devices.length} nodes · ${st.devices.filter((d) => d.guest).length} guests · ${st.devices.filter((d) => d.online).length} up`,
    `> foresight ${st.alerts.length} signal${st.alerts.length === 1 ? '' : 's'}`,
    '> rendering constellation',
  ] : ['PRECOG v0.1', [`> uplink precog FAILED  ${err}`, true]];
  lines.forEach((l, i) => setTimeout(() => {
    const [text, bad] = Array.isArray(l) ? l : [l, false];
    log.append(h('span', { class: bad ? 'err' : '' }, text + '\n'));
    if (i === lines.length - 1 && st) setTimeout(done, 450);
  }, 140 * i));
}

// ---------- render ----------
function render() {
  const st = S.state;
  renderSources(st);
  renderDns(st.pihole);
  renderKinds(st.devices);
  renderMap(st.devices);
  renderAlerts(st.alerts);
  renderPve(st.proxmox, st.devices);
  renderTable(st.devices);
  if (S.sel) renderInspector(st.devices.find((d) => d.id === S.sel), false);
  const up = st.devices.filter((d) => d.online).length;
  $('#foot').textContent = `● ${st.demo ? 'DEMO' : 'LIVE'} · read-only · sync ${new Date(st.at).toLocaleTimeString([], { hour12: false })} · ${st.devices.length} nodes / ${up} up · ${st.alerts.length} signals`;
}

function renderSources(st) {
  const box = $('#sources');
  box.replaceChildren(...Object.entries(st.sources).filter(([, v]) => v.status !== 'off').map(([k, v]) => {
    const label = k === 'pihole' ? 'pihole' : 'pve';
    const why = v.error || (v.warnings || []).join('\n') || `ok · ${v.ms} ms`;
    return h('span', { class: `src ${v.status}`, title: why }, h('i'), label, h('small', {}, v.status === 'error' ? 'down' : v.status === 'partial' ? 'partial' : `${v.ms}ms`));
  }));
  if (st.demo) box.prepend(h('span', { class: 'src partial', title: 'No PIHOLE_URL / PROXMOX_URL set' }, h('i'), 'demo'));
}

function renderDns(p) {
  if (!p) { $('#pct').textContent = '–'; $('#dnskv').replaceChildren(h('dt', {}, 'pi-hole not connected')); return; }
  const q = p.summary?.queries || {};
  $('#pct').textContent = q.percent_blocked != null ? q.percent_blocked.toFixed(1) : '–';
  const kv = [
    ['lookups today', n0(q.total)], ['stopped', n0(q.blocked)], ['from cache', q.total ? `${Math.round(100 * q.cached / q.total)}%` : '–'],
    ['active clients', n0(p.summary?.clients?.active)], ['blocklist size', n0(p.summary?.gravity?.domains_being_blocked)],
    ['lists updated', ago(p.summary?.gravity?.last_update)], ['blocking', p.blocking === 'enabled' ? 'ON' : (p.blocking || '–')],
  ];
  $('#dnskv').replaceChildren(...kv.flatMap(([k, v]) => [h('dt', {}, k), h('dd', { class: k === 'blocking' && v !== 'ON' ? 'bad' : '' }, v)]));
  drawHist(p.history || []);
  const top = p.topBlocked || [];
  const max = Math.max(1, ...top.map((d) => d.count));
  $('#blocked').replaceChildren(...top.slice(0, 8).map((d) => h('li', { style: { '--w': `${(100 * d.count / max).toFixed(1)}%` } }, h('span', { class: 'd', title: d.domain }, d.domain), h('span', { class: 'n' }, n0(d.count)))));
}

function drawHist(hist) {
  const svg = $('#hist');
  svg.replaceChildren();
  if (hist.length < 2) return;
  const W = 300, H = 90, max = Math.max(1, ...hist.map((x) => x.total));
  const x = (i) => (i / (hist.length - 1)) * W, y = (v) => H - (v / max) * (H - 6);
  const area = (k) => `M0,${H} ` + hist.map((p, i) => `L${x(i).toFixed(1)},${y(p[k]).toFixed(1)}`).join(' ') + ` L${W},${H} Z`;
  svg.append(
    h('defs', {}, h('linearGradient', { id: 'ga', x1: 0, y1: 0, x2: 0, y2: 1 }, h('stop', { offset: 0, 'stop-color': '#6cf0ff', 'stop-opacity': .45 }), h('stop', { offset: 1, 'stop-color': '#6cf0ff', 'stop-opacity': 0 }))),
    h('path', { d: area('total'), fill: 'url(#ga)' }),
    h('polyline', { points: hist.map((p, i) => `${x(i).toFixed(1)},${y(p.total).toFixed(1)}`).join(' '), fill: 'none', stroke: '#6cf0ff', 'stroke-width': 1.2, 'vector-effect': 'non-scaling-stroke' }),
    h('path', { d: area('blocked'), fill: 'rgba(255,77,106,.5)' }),
  );
  const hours = Math.round((hist.at(-1).timestamp - hist[0].timestamp) / 3600);
  $('#histspan').textContent = `last ${hours}h`;
}

function renderKinds(devices) {
  const counts = {};
  for (const d of devices) counts[d.kind] = (counts[d.kind] || 0) + 1;
  $('#kinds').replaceChildren(...Object.keys(S.state.kinds).filter((k) => counts[k]).map((k) =>
    h('button', { 'aria-pressed': S.kinds.has(k) ? 'true' : 'false', onclick: () => { S.kinds.has(k) ? S.kinds.delete(k) : S.kinds.add(k); renderKinds(devices); applyFilter(); } },
      h('i', { style: { background: KCOLOR[k] } }), `${S.state.kinds[k].toLowerCase()} ${counts[k]}`)));
}

const matches = (d) => {
  if (S.kinds.size && !S.kinds.has(d.kind)) return false;
  if (!S.q) return true;
  const hay = [d.name, ...d.names, ...d.ips, d.mac, d.vendor, S.state.kinds[d.kind], d.guest?.name, d.guest?.vmid].join(' ').toLowerCase();
  return S.q.split(/\s+/).every((t) => hay.includes(t));
};

// ---------- constellation ----------
function layout(devices) {
  const pos = new Map();
  const hubs = devices.filter((d) => d.kind === 'hypervisor');
  const gw = devices.find((d) => d.kind === 'gateway');
  const dns = devices.find((d) => d.kind === 'dns');
  if (dns) pos.set(dns.id, { x: C, y: C, r: 0 });
  if (gw) pos.set(gw.id, { x: C - 215, y: C + 40, r: 15, a: Math.PI });
  const hubAng = hubs.map((_, i) => (-20 + i * 70) * Math.PI / 180);
  hubs.forEach((hb, i) => pos.set(hb.id, { x: C + 205 * Math.cos(hubAng[i]), y: C + 205 * Math.sin(hubAng[i]), r: 15, a: hubAng[i] }));
  const size = (d) => 5 + Math.min(10, 2.6 * Math.log10(1 + (d.queries24h || 0)));
  for (const [i, hb] of hubs.entries()) {
    const gs = devices.filter((d) => d.guest && d.guest.node === hb.node).sort((a, b) => a.guest.vmid - b.guest.vmid);
    const p = pos.get(hb.id);
    const rr = Math.min(160, 70 + gs.length * 2.8);
    gs.forEach((g, k) => {
      const a = hubAng[i] + (k / gs.length) * 2 * Math.PI;
      pos.set(g.id, { x: p.x + rr * Math.cos(a), y: p.y + rr * Math.sin(a), r: size(g), hub: hb.id, a });
    });
  }
  // everything else (and guests whose node has no IP) sits on the outer rings, grouped by type
  const order = Object.keys(S.state.kinds);
  const outer = devices.filter((d) => !pos.has(d.id)).sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || b.queries24h - a.queries24h);
  const gaps = hubAng.map((a) => [a - 0.95, a + 0.95]);
  const free = (a) => !gaps.some(([lo, hi]) => { const n = ((a - lo) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI); return n < hi - lo; });
  const slots = [];
  for (let s = 0; s < 720; s++) { const a = (s / 720) * 2 * Math.PI; if (free(a)) slots.push(a); }
  const per = Math.max(outer.length, 1);
  const rings = outer.length > 46 ? [455, 395] : [430];
  outer.forEach((d, i) => {
    const a = slots.length ? slots[Math.floor((i + 0.5) * slots.length / per)] : (i / per) * 2 * Math.PI;
    const R = rings[i % rings.length];
    pos.set(d.id, { x: C + R * Math.cos(a), y: C + R * Math.sin(a), r: size(d), a });
  });
  return pos;
}

function label(d, p, pri) {
  const a = p.a ?? Math.atan2(p.y - C, p.x - C);
  const cos = Math.cos(a), sin = Math.sin(a);
  const lx = p.x + cos * (p.r + 7), ly = p.y + sin * (p.r + 7) + (Math.abs(cos) <= 0.3 ? Math.sign(sin) * 10 : 4);
  const anchor = cos > 0.3 ? 'start' : cos < -0.3 ? 'end' : 'middle';
  const big = d.kind === 'gateway' || d.kind === 'hypervisor';
  const sub = [d.ips[0], d.guest ? `${d.guest.type === 'qemu' ? 'vm' : 'ct'} ${d.guest.vmid}` : d.vendor.split(/[ ,]/)[0]].filter(Boolean).join(' · ');
  return [
    h('text', { class: `lbl${pri ? ' pri' : ''}${big ? ' big' : ''}`, 'data-id': d.id, x: lx, y: ly, 'text-anchor': anchor }, short(d.name)),
    h('text', { class: 'sub', x: lx, y: ly, dy: '1.25em', 'text-anchor': anchor }, sub),
  ];
}

function renderMap(devices) {
  const svg = $('#map');
  S.pos = layout(devices);
  const g = h('g');
  const ticks = [];
  for (let deg = 0; deg < 360; deg += 5) {
    const a = deg * Math.PI / 180, r1 = 478, r2 = deg % 30 ? 484 : 492;
    ticks.push(h('line', { class: 'tick', x1: C + r1 * Math.cos(a), y1: C + r1 * Math.sin(a), x2: C + r2 * Math.cos(a), y2: C + r2 * Math.sin(a) }));
  }
  g.append(
    h('defs', {}, h('radialGradient', { id: 'core' }, h('stop', { offset: 0, 'stop-color': '#6cf0ff', 'stop-opacity': .5 }), h('stop', { offset: 1, 'stop-color': '#6cf0ff', 'stop-opacity': 0 })),
      h('linearGradient', { id: 'sw', x1: 0, y1: 0, x2: 1, y2: 0 }, h('stop', { offset: 0, 'stop-color': '#4dff9d', 'stop-opacity': 0 }), h('stop', { offset: 1, 'stop-color': '#4dff9d', 'stop-opacity': .3 }))),
    ...[110, 205, 330, 430].map((r, i) => h('circle', { class: `ring${i === 1 ? ' major' : ''}`, cx: C, cy: C, r })),
    ...ticks,
  );
  if (!reduced) g.append(h('path', { class: 'sweep', d: `M${C},${C} L${C + 470},${C} A470,470 0 0,0 ${C + 470 * Math.cos(-0.35)},${C + 470 * Math.sin(-0.35)} Z`, fill: 'url(#sw)', opacity: .5 }));
  const spokes = h('g'), nodes = h('g'), labels = h('g');
  const top = new Set(devices.filter((d) => !d.guest && d.kind !== 'dns').sort((a, b) => b.queries24h - a.queries24h).slice(0, 7).map((d) => d.id));
  for (const d of devices) {
    const p = S.pos.get(d.id);
    if (!p || d.kind === 'dns') continue;
    const to = p.hub ? S.pos.get(p.hub) : { x: C, y: C };
    spokes.append(h('line', { class: 'spoke', 'data-id': d.id, x1: p.x, y1: p.y, x2: to.x, y2: to.y }));
  }
  g.append(h('circle', { cx: C, cy: C, r: 95, fill: 'url(#core)' }));
  for (const d of devices) {
    const p = S.pos.get(d.id);
    if (!p) continue;
    const col = KCOLOR[d.kind];
    const act = { tabindex: 0, role: 'button', onclick: () => !S.dragged && select(d.id), onkeydown: keySel(d.id) };
    if (d.kind === 'dns') {
      nodes.append(h('g', { class: 'node', 'data-id': d.id, 'aria-label': `${d.name}, DNS filter`, ...act },
        h('circle', { class: 'body', cx: C, cy: C, r: 54, stroke: col, style: { color: col } }),
        h('text', { class: 'core-t', x: C, y: C + 4 }, 'PI-HOLE'), h('text', { class: 'core-s', x: C, y: C + 4, dy: '1.7em' }, d.ips[0] || '')));
      continue;
    }
    const cls = `node${d.online ? '' : ' off'}${d.isNew ? ' new' : ''}${S.sel === d.id ? ' sel' : ''}`;
    nodes.append(h('g', { class: cls, 'data-id': d.id, 'aria-label': `${d.name}, ${S.state.kinds[d.kind]}${d.online ? '' : ', offline'}`, ...act, onmouseenter: (e) => tip(e, d), onmouseleave: () => tip() },
      d.isNew ? h('circle', { class: 'halo', cx: p.x, cy: p.y, r: p.r + 6 }) : null,
      h('circle', { class: 'body', cx: p.x, cy: p.y, r: p.r, stroke: col, style: { color: col } })));
    labels.append(...label(d, p, (!p.hub && top.has(d.id)) || d.kind === 'gateway' || d.kind === 'hypervisor'));
  }
  g.append(spokes, nodes, labels, h('g', { id: 'reticle' }), h('g', { id: 'pulses' }));
  svg.replaceChildren(g);
  drawReticle();
  const offline = devices.filter((d) => !d.online).length;
  $('#poolnote').textContent = `${devices.length} nodes · ${devices.length - offline} up · ${devices.filter((d) => d.guest).length} guests · scroll to zoom, drag to pan · red light = blocked lookup`;
  applyFilter();
}

function drawReticle() {
  const layer = document.getElementById('reticle');
  if (!layer) return;
  const p = S.sel && S.pos.get(S.sel);
  if (!p) return layer.replaceChildren();
  const r = (p.r || 54) + 9, k = r * 0.45;
  const corners = `M${-r},${-r + k}V${-r}H${-r + k} M${r - k},${-r}H${r}V${-r + k} M${r},${r - k}V${r}H${r - k} M${-r + k},${r}H${-r}V${r - k}`;
  layer.replaceChildren(h('g', { class: 'reticle', transform: `translate(${p.x},${p.y})` }, h('g', { class: 'spin' }, h('path', { d: corners }))));
}

function applyFilter() {
  const devs = S.state.devices;
  const ok = new Set(devs.filter(matches).map((d) => d.id));
  for (const n of document.querySelectorAll('#map .node')) n.classList.toggle('dim', !ok.has(n.dataset.id));
  for (const t of document.querySelectorAll('#map .lbl')) t.classList.toggle('hide', !ok.has(t.dataset.id));
  renderTable(devs);
}

function tip(e, d) {
  const t = $('#tip');
  if (!e) { t.hidden = true; return; }
  t.replaceChildren(h('b', {}, d.name), `${S.state.kinds[d.kind]} · ${d.ips[0] || d.mac || ''}`, h('br'), `${n0(d.queries24h)} lookups today`);
  const box = $('.stage').getBoundingClientRect();
  t.style.left = `${Math.min(e.clientX - box.left + 14, box.width - 240)}px`;
  t.style.top = `${e.clientY - box.top + 14}px`;
  t.hidden = false;
}

function pulse(ip, blocked) {
  if (reduced || S.view !== 'map') return;
  const d = S.byIp.get(ip);
  const p = d && S.pos.get(d.id);
  const layer = document.getElementById('pulses');
  if (!p || !layer || S.pulses.length > 60) return;
  const col = blocked ? '#ff4d6a' : '#6cf0ff';
  const c = h('circle', { class: 'pulse', r: 3.2, fill: col, cx: p.x, cy: p.y, style: { filter: `drop-shadow(0 0 4px ${col})` } });
  layer.append(c);
  const spoke = document.querySelector(`#map .spoke[data-id="${CSS.escape(d.id)}"]`);
  spoke?.classList.add('lit');
  const hub = p.hub ? S.pos.get(p.hub) : null;
  const path = hub ? [p, hub, { x: C, y: C }] : [p, { x: C, y: C }];
  S.pulses.push({ c, path, t0: performance.now() + Math.random() * 1500, dur: 1100 + Math.random() * 500, blocked, spoke });
}
function animate(now) {
  S.pulses = S.pulses.filter((pl) => {
    const t = (now - pl.t0) / pl.dur;
    if (t < 0) return true;
    if (t >= 1 || !pl.c.isConnected) { pl.c.remove(); pl.spoke?.classList.remove('lit'); return false; }
    const segs = pl.path.length - 1, f = Math.min(segs - 1e-6, t * segs), i = Math.floor(f), u = f - i;
    const a = pl.path[i], b = pl.path[i + 1];
    const end = pl.blocked ? 0.86 : 1; // blocked lookups die at the shield
    const k = i === segs - 1 ? u * end : u;
    pl.c.setAttribute('cx', a.x + (b.x - a.x) * k);
    pl.c.setAttribute('cy', a.y + (b.y - a.y) * k);
    pl.c.setAttribute('opacity', pl.blocked && i === segs - 1 && u > .8 ? (1 - u) * 5 : 1);
    return true;
  });
  requestAnimationFrame(animate);
}

// ---------- zoom & pan ----------
function setVB(v) {
  const w = Math.max(90, Math.min(1400, v.w));
  const cx = Math.max(0, Math.min(1000, v.x + v.w / 2)), cy = Math.max(0, Math.min(1000, v.y + v.w / 2));
  S.vb = { x: cx - w / 2, y: cy - w / 2, w };
  const svg = $('#map'), k = VB0.w / w;
  svg.setAttribute('viewBox', `${S.vb.x} ${S.vb.y} ${w} ${w}`);
  svg.style.setProperty('--k', k);
  svg.classList.toggle('z1', k > 1.7);
  svg.classList.toggle('z2', k > 3);
  $('#zread').textContent = `${k.toFixed(1)}x · x${Math.round(cx)} y${Math.round(cy)}`;
}
const toSvg = (cx, cy) => new DOMPoint(cx, cy).matrixTransform($('#map').getScreenCTM().inverse());
function zoomAt(f, p) {
  const w = Math.max(90, Math.min(1400, S.vb.w * f)), r = w / S.vb.w;
  setVB({ x: p.x - (p.x - S.vb.x) * r, y: p.y - (p.y - S.vb.y) * r, w });
}
let flight = 0;
function flyTo(to) {
  const id = ++flight, from = { ...S.vb }, t0 = performance.now();
  if (reduced) return setVB(to);
  const step = (now) => {
    if (id !== flight) return;
    const t = Math.min(1, (now - t0) / 550), e = t < .5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
    setVB({ x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, w: from.w + (to.w - from.w) * e });
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
const centre = () => ({ x: S.vb.x + S.vb.w / 2, y: S.vb.y + S.vb.w / 2 });
function wireMap() {
  const svg = $('#map');
  svg.addEventListener('wheel', (e) => { e.preventDefault(); flight++; zoomAt(Math.exp(e.deltaY * 0.0015), toSvg(e.clientX, e.clientY)); }, { passive: false });
  svg.addEventListener('dblclick', (e) => { if (!e.target.closest('.node')) flyTo(zoomTarget(0.5, toSvg(e.clientX, e.clientY))); });
  const pts = new Map();
  let start = null;
  svg.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    start = { pts: new Map(pts), vb: { ...S.vb }, upx: 1 / svg.getScreenCTM().a };
    S.dragged = false;
    flight++;
  });
  window.addEventListener('pointermove', (e) => {
    if (!start || !pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const [a, b] = [...pts.values()], [a0, b0] = [...start.pts.values()];
    if (pts.size >= 2 && b0) { // pinch
      const d0 = Math.hypot(a0.x - b0.x, a0.y - b0.y), d1 = Math.hypot(a.x - b.x, a.y - b.y);
      S.vb = { ...start.vb };
      zoomAt(d0 / Math.max(d1, 1), toSvg((a0.x + b0.x) / 2, (a0.y + b0.y) / 2));
      S.dragged = true;
      return;
    }
    const dx = a.x - a0.x, dy = a.y - a0.y;
    if (!S.dragged && Math.hypot(dx, dy) < 4) return;
    S.dragged = true;
    svg.classList.add('drag');
    setVB({ x: start.vb.x - dx * start.upx, y: start.vb.y - dy * start.upx, w: start.vb.w });
  });
  const end = (e) => {
    pts.delete(e.pointerId);
    if (pts.size) { start = { pts: new Map(pts), vb: { ...S.vb }, upx: 1 / svg.getScreenCTM().a }; return; }
    start = null;
    svg.classList.remove('drag');
    setTimeout(() => { S.dragged = false; }, 0); // let the click after a drag see it
  };
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
  $('#z-in').onclick = () => flyTo(zoomTarget(0.6, centre()));
  $('#z-out').onclick = () => flyTo(zoomTarget(1 / 0.6, centre()));
  $('#z-reset').onclick = () => flyTo(VB0);
}
const zoomTarget = (f, p) => { const w = Math.max(90, Math.min(1400, S.vb.w * f)), r = w / S.vb.w; return { x: p.x - (p.x - S.vb.x) * r, y: p.y - (p.y - S.vb.y) * r, w }; };

// ---------- panels ----------
function renderAlerts(list) {
  $('#alcount').textContent = list.length ? String(list.length) : '';
  $('#alerts').replaceChildren(...(list.length ? list.map((a) => h('li', { class: a.level }, h('b', {}, a.title), a.detail ? h('span', {}, a.detail) : null))
    : [h('li', { class: 'empty' }, 'Nothing needs attention.')]));
}

function gauge(label, frac, text) {
  const r = 30, c = 2 * Math.PI * r, f = Math.max(0, Math.min(1, frac || 0));
  return h('div', { class: 'gauge' }, h('svg', { viewBox: '0 0 74 74' },
    h('circle', { class: 'track', cx: 37, cy: 37, r }),
    h('circle', { class: 'val', cx: 37, cy: 37, r, 'stroke-dasharray': `${(c * f).toFixed(1)} ${c.toFixed(1)}`, style: f > .85 ? { stroke: 'var(--red)' } : f > .7 ? { stroke: 'var(--amber)' } : {} }),
    h('text', { x: 37, y: 42 }, text ?? `${Math.round(f * 100)}%`)), label);
}

function renderPve(px, devices) {
  const box = $('#pve');
  if (!px) { box.replaceChildren(h('p', { class: 'empty' }, 'proxmox not connected. Set PROXMOX_URL and an API token.')); return; }
  const nodeCol = h('div');
  for (const n of px.nodes) {
    const i = n.info || {};
    nodeCol.append(
      h('div', { class: 'node-h' }, h('b', {}, n.node), h('span', {}, n.status === 'online' ? `online · up ${dur(n.uptime)}` : n.status)),
      h('div', { class: 'gauges' }, gauge('cpu', n.cpu), gauge('mem', n.maxmem ? n.mem / n.maxmem : 0), gauge('disk', i.rootfs ? i.rootfs.used / i.rootfs.total : n.maxdisk ? n.disk / n.maxdisk : 0)),
      h('p', { class: 'small' }, i.cpuinfo?.model || `${n.maxcpu} CPUs`, h('br'), `${bytes(n.mem)} / ${bytes(n.maxmem)} · load ${(i.loadavg || []).join(' ') || '–'}`, h('br'), (i.pveversion || '').split('/').slice(0, 2).join(' ')),
    );
  }
  const lastDump = px.nodes.flatMap((n) => n.tasks || []).filter((t) => t.type === 'vzdump' && t.status === 'OK').sort((a, b) => b.starttime - a.starttime)[0];
  const newestArchive = Math.max(0, ...(px.backups || []).map((b) => b.ctime));
  nodeCol.append(h('p', { class: 'small' }, `last backup ${ago(newestArchive || lastDump?.starttime)}${lastDump ? ` (took ${dur(lastDump.endtime - lastDump.starttime)})` : ''} · ${(px.backups || []).length} archives`));

  const guests = [...px.guests].sort((a, b) => a.vmid - b.vmid);
  const running = guests.filter((g) => g.status === 'running').length;
  const guestCol = h('div', {}, h('h3', {}, `guests ${running}/${guests.length} up`), h('div', { class: 'guests' }, ...guests.map((g) => {
    const dev = devices.find((d) => d.guest?.vmid === g.vmid);
    return h('button', { class: `guest ${g.status}`, title: `${g.type === 'qemu' ? 'VM' : 'Container'} ${g.vmid} · ${bytes(g.mem)} / ${bytes(g.maxmem)}${dev?.ips[0] ? ' · ' + dev.ips[0] : ''}`, onclick: () => dev && focusDevice(dev.id) },
      h('b', {}, g.name), h('span', {}, `${g.vmid} · ${g.type === 'qemu' ? 'vm' : 'ct'}`), h('div', { class: 'm' }, h('i', { style: { width: `${g.maxmem ? (100 * g.mem / g.maxmem).toFixed(0) : 0}%` } })));
  })));

  const stor = h('div', {}, h('h3', {}, 'storage'), h('ul', { class: 'stor' }, ...px.storages.filter((s) => s.maxdisk).map((s) => {
    const f = s.disk / s.maxdisk;
    return h('li', { class: f >= .85 ? 'crit' : f >= .7 ? 'warn' : '' }, h('div', { class: 'row' }, h('span', {}, `${s.storage} `, h('span', { class: 'small' }, s.plugintype)), h('span', { class: 'small' }, `${bytes(s.disk)} / ${bytes(s.maxdisk)}`)), h('div', { class: 'bar' }, h('i', { style: { width: `${(100 * f).toFixed(1)}%` } })));
  })));
  const tasks = px.nodes.flatMap((n) => n.tasks || []).sort((a, b) => b.starttime - a.starttime).slice(0, 7);
  stor.append(h('h3', {}, 'recent tasks'), h('ul', { class: 'tasks' }, ...tasks.map((t) => h('li', { class: t.status && t.status !== 'OK' ? 'bad' : '', title: t.status || 'running' }, h('span', { class: 't' }, ago(t.starttime)), `${t.type}${t.id ? ' ' + t.id : ''}${t.status && t.status !== 'OK' ? ' · failed' : !t.status ? ' · running' : ''}`))));
  box.replaceChildren(h('div', { class: 'pvegrid' }, nodeCol, guestCol, stor));
}

function whereOf(d) {
  if (d.guest) return `${d.guest.node} · ${d.guest.type === 'qemu' ? 'vm' : 'ct'} ${d.guest.vmid}`;
  if (d.kind === 'gateway') return 'edge';
  if (d.kind === 'hypervisor') return 'host';
  return 'lan';
}
function renderTable(devices) {
  const { k, dir } = S.sort;
  const val = (d) => k === 'ip' ? d.ips[0]?.split('.').map((x) => x.padStart(3, '0')).join('.') || '' : k === 'where' ? whereOf(d) : k === 'kind' ? S.state.kinds[d.kind] : d[k] ?? '';
  const rows = devices.filter(matches).sort((a, b) => { const x = val(a), y = val(b); return (x > y ? 1 : x < y ? -1 : 0) * dir; });
  $('#devcount').textContent = rows.length === devices.length ? String(devices.length) : `${rows.length}/${devices.length}`;
  for (const th of document.querySelectorAll('#devtable th')) {
    if (th.dataset.k === k) th.setAttribute('aria-sort', dir > 0 ? 'ascending' : 'descending'); else th.removeAttribute('aria-sort');
  }
  $('#devtable tbody').replaceChildren(...rows.map((d) => h('tr', { class: `${d.online ? '' : 'off'}${S.sel === d.id ? ' sel' : ''}`, tabindex: 0, onclick: () => select(d.id), onkeydown: keySel(d.id) },
    h('td', {}, h('span', { class: 'dotk', style: { background: KCOLOR[d.kind] } }), d.name, d.isNew ? h('span', { class: 'tag' }, 'new') : null),
    h('td', {}, S.state.kinds[d.kind].toLowerCase()),
    h('td', {}, d.ips[0] || '–'),
    h('td', {}, d.vendor || (d.privateMac ? 'private wi-fi address' : '–')),
    h('td', { class: 'num' }, n0(d.queries24h)),
    h('td', {}, d.guest ? d.guest.status : ago(d.lastSeen)),
    h('td', {}, whereOf(d)))));
}

function setView(v) {
  S.view = v;
  $('#map').toggleAttribute('hidden', v !== 'map');
  $('#zoomui').hidden = v !== 'map';
  $('#list').hidden = v !== 'list';
  $('#v-map').setAttribute('aria-pressed', String(v === 'map'));
  $('#v-list').setAttribute('aria-pressed', String(v === 'list'));
}

function select(id) {
  S.sel = id;
  for (const n of document.querySelectorAll('#map .node')) n.classList.toggle('sel', n.dataset.id === id);
  renderTable(S.state.devices);
  drawReticle();
  renderInspector(S.state.devices.find((x) => x.id === id), true);
  const p = S.pos.get(id);
  if (!p || S.view !== 'map') return;
  // land the target left of centre so the inspector HUD doesn't cover it
  const r = $('#map').getBoundingClientRect(), w = 340, shift = r.width > 700 ? 0.24 * w * Math.max(1, r.width / r.height) : 0;
  flyTo({ x: p.x + shift - w / 2, y: p.y - w / 2, w });
}
function focusDevice(id) {
  closeMax();
  setView('map');
  select(id);
}
function deselect() {
  S.sel = null;
  $('#inspector').hidden = true;
  for (const n of document.querySelectorAll('#map .node.sel')) n.classList.remove('sel');
  drawReticle();
  renderTable(S.state.devices);
}

async function renderInspector(d, fetchDomains) {
  const box = $('#inspector');
  if (!d) return deselect();
  box.hidden = false;
  const col = KCOLOR[d.kind];
  const kv = [
    ['status', d.guest ? d.guest.status : d.online ? 'active' : 'quiet'], ['address', d.ips.join(', ') || '–'],
    ['hw', d.mac ? `${d.mac}${d.privateMac ? ' (private)' : ''}` : '–'], ['maker', d.vendor || (d.privateMac ? 'randomized' : 'unknown')],
    ['lives on', whereOf(d)], ['lookups 24h', n0(d.queries24h)], ['lookups all', n0(d.lifetimeQueries)],
    ['first seen', ago(d.firstSeen)], ['last seen', d.guest ? '–' : ago(d.lastSeen)],
  ];
  if (d.guest) kv.push(['cpu', `${((d.guest.cpu || 0) * 100).toFixed(1)}% of ${d.guest.maxcpu}`], ['mem', `${bytes(d.guest.mem)} / ${bytes(d.guest.maxmem)}`], ['uptime', dur(d.guest.uptime)]);
  if (d.names.length > 1) kv.push(['aka', d.names.slice(1).join(', ')]);
  const domains = h('div', { class: 'domwrap' }, h('h3', {}, 'talks to'), h('p', { class: 'small' }, d.ips[0] ? 'reading recent lookups…' : 'no IP address to look up.'));
  box.replaceChildren(
    h('button', { class: 'close', 'aria-label': 'Close inspector', onclick: deselect }, '×'),
    h('h2', { id: 'ins-h' }, 'TARGET_LOCK'),
    h('div', { class: 'ident', style: { color: col } }, h('div', { class: 'glyph', 'aria-hidden': 'true' }, GLYPH[d.kind]), h('div', {}, h('b', { style: { color: 'var(--ice)' } }, d.name), h('span', {}, S.state.kinds[d.kind]))),
    h('dl', { class: 'kv' }, ...kv.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])), domains);
  if (!fetchDomains && box.dataset.for === d.id && box._domains) { domains.replaceWith(box._domains); return; }
  box.dataset.for = d.id;
  const ip = d.ips.find((x) => /^\d+\.\d+\.\d+\.\d+$/.test(x));
  if (!ip) return;
  try {
    const r = await (await fetch(`api/device?ip=${encodeURIComponent(ip)}`)).json();
    if (S.sel !== d.id) return;
    const node = h('div', { class: 'domwrap' }, h('h3', {}, 'talks to'),
      r.sample ? h('p', { class: 'small' }, `last ${r.sample} lookups · ${Math.round(100 * r.blocked / r.sample)}% stopped`) : h('p', { class: 'small' }, 'no recent lookups in memory.'),
      h('ul', { class: 'doms' }, ...(r.domains || []).map((x) => h('li', { class: x.blocked ? 'b' : '' }, h('span', { title: x.domain }, x.domain), h('span', { class: 'small' }, String(x.count))))));
    box._domains = node;
    box.querySelector('.domwrap')?.replaceWith(node);
  } catch { /* leave placeholder */ }
}

// expand a panel to fill the screen
function closeMax() {
  for (const p of document.querySelectorAll('.panel.max')) p.classList.remove('max');
  $('#scrim').hidden = true;
}
for (const b of document.querySelectorAll('.max-btn')) b.addEventListener('click', () => {
  const p = b.closest('.panel'), was = p.classList.contains('max');
  closeMax();
  if (!was) { p.classList.add('max'); $('#scrim').hidden = false; }
});
$('#scrim').addEventListener('click', closeMax);

// ---------- wiring ----------
$('#q').addEventListener('input', (e) => { S.q = e.target.value.trim().toLowerCase(); applyFilter(); });
document.addEventListener('keydown', (e) => {
  const typing = e.target.matches?.('input, textarea');
  if (e.key === '/' && !typing) { e.preventDefault(); $('#q').focus(); return; }
  if (e.key === 'Escape') {
    if (document.querySelector('.panel.max')) return closeMax();
    if (S.sel) return deselect();
    $('#q').value = ''; S.q = ''; S.kinds.clear(); renderKinds(S.state.devices); applyFilter(); $('#q').blur();
    return;
  }
  if (typing || S.view !== 'map') return;
  if (e.key === '+' || e.key === '=') flyTo(zoomTarget(0.6, centre()));
  if (e.key === '-') flyTo(zoomTarget(1 / 0.6, centre()));
  if (e.key === '0') flyTo(VB0);
});
for (const th of document.querySelectorAll('#devtable th')) th.addEventListener('click', () => {
  const k = th.dataset.k;
  S.sort = { k, dir: S.sort.k === k ? -S.sort.dir : (k === 'queries24h' || k === 'lastSeen' ? -1 : 1) };
  renderTable(S.state.devices);
});
$('#v-map').addEventListener('click', () => setView('map'));
$('#v-list').addEventListener('click', () => setView('list'));
$('#pause').addEventListener('click', (e) => { S.paused = !S.paused; e.target.textContent = S.paused ? 'resume' : 'pause'; e.target.setAttribute('aria-pressed', String(S.paused)); });
const tickClock = () => { $('#clock').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }); };
setInterval(tickClock, 1000); tickClock();

wireMap();
setVB(VB0);
await load();
setInterval(load, 15000);
setInterval(live, 2500);
live();
requestAnimationFrame(animate);
