// Pure functions: turn raw Pi-hole + Proxmox snapshots into one picture of the network.

export const KINDS = {
  gateway: 'Gateway', network: 'Network gear', dns: 'DNS filter', hypervisor: 'Hypervisor',
  container: 'Container', vm: 'Virtual machine', phone: 'Phone', tablet: 'Tablet', laptop: 'Computer',
  tv: 'TV / streamer', speaker: 'Speaker / assistant', iot: 'Smart home', printer: 'Printer',
  console: 'Game console', server: 'Server', unknown: 'Unknown',
};

// Locally administered bit set => randomized "private Wi-Fi address" (iOS/Android/Windows privacy).
export const isPrivateMac = (mac) => /^[0-9a-f]{2}:/i.test(mac || '') && (parseInt(mac.slice(0, 2), 16) & 2) === 2;

const NAME_RULES = [
  [/iphone|pixel|galaxy|android|phone|oneplus|xiaomi|redmi|moto/i, 'phone'],
  [/ipad|tablet|\btab\b|kindle/i, 'tablet'],
  [/printer|epson|brother|canon|officejet|laserjet|\bhp[-_]/i, 'printer'],
  [/xbox|playstation|\bps[45]\b|nintendo|switch/i, 'console'],
  [/webos|\btv\b|-tv|tv-|roku|firetv|fire-tv|chromecast|appletv|apple-tv|shield|bravia|vizio/i, 'tv'],
  [/echo|alexa|sonos|homepod|nest-?(mini|hub|audio)|google-?home|speaker/i, 'speaker'],
  [/macbook|mbp|imac|mac-?mini|\bmac\b|laptop|desktop|thinkpad|surface|^len[a-z0-9]{6,}|^desktop-|^pc-|win(dows)?-/i, 'laptop'],
  [/netgear|orbi|deco|eax|ec\d\d|archer|unifi|\bap\b|-ap\b|switch|router|mesh|extender|tplink/i, 'network'],
  [/raspberry|\bpi\b|-pi\b|pihole|nas|synology|qnap|truenas|server|proxmox|pve|docker|ubuntu|debian/i, 'server'],
  [/aura|ring|nest|ecobee|hue|wemo|kasa|tapo|shelly|sonoff|tuya|esp[-_]|camera|cam\b|doorbell|thermostat|plug|bulb|vacuum|roomba|frame/i, 'iot'],
];
const VENDOR_RULES = [
  [/proxmox/i, 'container'],
  [/raspberry/i, 'server'],
  [/tp-?link|netgear|ubiquiti|cisco|aruba|eero|arris|juniper|mikrotik|zyxel|linksys|d-link|sagemcom|technicolor/i, 'network'],
  [/espressif|tuya|shelly|itead|wyze|ring|nest|ecobee|signify|philips light|irobot|ezviz|hikvision|dahua|reolink|amazon technologies/i, 'iot'],
  [/lg electronics|samsung|vizio|tcl|hisense|roku|sony|sharp/i, 'tv'],
  [/sonos|bose/i, 'speaker'],
  [/nintendo|microsoft.*xbox/i, 'console'],
  [/hewlett|epson|brother|canon|lexmark|xerox/i, 'printer'],
  [/intel|realtek|micro-star|dell|lenovo|asustek|gigabyte|azurewave|liteon|quanta|wistron|compal|apple/i, 'laptop'],
  [/google/i, 'phone'],
];

export function classify({ name = '', vendor = '', mac = '', guest, role }) {
  if (role) return role;
  if (guest) return guest.type === 'qemu' ? 'vm' : 'container';
  for (const [re, k] of NAME_RULES) if (re.test(name)) return k;
  for (const [re, k] of VENDOR_RULES) if (re.test(vendor)) return k;
  if (isPrivateMac(mac)) return 'phone'; // randomized MACs are almost always phones/tablets/laptops
  return 'unknown';
}

const STALE = 7 * 86400; // Pi-hole keeps every MAC it ever saw; rotated private MACs pile up
const clean = (n) => (n && n !== '*' ? String(n).replace(/\.$/, '') : '');

export function fuse({ pihole, proxmox, piholeHost, now = Date.now() / 1000 }) {
  const byMac = new Map();
  const byIp = new Map();
  const devices = [];
  const add = (d) => { devices.push(d); if (d.mac) byMac.set(d.mac, d); for (const ip of d.ips) byIp.set(ip, d); return d; };

  for (const r of pihole?.devices?.devices || []) {
    const hw = String(r.hwaddr || '').toLowerCase();
    const mac = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(hw) && hw !== '00:00:00:00:00:00' ? hw : null;
    const ips = (r.ips || []).map((x) => x.ip).filter(Boolean);
    if (!ips.length && !mac) continue;
    const names = [...new Set((r.ips || []).map((x) => clean(x.name)).filter(Boolean))];
    const lastSeen = Math.max(r.lastQuery || 0, ...(r.ips || []).map((x) => x.lastSeen || 0));
    if (lastSeen && now - lastSeen > STALE) continue;
    add({ id: mac || `ip-${ips[0]}`, mac, ips, names, vendor: r.macVendor || '', iface: r.interface || '',
      firstSeen: r.firstSeen || null, lastSeen: lastSeen || null, lifetimeQueries: r.numQueries || 0, queries24h: 0 });
  }

  for (const c of pihole?.topClients?.clients || []) {
    let d = byIp.get(c.ip);
    if (!d) d = add({ id: `ip-${c.ip}`, mac: null, ips: [c.ip], names: [], vendor: '', iface: '', firstSeen: null, lastSeen: null, lifetimeQueries: 0, queries24h: 0 });
    d.queries24h = c.count;
    const n = clean(c.name);
    if (n && !d.names.includes(n)) d.names.unshift(n);
  }

  for (const g of proxmox?.guests || []) {
    let d = (g.mac && byMac.get(g.mac)) || (g.ips || []).concat(g.staticIp || []).map((ip) => byIp.get(ip)).find(Boolean);
    if (!d) d = add({ id: g.mac || `guest-${g.vmid}`, mac: g.mac, ips: [...new Set([...(g.ips || []), ...(g.staticIp ? [g.staticIp] : [])])], names: [], vendor: 'Proxmox guest', iface: '', firstSeen: null, lastSeen: null, lifetimeQueries: 0, queries24h: 0 });
    for (const ip of [...(g.ips || []), ...(g.staticIp ? [g.staticIp] : [])]) if (!d.ips.includes(ip)) { d.ips.push(ip); byIp.set(ip, d); }
    d.guest = { vmid: g.vmid, name: g.name, type: g.type, status: g.status, node: g.node, cpu: g.cpu, maxcpu: g.maxcpu, mem: g.mem, maxmem: g.maxmem, uptime: g.uptime };
    d.parent = `node:${g.node}`;
  }

  const roles = new Map();
  for (const gw of pihole?.gateway?.gateway || []) if (gw.address && gw.family !== 'inet6') roles.set(gw.address, 'gateway');
  if (piholeHost) roles.set(piholeHost, 'dns');
  for (const n of proxmox?.nodes || []) for (const a of n.ips || []) roles.set(a.ip, `hypervisor:${n.node}`);

  for (const [ip, role] of roles) {
    let d = byIp.get(ip);
    if (!d) d = add({ id: `ip-${ip}`, mac: null, ips: [ip], names: [], vendor: '', iface: '', firstSeen: null, lastSeen: null, lifetimeQueries: 0, queries24h: 0 });
    if (role.startsWith('hypervisor:')) { d.role = 'hypervisor'; d.node = role.split(':')[1]; d.names.unshift(d.node); } else d.role = role;
  }

  for (const d of devices) {
    d.privateMac = isPrivateMac(d.mac);
    d.ips.sort((a, b) => a.includes(':') - b.includes(':')); // IPv4 first
    const tail = d.ips[0] ? '.' + d.ips[0].split('.').pop() : '';
    const maker = d.vendor.replace(/[,(].*$|\b(inc|ltd|llc|gmbh|co|corp(oration)?|technologies|trading|electronics|computer)\b\.?/gi, '').trim();
    d.name = d.guest?.name || d.names[0] || (maker ? `${maker} ${tail}`.trim() : d.privateMac ? `Private device ${tail}`.trim() : d.ips[0] || d.mac);
    d.kind = classify({ name: d.names.join(' '), vendor: d.vendor, mac: d.mac, guest: d.guest, role: d.role });
    d.online = d.guest ? d.guest.status === 'running' : (d.lastSeen ? now - d.lastSeen < 15 * 60 : d.queries24h > 0);
    d.isNew = d.firstSeen ? now - d.firstSeen < 24 * 3600 : false;
    if (!d.parent && d.kind !== 'gateway') d.parent = 'gateway';
  }
  devices.sort((a, b) => (b.queries24h - a.queries24h) || a.name.localeCompare(b.name));
  return devices;
}

export function alerts({ pihole, proxmox, devices, now = Date.now() / 1000 }) {
  const out = [];
  const A = (level, title, detail) => out.push({ level, title, detail });
  const s = pihole?.summary;

  if (pihole) {
    if (pihole.blocking?.blocking && pihole.blocking.blocking !== 'enabled') A('crit', 'Pi-hole blocking is OFF', `Status: ${pihole.blocking.blocking}`);
    const gu = s?.gravity?.last_update;
    if (gu && now - gu > 8 * 86400) A('warn', 'Blocklists are stale', `Gravity last updated ${Math.round((now - gu) / 86400)} days ago`);
    const total = s?.queries?.total || 0;
    const top = pihole.topClients?.clients?.[0];
    if (top && total && top.count / total > 0.2) A('info', `${clean(top.name) || top.ip} makes ${Math.round(100 * top.count / total)}% of all DNS queries`, 'Usually one chatty app; check it if unexpected');
    const unnamed = devices.filter((d) => !d.guest && !d.role && !d.names.length && d.queries24h > 0).length;
    if (unnamed) A('info', `${unnamed} active devices have no hostname`, 'Add Local DNS records or enable conditional forwarding');
    const fresh = devices.filter((d) => d.isNew);
    if (fresh.length) A('warn', `${fresh.length} new device${fresh.length > 1 ? 's' : ''} joined in the last 24h`, fresh.map((d) => `${d.name} (${d.ips[0] || d.mac})`).join(', '));
    const ipNames = (pihole.topPermitted?.domains || []).filter((d) => /^\d+\.\d+\.\d+\.\d+$/.test(d.domain));
    for (const d of ipNames) A('info', `Something looks up "${d.domain}" as a hostname`, `${d.count} queries; an IP was typed where a name is expected`);
  }

  for (const st of proxmox?.storages || []) {
    if (!st.maxdisk) continue;
    const pct = 100 * st.disk / st.maxdisk;
    if (pct >= 85) A('crit', `Storage ${st.storage} is ${pct.toFixed(0)}% full`, `${st.node}: guests on it may stop writing`);
    else if (pct >= 70) A('warn', `Storage ${st.storage} is ${pct.toFixed(0)}% full`, `${st.node}: plan to move disks or expand`);
  }
  for (const n of proxmox?.nodes || []) {
    if (n.status !== 'online') { A('crit', `Node ${n.node} is ${n.status}`, ''); continue; }
    if (n.maxmem && n.mem / n.maxmem > 0.9) A('warn', `Node ${n.node} memory at ${Math.round(100 * n.mem / n.maxmem)}%`, '');
    const week = (n.tasks || []).filter((t) => t.starttime > now - 7 * 86400);
    const failed = week.filter((t) => t.status && t.status !== 'OK' && !/^WARNINGS/.test(t.status));
    const byType = {};
    for (const t of failed) byType[t.type] = (byType[t.type] || 0) + 1;
    for (const [type, c] of Object.entries(byType)) {
      const last = failed.find((t) => t.type === type);
      const recovered = week.find((t) => t.type === type && t.status === 'OK' && t.starttime > last.starttime);
      if (!recovered) A('warn', `${c}× failed ${type} task${c > 1 ? 's' : ''} on ${n.node} this week`, last.status);
    }
    const dumps = (n.tasks || []).filter((t) => t.type === 'vzdump' && t.status === 'OK');
    if (n.tasks?.length && (!dumps.length || now - Math.max(...dumps.map((t) => t.starttime)) > 8 * 86400) && !(proxmox.backups || []).some((b) => now - b.ctime < 8 * 86400))
      A('warn', `No successful backup on ${n.node} in 8+ days`, 'Datacenter → Backup');
  }
  const order = { crit: 0, warn: 1, info: 2 };
  return out.sort((a, b) => order[a.level] - order[b.level]);
}
