// Runs the real server against mock Pi-hole/Proxmox HTTP APIs: auth, headers, fusion, endpoints, basic auth.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { startMocks } from '../dev/mock-servers.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('server end-to-end against mock APIs', async () => {
  const m = await startMocks();
  const [tokenId, secret] = m.token.split('=');
  const port = 18000 + Math.floor(Math.random() * 1000);
  const srv = spawn(process.execPath, ['server.js'], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', PIHOLE_URL: m.piholeUrl + '/admin/', PIHOLE_PASSWORD: m.password,
      PROXMOX_URL: m.proxmoxUrl, PROXMOX_TOKEN_ID: tokenId, PROXMOX_TOKEN_SECRET: secret, PRECOG_PASSWORD: 'pw', DEMO: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  srv.stdout.on('data', (c) => (log += c));
  srv.stderr.on('data', (c) => (log += c));
  try {
    for (let i = 0; i < 50 && !log.includes('listening'); i++) await wait(100);
    const base = `http://127.0.0.1:${port}`;
    const auth = { authorization: 'Basic ' + Buffer.from('precog:pw').toString('base64') };

    assert.equal((await fetch(base + '/api/state')).status, 401, 'basic auth enforced');
    assert.equal((await fetch(base + '/healthz')).status, 200);

    const s = await (await fetch(base + '/api/state', { headers: auth })).json();
    assert.equal(s.demo, false);
    assert.equal(s.sources.pihole.status, 'ok', JSON.stringify(s.sources));
    assert.equal(s.sources.proxmox.status, 'ok', JSON.stringify(s.sources));
    assert.ok(s.devices.length > 30);
    assert.ok(s.devices.find((d) => d.guest?.name === 'grafana' && d.queries24h > 0), 'guest mapped via MAC from config');
    assert.ok(s.pihole.history.length > 100);
    assert.equal(s.proxmox.nodes[0].info.cpuinfo.cpus, 6);
    assert.ok(s.proxmox.backups.length > 0);
    assert.ok(s.alerts.some((a) => /local-lvm/.test(a.title)));

    await fetch(base + '/api/live', { headers: auth });
    await wait(3000);
    const live = await (await fetch(base + '/api/live', { headers: auth })).json();
    assert.ok(live.rows.length > 0, 'live feed populated');

    const dev = await (await fetch(base + '/api/device?ip=10.42.0.20', { headers: auth })).json();
    assert.equal(dev.ip, '10.42.0.20');
    assert.equal((await fetch(base + '/api/device?ip=../../etc', { headers: auth })).status, 400);
    assert.equal((await fetch(base + '/../server.js', { headers: auth })).status, 404, 'no path traversal');
    assert.equal((await fetch(base + '/api/state', { method: 'POST', headers: auth })).status, 405, 'read-only');
    assert.equal((await fetch(base + '/%E0%A4%A', { headers: auth })).status, 400, 'malformed URL rejected');
    assert.equal((await fetch(base + '/healthz')).status, 200, 'server survives malformed URL');

    const writes = m.calls.filter((c) => !/ GET | POST \/api\/auth| DELETE \/api\/auth/.test(c));
    assert.deepEqual(writes, [], 'only GETs (plus Pi-hole login/logout) hit upstream');
    assert.equal(m.sids.size, 1, 'a single Pi-hole session is reused');
  } finally {
    srv.kill('SIGTERM');
    await wait(300);
    m.close();
  }
  assert.equal(m.sids.size, 0, 'Pi-hole session closed on shutdown');
});
