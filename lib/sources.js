// Read-only collectors for Pi-hole v6 and Proxmox VE. Only GET requests (plus Pi-hole login/logout).
import http from 'node:http';
import https from 'node:https';

export function request(url, { method = 'GET', headers = {}, body, insecure = false, ca, timeout = 8000 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    const h = { accept: 'application/json', ...headers };
    if (body) Object.assign(h, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
    const req = mod.request(u, { method, headers: h, rejectUnauthorized: !insecure, ca, timeout }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        let json = null;
        try { json = data ? JSON.parse(data) : null; } catch { /* non-JSON body */ }
        if (res.statusCode >= 400) {
          const detail = json?.error?.message || json?.errors && JSON.stringify(json.errors) || res.statusMessage || '';
          const e = new Error(`${u.host}${u.pathname} → HTTP ${res.statusCode} ${detail}`.trim());
          e.status = res.statusCode;
          return reject(e);
        }
        resolve(json);
      });
    });
    req.on('timeout', () => req.destroy(new Error(`timeout contacting ${u.host}`)));
    req.on('error', (e) => reject(e.code === 'DEPTH_ZERO_SELF_SIGNED_CERT' || e.code === 'SELF_SIGNED_CERT_IN_CHAIN'
      ? new Error(`${u.host}: self-signed certificate. Set PROXMOX_CA_FILE, or PROXMOX_INSECURE_TLS=true on a trusted LAN`)
      : e));
    if (body) req.write(body);
    req.end();
  });
}

const settle = async (p) => { try { return { ok: await p }; } catch (e) { return { err: e.message }; } };

export class PiHole {
  constructor({ url, password }) {
    this.base = url.replace(/\/+$/, '').replace(/\/admin$/, '') + '/api';
    this.password = password || '';
    this.sid = null;
    this.loggingIn = null;
  }

  login() {
    // One login at a time: Pi-hole caps concurrent sessions.
    this.loggingIn ??= request(this.base + '/auth', { method: 'POST', body: JSON.stringify({ password: this.password }) })
      .then((r) => {
        if (!r?.session?.valid) throw new Error(`Pi-hole login failed: ${r?.session?.message || 'check PIHOLE_PASSWORD (use an app password)'}`);
        this.sid = r.session.sid ?? ''; // '' = Pi-hole has no password
      })
      .finally(() => { this.loggingIn = null; });
    return this.loggingIn;
  }

  async get(path) {
    if (this.sid == null) await this.login();
    try {
      return await request(this.base + path, { headers: this.sid ? { 'X-FTL-SID': this.sid } : {} });
    } catch (e) {
      if (e.status !== 401) throw e;
      this.sid = null;
      await this.login();
      return request(this.base + path, { headers: this.sid ? { 'X-FTL-SID': this.sid } : {} });
    }
  }

  async logout() {
    if (this.sid) await request(this.base + '/auth', { method: 'DELETE', headers: { 'X-FTL-SID': this.sid } }).catch(() => {});
    this.sid = null;
  }

  async snapshot() {
    const parts = {
      summary: '/stats/summary',
      history: '/history',
      topClients: '/stats/top_clients?count=100',
      topBlocked: '/stats/top_domains?blocked=true&count=12',
      topPermitted: '/stats/top_domains?count=12',
      blocking: '/dns/blocking',
      devices: '/network/devices?max_devices=1000&max_addresses=8',
      gateway: '/network/gateway',
      version: '/info/version',
    };
    await this.get('/dns/blocking'); // fail fast (auth / reachability) before fanning out
    const keys = Object.keys(parts);
    const res = await Promise.all(keys.map((k) => settle(this.get(parts[k]))));
    const out = { warnings: [] };
    keys.forEach((k, i) => {
      out[k] = res[i].ok ?? null;
      if (res[i].err) out.warnings.push(`pihole ${parts[k]}: ${res[i].err}`);
    });
    return out;
  }

  queries({ length = 100, clientIp } = {}) {
    const q = new URLSearchParams({ length: String(length) });
    if (clientIp) q.set('client_ip', clientIp);
    return this.get('/queries?' + q);
  }
}

export class Proxmox {
  constructor({ url, tokenId, secret, insecure, ca }) {
    this.base = url.replace(/\/+$/, '') + '/api2/json';
    this.opts = { headers: { authorization: `PVEAPIToken=${tokenId}=${secret}` }, insecure, ca };
    this.configCache = new Map(); // `${type}/${vmid}` -> { at, mac }
  }

  get(path) { return request(this.base + path, this.opts).then((r) => r?.data); }

  async guestMac(g) {
    const key = `${g.type}/${g.vmid}`;
    const hit = this.configCache.get(key);
    if (hit && Date.now() - hit.at < 5 * 60e3) return hit.mac;
    const cfg = await this.get(`/nodes/${g.node}/${g.type}/${g.vmid}/config`);
    // lxc: net0=name=eth0,bridge=vmbr0,hwaddr=BC:24:11:..  qemu: net0=virtio=BC:24:11:..,bridge=vmbr0
    const m = String(cfg?.net0 || '').match(/([0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){5})/);
    const ipm = String(cfg?.net0 || '').match(/ip=([\d.]+)\//);
    const mac = m ? m[1].toLowerCase() : null;
    this.configCache.set(key, { at: Date.now(), mac, staticIp: ipm?.[1] || null });
    return mac;
  }

  async snapshot() {
    const warnings = [];
    const note = (what) => (e) => { warnings.push(`proxmox ${what}: ${e.message}`); return null; };
    const res = await this.get('/cluster/resources');
    const nodes = res.filter((r) => r.type === 'node');
    const guests = res.filter((r) => r.type === 'qemu' || r.type === 'lxc');
    const storages = res.filter((r) => r.type === 'storage');

    const nodeInfo = await Promise.all(nodes.map(async (n) => {
      if (n.status !== 'online') return { ...n };
      const [status, tasks, network] = await Promise.all([
        this.get(`/nodes/${n.node}/status`).catch(note(`node ${n.node} status (needs Sys.Audit)`)),
        this.get(`/nodes/${n.node}/tasks?limit=60`).catch(note(`node ${n.node} tasks`)),
        this.get(`/nodes/${n.node}/network`).catch(note(`node ${n.node} network (needs Sys.Audit)`)),
      ]);
      const ips = (network || []).filter((i) => i.address).map((i) => ({ iface: i.iface, ip: i.address, cidr: i.cidr }));
      return { ...n, status: n.status, info: status, tasks: tasks || [], ips };
    }));

    // MAC + live IPs per guest, so DNS clients can be mapped to containers/VMs.
    await Promise.all(guests.map(async (g) => {
      g.mac = await this.guestMac(g).catch(() => null);
      g.staticIp = this.configCache.get(`${g.type}/${g.vmid}`)?.staticIp || null;
      if (g.type === 'lxc' && g.status === 'running') {
        const ifs = await this.get(`/nodes/${g.node}/lxc/${g.vmid}/interfaces`).catch(() => null);
        g.ips = (ifs || []).filter((i) => i.name !== 'lo' && i.inet).map((i) => i.inet.split('/')[0]);
      }
    }));
    if (guests.some((g) => !g.mac)) warnings.push('proxmox: some guest configs unreadable (needs VM.Audit)');

    const seen = new Set();
    const backups = [];
    for (const s of storages) {
      if (!String(s.content || '').includes('backup') || s.status !== 'available') continue;
      const key = s.shared ? s.storage : `${s.node}/${s.storage}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const list = await this.get(`/nodes/${s.node}/storage/${s.storage}/content?content=backup`).catch(note(`backups on ${s.storage} (needs Datastore.Audit)`));
      for (const b of list || []) backups.push({ storage: s.storage, vmid: b.vmid, ctime: b.ctime, size: b.size, volid: b.volid });
    }
    return { nodes: nodeInfo, guests, storages, backups, warnings };
  }
}
