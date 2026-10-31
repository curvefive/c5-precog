// Synthetic homelab in the exact shapes the Pi-hole v6 and Proxmox APIs return.
// Used for DEMO=1 and by the mock servers in test/.

const NET = '10.42.0.';
const now = () => Math.floor(Date.now() / 1000);
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const mac = (oui, i) => `${oui}:${(i >> 8 & 255).toString(16).padStart(2, '0')}:${(i & 255).toString(16).padStart(2, '0')}:${(i * 7 & 255).toString(16).padStart(2, '0')}`;

const PEOPLE = [
  ['nova-iphone', 'Apple, Inc.', '3c:22:fb', 9200], ['atlas-pixel', 'Google, Inc.', '58:24:29', 4100],
  ['studio-macbook', 'Apple, Inc.', 'a4:83:e7', 7600], ['work-laptop', 'Intel Corporate', '8c:8d:28', 5400],
  ['family-ipad', 'Apple, Inc.', 'f0:18:98', 1300], ['living-room-tv', 'LG Electronics', '78:5d:c8', 2400],
  ['kitchen-echo', 'Amazon Technologies Inc.', '44:65:0d', 1900], ['hall-cam', 'Espressif Inc.', '24:0a:c4', 860],
  ['desk-plug', 'TP-LINK TECHNOLOGIES CO.,LTD.', '50:c7:bf', 700], ['porch-light', 'Signify B.V.', '00:17:88', 320],
  ['mesh-node-1', 'NETGEAR', 'a0:40:a0', 1500], ['mesh-node-2', 'NETGEAR', 'a0:40:a1', 1400],
  ['office-printer', 'Hewlett Packard', '3c:52:82', 120], ['ps5', 'Sony Interactive Entertainment Inc.', '78:c8:81', 640],
  ['', '', 'da:a1:19', 2100], ['', '', '9e:4f:22', 980], ['', 'Raspberry Pi Trading Ltd', 'dc:a6:32', 3100],
  ['thermostat', 'ecobee inc', '44:61:32', 260], ['robot-vacuum', 'iRobot Corporation', '50:14:79', 210],
];
const GUESTS = [
  ['homeassistant', 'lxc'], ['grafana', 'lxc'], ['prometheus', 'lxc'], ['paperless', 'lxc'], ['gitea', 'lxc'],
  ['caddy', 'lxc'], ['n8n', 'lxc'], ['jellyfin', 'lxc'], ['searxng', 'lxc'], ['docker', 'lxc'], ['dev-vm', 'qemu'], ['win11', 'qemu'],
];
const DOMAINS = ['api.weather.example', 'cdn.streaming.example', 'ocsp.pki.example', 'time.example.org', 'updates.os.example', 'mail.example.com', 'photos.cloud.example', 'git.example.dev', 'news.example.net', 'maps.example.com'];
const ADS = ['ads.tracker.example', 'telemetry.vendor.example', 'metrics.app.example', 'pixel.adnet.example', 'beacon.analytics.example', 'doubleclick.example'];

export function makeDemo() {
  const t = now();
  const devices = [];
  const clients = [];
  PEOPLE.forEach(([name, vendor, oui, count], i) => {
    const ip = NET + (20 + i);
    const firstSeen = i === 18 ? t - 3600 : t - 86400 * (30 + i);
    devices.push({ id: i + 1, hwaddr: mac(oui, i), interface: 'eth0', firstSeen, lastQuery: t - Math.floor(rnd() * (i % 5 === 4 ? 4000 : 300)), numQueries: count * 40, macVendor: vendor || null, ips: [{ ip, name: name ? `${name}.lan` : null, lastSeen: t - 60, nameUpdated: t - 600 }] });
    clients.push({ ip, name: name ? `${name}.lan` : '', count });
  });
  const routerMac = 'a0:40:a0:00:00:01';
  devices.push({ id: 90, hwaddr: routerMac, interface: 'eth0', firstSeen: t - 9e6, lastQuery: t - 30, numQueries: 90000, macVendor: 'NETGEAR', ips: [{ ip: NET + '1', name: 'router.lan', lastSeen: t - 30, nameUpdated: t }] });
  clients.push({ ip: NET + '1', name: 'router.lan', count: 3300 });
  devices.push({ id: 91, hwaddr: 'b8:27:eb:00:00:02', interface: 'lo', firstSeen: t - 9e6, lastQuery: t - 5, numQueries: 30000, macVendor: 'Raspberry Pi Foundation', ips: [{ ip: NET + '2', name: 'pihole.lan', lastSeen: t, nameUpdated: t }] });
  devices.push({ id: 92, hwaddr: '00:1f:c6:00:00:03', interface: 'eth0', firstSeen: t - 9e6, lastQuery: t - 20, numQueries: 50000, macVendor: 'ASUSTek COMPUTER INC.', ips: [{ ip: NET + '10', name: 'pve.lan', lastSeen: t, nameUpdated: t }] });
  clients.push({ ip: NET + '10', name: 'pve.lan', count: 2600 });

  const guests = GUESTS.map(([name, type], i) => {
    const vmid = 100 + i;
    const gmac = `bc:24:11:00:${vmid.toString(16).padStart(2, '0')}:${(i + 16).toString(16)}`;
    const ip = NET + (100 + i);
    const running = !(name === 'win11');
    if (i < 9) {
      devices.push({ id: 200 + i, hwaddr: gmac, interface: 'eth0', firstSeen: t - 86400 * 60, lastQuery: t - 40, numQueries: 2000 + i * 300, macVendor: 'Proxmox Server Solutions GmbH', ips: [{ ip, name: `${name}.lan`, lastSeen: t - 40, nameUpdated: t }] });
      clients.push({ ip, name: `${name}.lan`, count: 200 + i * 90 });
    }
    return { id: `${type}/${vmid}`, type, vmid, name, node: 'pve', status: running ? 'running' : 'stopped', cpu: running ? rnd() * 0.08 : 0, maxcpu: type === 'qemu' ? 4 : 2, mem: running ? (200 + rnd() * 900) * 2 ** 20 : 0, maxmem: 2 * 2 ** 30, disk: 4 * 2 ** 30, maxdisk: 16 * 2 ** 30, uptime: running ? 86400 * 12 : 0, mac: gmac, ips: running && type === 'lxc' ? [ip] : [], staticIp: ip };
  });
  clients.sort((a, b) => b.count - a.count);
  const total = clients.reduce((s, c) => s + c.count, 0);
  const blocked = Math.round(total * 0.13);

  const history = [];
  for (let k = 143; k >= 0; k--) {
    const ts = t - k * 600;
    const hour = new Date(ts * 1000).getHours();
    const base = 300 + 500 * Math.max(0, Math.sin((hour - 6) / 24 * Math.PI * 2)) + rnd() * 120;
    const b = Math.round(base * (0.1 + rnd() * 0.06));
    history.push({ timestamp: ts, total: Math.round(base), cached: Math.round(base * 0.7), blocked: b, forwarded: Math.round(base * 0.2) });
  }

  const pihole = {
    summary: { queries: { total, blocked, percent_blocked: 100 * blocked / total, unique_domains: 3120, forwarded: Math.round(total * 0.14), cached: Math.round(total * 0.72), frequency: 0.9, types: {}, status: {}, replies: {} }, clients: { active: clients.length, total: clients.length + 2 }, gravity: { domains_being_blocked: 294155, last_update: t - 3 * 86400 } },
    history: { history },
    topClients: { clients, total_queries: total, blocked_queries: blocked },
    topBlocked: { domains: ADS.map((d, i) => ({ domain: d, count: 1800 - i * 250 })), total_queries: total, blocked_queries: blocked },
    topPermitted: { domains: [{ domain: NET + '2', count: 4100 }, ...DOMAINS.slice(0, 9).map((d, i) => ({ domain: d, count: 2900 - i * 260 }))], total_queries: total, blocked_queries: blocked },
    blocking: { blocking: 'enabled', timer: null },
    devices: { devices },
    gateway: { gateway: [{ family: 'inet', interface: 'eth0', address: NET + '1', local: [NET + '2'] }] },
    version: { version: { core: { local: { version: 'v6.3' } }, web: { local: { version: 'v6.4' } }, ftl: { local: { version: 'v6.4' } } } },
    warnings: [],
  };

  const day = 86400;
  const tasks = [];
  for (let d = 0; d < 10; d++) tasks.push({ upid: `UPID:pve:apt${d}`, type: 'aptupdate', id: '', user: 'root@pam', node: 'pve', starttime: t - d * day - 3600, endtime: t - d * day - 3590, status: d < 2 ? 'OK' : "command 'apt-get update' failed: exit code 100" });
  tasks.push({ upid: 'UPID:pve:dump1', type: 'vzdump', id: '', user: 'root@pam', node: 'pve', starttime: t - 3 * day, endtime: t - 3 * day + 16000, status: 'OK' });
  tasks.push({ upid: 'UPID:pve:snap', type: 'vzsnapshot', id: '104', user: 'root@pam', node: 'pve', starttime: t - 2 * day, endtime: t - 2 * day + 20, status: 'OK' });
  tasks.sort((a, b) => b.starttime - a.starttime);
  const G = 2 ** 30;
  const proxmox = {
    nodes: [{ id: 'node/pve', type: 'node', node: 'pve', status: 'online', cpu: 0.06, maxcpu: 6, mem: 7.4 * G, maxmem: 23.3 * G, disk: 15 * G, maxdisk: 68 * G, uptime: 15 * day,
      info: { cpuinfo: { model: 'Intel(R) Core(TM) i5-8400T CPU @ 1.70GHz', cpus: 6, sockets: 1 }, memory: { total: 23.3 * G, used: 7.4 * G, free: 15.9 * G }, rootfs: { total: 68 * G, used: 15 * G, avail: 53 * G }, loadavg: ['0.93', '0.88', '0.79'], uptime: 15 * day, pveversion: 'pve-manager/9.2.24/demo', kversion: 'Linux 7.0.14-4-pve' },
      tasks, ips: [{ iface: 'vmbr0', ip: NET + '10', cidr: NET + '10/24' }] }],
    guests,
    storages: [
      { id: 'storage/pve/local-lvm', type: 'storage', storage: 'local-lvm', node: 'pve', status: 'available', disk: 103 * G, maxdisk: 141 * G, plugintype: 'lvmthin', content: 'rootdir,images', shared: 0 },
      { id: 'storage/pve/local', type: 'storage', storage: 'local', node: 'pve', status: 'available', disk: 15 * G, maxdisk: 68 * G, plugintype: 'dir', content: 'backup,vztmpl,iso', shared: 0 },
      { id: 'storage/pve/tank', type: 'storage', storage: 'tank', node: 'pve', status: 'available', disk: 182 * G, maxdisk: 938 * G, plugintype: 'dir', content: 'rootdir', shared: 0 },
      { id: 'storage/pve/nas-backup', type: 'storage', storage: 'nas-backup', node: 'pve', status: 'available', disk: 68 * G, maxdisk: 2300 * G, plugintype: 'nfs', content: 'backup', shared: 1 },
    ],
    backups: guests.slice(0, 10).map((g) => ({ storage: 'nas-backup', vmid: g.vmid, ctime: t - 3 * day, size: 2 * G, volid: `nas-backup:backup/vzdump-${g.type}-${g.vmid}.tar.zst` })),
    warnings: [],
  };

  // Live query feed
  let qid = 1000;
  const feed = [];
  const ips = clients.map((c) => c.ip);
  function tick() {
    const n = 1 + Math.floor(rnd() * 5);
    for (let k = 0; k < n; k++) {
      const c = clients[Math.floor(rnd() ** 2 * clients.length)];
      const isAd = rnd() < 0.15;
      feed.push({ id: ++qid, time: Date.now() / 1000, type: pick(['A', 'AAAA', 'HTTPS']), domain: isAd ? pick(ADS) : pick(DOMAINS), cname: null,
        status: isAd ? 'GRAVITY' : pick(['CACHE', 'CACHE', 'FORWARDED']), client: { ip: c.ip, name: c.name || null }, dnssec: 'INSECURE', reply: { type: isAd ? 'IP' : 'IP', time: rnd() * 0.04 }, list_id: isAd ? 1 : null, upstream: isAd ? null : '127.0.0.1#5335', ede: { code: 0, text: null } });
    }
    while (feed.length > 500) feed.shift();
  }
  for (let k = 0; k < 40; k++) tick();
  setInterval(tick, 1500).unref();
  const queries = ({ length = 100, clientIp } = {}) => {
    const rows = feed.filter((q) => !clientIp || q.client.ip === clientIp).slice(-length).reverse();
    return { queries: rows, cursor: qid, recordsTotal: feed.length, recordsFiltered: rows.length };
  };
  return { pihole, proxmox, queries, piholeHost: NET + '2', ips };
}
