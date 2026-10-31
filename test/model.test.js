import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, fuse, alerts, isPrivateMac } from '../lib/model.js';
import { makeDemo } from '../lib/demo.js';

test('classify by name, vendor, guest, role and private MAC', () => {
  assert.equal(classify({ name: 'Juju-Phone.lan' }), 'phone');
  assert.equal(classify({ name: 'LGwebOSTV.lan' }), 'tv');
  assert.equal(classify({ name: 'EC70.lan' }), 'network');
  assert.equal(classify({ name: 'Negars-MBP.lan' }), 'laptop');
  assert.equal(classify({ name: 'LENF5ZHPV6.lan' }), 'laptop');
  assert.equal(classify({ vendor: 'Espressif Inc.' }), 'iot');
  assert.equal(classify({ vendor: 'TP-LINK TECHNOLOGIES CO.,LTD.' }), 'network');
  assert.equal(classify({ guest: { type: 'lxc' } }), 'container');
  assert.equal(classify({ guest: { type: 'qemu' } }), 'vm');
  assert.equal(classify({ role: 'gateway', name: 'iphone' }), 'gateway');
  assert.equal(classify({ mac: 'da:a1:19:00:00:01' }), 'phone');
  assert.equal(isPrivateMac('3c:22:fb:00:00:01'), false);
});

test('fuse maps guests to DNS clients by MAC and marks infrastructure', () => {
  const d = makeDemo();
  const devs = fuse({ pihole: d.pihole, proxmox: d.proxmox, piholeHost: d.piholeHost });
  const ha = devs.find((x) => x.guest?.name === 'homeassistant');
  assert.ok(ha.queries24h > 0, 'guest picked up its DNS stats');
  assert.equal(ha.kind, 'container');
  assert.equal(ha.parent, 'node:pve');
  assert.equal(devs.find((x) => x.ips.includes('10.42.0.1')).kind, 'gateway');
  assert.equal(devs.find((x) => x.ips.includes('10.42.0.2')).kind, 'dns');
  assert.equal(devs.find((x) => x.ips.includes('10.42.0.10')).kind, 'hypervisor');
  assert.ok(devs.find((x) => x.guest?.name === 'win11' && !x.online), 'stopped guest with no DNS still listed');
  assert.equal(new Set(devs.map((x) => x.id)).size, devs.length, 'no duplicate devices');
});

test('fuse drops devices unseen for 7+ days and lists IPv4 first', () => {
  const t = Date.now() / 1000;
  const devices = [
    { hwaddr: 'da:00:00:00:00:01', lastQuery: t - 8 * 86400, ips: [{ ip: '10.0.0.5' }] },
    { hwaddr: '3c:22:fb:00:00:02', lastQuery: t - 60, ips: [{ ip: 'fd00::2' }, { ip: '10.0.0.6' }] },
  ];
  const devs = fuse({ pihole: { devices: { devices } } });
  assert.equal(devs.length, 1);
  assert.deepEqual(devs[0].ips, ['10.0.0.6', 'fd00::2']);
});

test('fuse tolerates missing sources', () => {
  assert.deepEqual(fuse({}), []);
  const d = makeDemo();
  assert.ok(fuse({ proxmox: d.proxmox }).length >= 12);
});

test('alerts flag real issues and stay quiet on recovered tasks', () => {
  const d = makeDemo();
  const devices = fuse({ pihole: d.pihole, proxmox: d.proxmox, piholeHost: d.piholeHost });
  const a = alerts({ pihole: d.pihole, proxmox: d.proxmox, devices });
  const titles = a.map((x) => x.title).join('\n');
  assert.match(titles, /local-lvm is 73% full/);
  assert.match(titles, /looks up "10\.42\.0\.2" as a hostname/);
  assert.match(titles, /new device/);
  assert.doesNotMatch(titles, /aptupdate/, 'apt failures recovered by a later OK run');
  assert.doesNotMatch(titles, /No successful backup/);

  const off = structuredClone(d.pihole);
  off.blocking.blocking = 'disabled';
  assert.equal(alerts({ pihole: off, proxmox: null, devices })[0].level, 'crit');
});
