// Fake Pi-hole v6 + Proxmox VE HTTP APIs (real paths, auth and envelopes) built from demo data.
import http from 'node:http';
import { makeDemo } from '../lib/demo.js';

export function startMocks({ piholePort = 0, proxmoxPort = 0, password = 'app-pass', token = 'precog@pve!ro=s3cret' } = {}) {
  const d = makeDemo();
  const sids = new Set();
  const calls = [];
  const send = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(body === undefined ? '' : JSON.stringify(body)); };

  const ph = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    calls.push(`pihole ${req.method} ${u.pathname}`);
    if (u.pathname === '/api/auth' && req.method === 'POST') {
      let b = '';
      req.on('data', (c) => (b += c));
      return req.on('end', () => {
        if (JSON.parse(b).password !== password) return send(res, 401, { session: { valid: false, totp: false, sid: null, validity: -1, message: 'password incorrect' } });
        const sid = 'sid' + sids.size;
        sids.add(sid);
        send(res, 200, { session: { valid: true, totp: true, sid, csrf: 'x', validity: 1800, message: 'app-password correct' } });
      });
    }
    if (!sids.has(req.headers['x-ftl-sid'])) return send(res, 401, { error: { key: 'unauthorized', message: 'Unauthorized', hint: null } });
    if (u.pathname === '/api/auth' && req.method === 'DELETE') { sids.delete(req.headers['x-ftl-sid']); return send(res, 204); }
    const p = d.pihole;
    const map = {
      '/api/stats/summary': p.summary, '/api/history': p.history, '/api/stats/top_clients': p.topClients,
      '/api/dns/blocking': p.blocking, '/api/network/devices': p.devices, '/api/network/gateway': p.gateway, '/api/info/version': p.version,
    };
    if (u.pathname === '/api/stats/top_domains') return send(res, 200, u.searchParams.get('blocked') === 'true' ? p.topBlocked : p.topPermitted);
    if (u.pathname === '/api/queries') return send(res, 200, d.queries({ length: Number(u.searchParams.get('length')), clientIp: u.searchParams.get('client_ip') }));
    if (map[u.pathname]) return send(res, 200, map[u.pathname]);
    send(res, 404, { error: { key: 'not_found', message: 'Not found' } });
  });

  const px = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    calls.push(`proxmox ${req.method} ${u.pathname}`);
    if (req.headers.authorization !== `PVEAPIToken=${token}`) { res.statusMessage = 'authentication failure'; return send(res, 401, { data: null }); }
    const P = d.proxmox;
    const path = u.pathname.replace('/api2/json', '');
    const n = P.nodes[0];
    let m;
    if (path === '/cluster/resources') return send(res, 200, { data: [
      ...P.nodes.map(({ info, tasks, ips, ...x }) => x),
      ...P.guests.map(({ mac, ips, staticIp, ...x }) => x),
      ...P.storages] });
    if (path === `/nodes/${n.node}/status`) return send(res, 200, { data: n.info });
    if (path === `/nodes/${n.node}/tasks`) return send(res, 200, { data: n.tasks });
    if (path === `/nodes/${n.node}/network`) return send(res, 200, { data: [{ iface: 'vmbr0', type: 'bridge', address: n.ips[0].ip, cidr: n.ips[0].cidr, active: 1 }, { iface: 'eno1', type: 'eth', active: 1 }] });
    if ((m = path.match(/^\/nodes\/\w+\/(lxc|qemu)\/(\d+)\/config$/))) {
      const g = P.guests.find((x) => x.vmid === Number(m[2]));
      return send(res, 200, { data: { hostname: g.name, net0: m[1] === 'lxc' ? `name=eth0,bridge=vmbr0,hwaddr=${g.mac.toUpperCase()},ip=dhcp,type=veth` : `virtio=${g.mac.toUpperCase()},bridge=vmbr0` } });
    }
    if ((m = path.match(/^\/nodes\/\w+\/lxc\/(\d+)\/interfaces$/))) {
      const g = P.guests.find((x) => x.vmid === Number(m[1]));
      return send(res, 200, { data: [{ name: 'lo', inet: '127.0.0.1/8', hwaddr: '00:00:00:00:00:00' }, { name: 'eth0', inet: `${g.ips[0]}/24`, hwaddr: g.mac }] });
    }
    if ((m = path.match(/^\/nodes\/\w+\/storage\/([\w-]+)\/content$/))) return send(res, 200, { data: P.backups.filter((b) => b.storage === m[1]).map((b) => ({ ...b, format: 'tar.zst', content: 'backup' })) });
    res.statusMessage = 'Not Implemented';
    send(res, 501, { data: null });
  });

  return Promise.all([new Promise((r) => ph.listen(piholePort, '127.0.0.1', r)), new Promise((r) => px.listen(proxmoxPort, '127.0.0.1', r))]).then(() => ({
    piholeUrl: `http://127.0.0.1:${ph.address().port}`, proxmoxUrl: `http://127.0.0.1:${px.address().port}`, password, token, calls, sids,
    close: () => { ph.close(); px.close(); },
  }));
}

if (process.argv[1]?.endsWith('mock-servers.js')) {
  const m = await startMocks({ piholePort: 18081, proxmoxPort: 18006 });
  console.log(`pihole ${m.piholeUrl}  proxmox ${m.proxmoxUrl}`);
}
