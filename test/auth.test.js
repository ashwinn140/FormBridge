'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUsers, hashPassword, verifyPassword, makeLoginPage } = require('../auth');

test('password hashes verify without storing the password', () => {
  const password = 'correct horse battery staple 2026';
  const encoded = hashPassword(password);
  assert.match(encoded, /^scrypt\$32768\$8\$1\$/);
  assert.equal(verifyPassword(password, encoded), true);
  assert.equal(verifyPassword('wrong password', encoded), false);
});

test('user configuration accepts hashed credentials and normalises usernames', () => {
  const encoded = hashPassword('a sufficiently long test password');
  const users = loadUsers(`Team.User:${encoded}`);
  assert.equal(users.has('team.user'), true);
  assert.equal(verifyPassword('a sufficiently long test password', users.get('team.user')), true);
});

test('user configuration rejects plaintext passwords', () => {
  assert.throws(() => loadUsers('staff:plaintext-password'), /Invalid account configuration/);
});

test('user configuration rejects malformed scrypt hashes and duplicate usernames', () => {
  const encoded = hashPassword('a sufficiently long test password');
  assert.throws(() => loadUsers('staff:scrypt$32768$8$1$bad$bad'), /Invalid account configuration/);
  assert.throws(() => loadUsers(`staff:${encoded},STAFF:${encoded}`), /duplicate username/i);
});

test('login page escapes server-provided messages', () => {
  const page = makeLoginPage('<script>alert(1)</script>');
  assert.equal(page.includes('<script>alert(1)</script>'), false);
  assert.equal(page.includes('&lt;script&gt;'), true);
});
