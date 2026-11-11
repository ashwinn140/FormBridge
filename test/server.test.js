'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const session = require('express-session');
const { buildApp, isSessionExpired } = require('../server');
const { hashPassword } = require('../auth');

test('session lifetime is absolute and missing creation timestamps are rejected', () => {
  const now = 2_000_000_000_000;
  assert.equal(isSessionExpired({ createdAt: now - 60_000 }, now), false);
  assert.equal(isSessionExpired({ createdAt: now - (8 * 60 * 60 * 1000) }, now), true);
  assert.equal(isSessionExpired({}, now), true);
  assert.equal(isSessionExpired({ createdAt: 'not-a-timestamp' }, now), true);
});

test('server protects direct converter URLs and API routes until authenticated', async () => {
  const password = 'test-only-password-that-is-long-enough';
  const sessionStore = new session.MemoryStore();
  const app = buildApp({
    pool: { query: async () => ({ rows: [{ ok: 1 }] }) },
    users: new Map([['operator', hashPassword(password)]]),
    sessionStore,
    sessionSecret: 'test-only-session-secret-at-least-32-characters'
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
    assert.equal(root.headers.get('x-frame-options'), 'DENY');
    assert.equal(root.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(root.headers.get('cache-control'), 'no-store');
    const httpsRoot = await fetch(base + '/', {
      headers: { 'x-forwarded-proto': 'https' }, redirect: 'manual'
    });
    assert.equal(httpsRoot.headers.get('strict-transport-security'), 'max-age=31536000');

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

    const serverSource = await fetch(base + '/server.js', { headers: { cookie }, redirect: 'manual' });
    assert.equal(serverSource.status, 404);
    const packageManifest = await fetch(base + '/package.json', { headers: { cookie }, redirect: 'manual' });
    assert.equal(packageManifest.status, 404);

    const logout = await fetch(base + '/auth/logout', {
      method: 'POST', headers: { origin, cookie }
    });
    assert.equal(logout.status, 204);

    const afterLogout = await fetch(base + '/cass-reconciliation.html', {
      headers: { cookie }, redirect: 'manual'
    });
    assert.equal(afterLogout.status, 302);
    assert.equal(afterLogout.headers.get('location'), '/login');

    const secondLogin = await fetch(base + '/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify({ username: 'operator', password })
    });
    assert.equal(secondLogin.status, 200);
    const secondCookie = secondLogin.headers.get('set-cookie').split(';')[0];
    const cookieValue = decodeURIComponent(secondCookie.slice(secondCookie.indexOf('=') + 1));
    const sessionId = cookieValue.slice(2).split('.')[0];
    const expiredSession = await new Promise((resolve, reject) => {
      sessionStore.get(sessionId, (err, value) => err ? reject(err) : resolve(value));
    });
    assert.ok(expiredSession);
    expiredSession.createdAt = Date.now() - (8 * 60 * 60 * 1000);
    await new Promise((resolve, reject) => {
      sessionStore.set(sessionId, expiredSession, err => err ? reject(err) : resolve());
    });
    const expiredAccess = await fetch(base + '/cass-reconciliation.html', {
      headers: { cookie: secondCookie }, redirect: 'manual'
    });
    assert.equal(expiredAccess.status, 302);
    assert.equal(expiredAccess.headers.get('location'), '/login');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
