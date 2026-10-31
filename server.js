#!/usr/bin/env node
// CurveFive Precog: a read-only homelab dashboard for Pi-hole v6 + Proxmox VE. Zero dependencies.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { fileURLToPath } from 'node:url';
import { PiHole, Proxmox } from './lib/sources.js';
import { fuse, alerts, KINDS } from './lib/model.js';
import { makeDemo } from './lib/demo.js';

const env = process.env;
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(env.PORT || 8080);
const HOST = env.HOST || '0.0.0.0';
const POLL = Math.max(5, Number(env.POLL_SECONDS) || 15) * 1000;
const DEMO = env.DEMO === '1' || env.DEMO === 'true' || (!env.PIHOLE_URL && !env.PROXMOX_URL);
const AUTH = env.PRECOG_PASSWORD ? 'Basic ' + Buffer.from(`${env.PRECOG_USER || 'precog'}:${env.PRECOG_PASSWORD}`).toString('base64') : null;

const demo = DEMO ? makeDemo() : null;
const pihole = !DEMO && env.PIHOLE_URL ? new PiHole({ url: env.PIHOLE_URL, password: env.PIHOLE_PASSWORD }) : null;
const proxmox = !DEMO && env.PROXMOX_URL ? new Proxmox({
  url: env.PROXMOX_URL, tokenId: env.PROXMOX_TOKEN_ID, secret: env.PROXMOX_TOKEN_SECRET,
  insecure: env.PROXMOX_INSECURE_TLS === 'true', ca: env.PROXMOX_CA_FILE ? fs.readFileSync(env.PROXMOX_CA_FILE) : undefined,
}) : null;

let piholeHost = demo?.piholeHost || null;
if (pihole) {
  const h = new URL(env.PIHOLE_URL).hostname;
  piholeHost = await lookup(h).then((r) => r.address, () => h);
}

const state = { at: 0, demo: DEMO, sources: {}, devices: [], alerts: [], kinds: KINDS };
async function refresh() {
  const sources = {};
  const run = async (name, enabled, fn) => {
    if (!enabled) return (sources[name] = { status: 'off' }, null);
    const t0 = Date.now();
    try {
      const data = await fn();
      sources[name] = { status: data.warnings?.length ? 'partial' : 'ok', ms: Date.now() - t0, warnings: data.warnings || [] };
      return data;
    } catch (e) {
      sources[name] = { status: 'error', error: e.message };
      console.error(`[precog] ${name}: ${e.message}`);
      return null;
    }
  };
  const [ph, px] = await Promise.all([
    run('pihole', DEMO || !!pihole, () => (DEMO ? demo.pihole : pihole.snapshot())),
    run('proxmox', DEMO || !!proxmox, () => (DEMO ? demo.proxmox : proxmox.snapshot())),
  ]);
  const devices = fuse({ pihole: ph, proxmox: px, piholeHost });
  Object.assign(state, {
    at: Date.now(), sources, devices,
    alerts: alerts({ pihole: ph, proxmox: px, devices }),
    pihole: ph && { summary: ph.summary, history: ph.history?.history || [], topBlocked: ph.topBlocked?.domains || [], topPermitted: ph.topPermitted?.domains || [], blocking: ph.blocking?.blocking, version: ph.version?.version },
    proxmox: px && { nodes: px.nodes.map(({ tasks, ...n }) => ({ ...n, tasks: (tasks || []).slice(0, 25) })), storages: px.storages, guests: px.guests, backups: px.backups },
  });
}

// Live query feed: only polled while someone is watching.
const live = { rows: [], lastWanted: 0, busy: false };
async function pollLive() {
  if (Date.now() - live.lastWanted > 30e3 || live.busy || !(DEMO || pihole)) return;
  live.busy = true;
  try {
    const r = DEMO ? demo.queries({ length: 80 }) : await pihole.queries({ length: 80 });
    const known = new Set(live.rows.map((q) => q.id));
    const fresh = (r?.queries || []).filter((q) => !known.has(q.id)).reverse();
    live.rows.push(...fresh.map((q) => ({ id: q.id, time: q.time, domain: q.domain, status: q.status, type: q.type, ip: q.client?.ip, name: q.client?.name })));
    live.rows = live.rows.slice(-400);
  } catch (e) { console.error(`[precog] live: ${e.message}`); } finally { live.busy = false; }
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };
const SECURITY = {
  'content-security-policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; connect-src 'self'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
};
const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store', ...SECURITY }); res.end(JSON.stringify(body)); };
const authOk = (req) => {
  if (!AUTH) return true;
  const got = Buffer.from(req.headers.authorization || '');
  const want = Buffer.from(AUTH);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
};
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

const server = http.createServer((req, res) => handle(req, res).catch((e) => {
  console.error(`[precog] ${req.method} ${req.url}: ${e.message}`);
  if (!res.headersSent) json(res, 400, { error: 'bad request' }); else res.end();
}));

async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/healthz') return json(res, 200, { ok: true, at: state.at });
  if (!authOk(req)) { res.writeHead(401, { 'www-authenticate': 'Basic realm="precog"', ...SECURITY }); return res.end(); }
  if (req.method !== 'GET') return json(res, 405, { error: 'read-only' });

  if (url.pathname === '/api/state') return json(res, 200, state);
  if (url.pathname === '/api/live') {
    live.lastWanted = Date.now();
    const after = Number(url.searchParams.get('after') || 0);
    return json(res, 200, { rows: live.rows.filter((q) => q.id > after).slice(-120) });
  }
  if (url.pathname === '/api/device') {
    const ip = url.searchParams.get('ip') || '';
    if (!IPV4.test(ip)) return json(res, 400, { error: 'ip required' });
    try {
      const r = DEMO ? demo.queries({ length: 300, clientIp: ip }) : pihole ? await pihole.queries({ length: 300, clientIp: ip }) : { queries: [] };
      const counts = {};
      let blocked = 0;
      for (const q of r.queries || []) {
        const isBlocked = /GRAVITY|REGEX|DENYLIST|BLOCKED|SPECIAL/.test(q.status || '');
        if (isBlocked) blocked++;
        const c = (counts[q.domain] ||= { domain: q.domain, count: 0, blocked: isBlocked });
        c.count++;
      }
      return json(res, 200, { ip, sample: r.queries?.length || 0, blocked, domains: Object.values(counts).sort((a, b) => b.count - a.count).slice(0, 25) });
    } catch (e) { return json(res, 502, { error: e.message }); }
  }

  const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
  const file = path.join(PUBLIC, rel);
  if (!file.startsWith(PUBLIC + path.sep)) return json(res, 404, { error: 'not found' });
  fs.readFile(file, (err, buf) => {
    if (err) return json(res, 404, { error: 'not found' });
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache', ...SECURITY });
    res.end(buf);
  });
}

await refresh();
setInterval(() => refresh().catch((e) => console.error('[precog] refresh', e)), POLL).unref();
setInterval(pollLive, 2500).unref();
server.listen(PORT, HOST, () => {
  console.log(`[precog] ${DEMO ? 'DEMO MODE · ' : ''}listening on http://${HOST}:${PORT}${AUTH ? ' (password protected)' : ''}`);
  if (!AUTH && !DEMO && !/^(127\.|::1$|localhost$)/.test(HOST)) console.warn('[precog] WARNING: PRECOG_PASSWORD is not set; anyone who can reach this port sees your whole network');
  for (const [k, v] of Object.entries(state.sources)) console.log(`[precog] ${k}: ${v.status}${v.error ? ' · ' + v.error : ''}${v.warnings?.length ? ' · ' + v.warnings.join(' | ') : ''}`);
});
const stop = async () => { await pihole?.logout(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
