'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const session = require('express-session');
const { buildApp } = require('../server');
const { hashPassword } = require('../auth');

test('server protects direct converter URLs and API routes until authenticated', async () => {
  const password = 'test-only-password-that-is-long-enough';
  const app = buildApp({
    pool: { query: async () => ({ rows: [{ ok: 1 }] }) },
    users: new Map([['operator', hashPassword(password)]]),
    sessionStore: new session.MemoryStore()
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const address = server.address();
  const base = 'http://127.0.0.1:' + address.port;
  const origin = base;
  let cookie = '';
  try {
    const root = await fetch(base + '/', { redirect: 'manual' });
    assert.equal(root.status, 302);
    assert.equal(root.headers.get('location'), '/login');

    const direct = await fetch(base + '/cass-reconciliation.html', { redirect: 'manual' });
    assert.equal(direct.status, 302);
    assert.equal(direct.headers.get('location'), '/login');

    const api = await fetch(base + '/api/private', { redirect: 'manual' });
    assert.equal(api.status, 401);

    const badOrigin = await fetch(base + '/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://attacker.example' },
      body: JSON.stringify({ username: 'operator', password })
    });
    assert.equal(badOrigin.status, 403);

    const login = await fetch(base + '/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify({ username: 'operator', password })
    });
    assert.equal(login.status, 200);
    assert.deepEqual(await login.json(), { ok: true });
    const setCookie = login.headers.get('set-cookie');
    assert.ok(setCookie);
    cookie = setCookie.split(';')[0];
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Lax/i);

    const protectedPage = await fetch(base + '/cass-reconciliation.html', {
      headers: { cookie }, redirect: 'manual'
    });
    assert.equal(protectedPage.status, 200);
    assert.match(await protectedPage.text(), /NGL IATA Reconciliation tool/);

    const logout = await fetch(base + '/auth/logout', {
      method: 'POST', headers: { origin, cookie }
    });
    assert.equal(logout.status, 204);

    const afterLogout = await fetch(base + '/cass-reconciliation.html', {
      headers: { cookie }, redirect: 'manual'
    });
    assert.equal(afterLogout.status, 302);
    assert.equal(afterLogout.headers.get('location'), '/login');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
