'use strict';
const crypto = require('node:crypto');

function loadUsers(raw) {
  const users = new Map();
  for (const entry of String(raw || '').split(',')) {
    if (!entry.trim()) continue;
    const separator = entry.indexOf(':');
    if (separator < 1) throw new Error('APP_USERS entries must use username:scrypt-hash format.');
    const username = entry.slice(0, separator).trim().toLowerCase();
    const hash = entry.slice(separator + 1).trim();
    const parts = hash.split('
  }
  return users;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const N = 32768, r = 8, p = 1;
  const key = crypto.scryptSync(String(password), salt, 64, { N, r, p, maxmem: 128 * 1024 * 1024 });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

function verifyPassword(password, encoded) {
  try {
    const [scheme, nText, rText, pText, saltText, keyText] = String(encoded).split('$');
    if (scheme !== 'scrypt') return false;
    const N = Number(nText), r = Number(rText), p = Number(pText);
    if (![N, r, p].every(Number.isSafeInteger) || N < 16384 || N > 131072 || r !== 8 || p !== 1) return false;
    const salt = Buffer.from(saltText, 'base64url');
    const expected = Buffer.from(keyText, 'base64url');
    if (salt.length !== 16 || expected.length !== 64) return false;
    const actual = crypto.scryptSync(String(password), salt, 64, { N, r, p, maxmem: 128 * 1024 * 1024 });
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

const DUMMY_HASH = hashPassword('formbridge-invalid-user-dummy-password');

function makeLoginPage(message = '') {
  const safeMessage = String(message).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Sign in · FormBridge</title>
<style>
:root{color-scheme:light dark;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#f3f5f4;color:#16222b}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px}.panel{width:min(100%,420px);background:#fff;border:1px solid #dce3e2;border-radius:14px;padding:32px;box-shadow:0 12px 36px #16222b12}.kicker{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#64747c;font-weight:700}h1{font-size:28px;margin:12px 0 6px}p{color:#58666e;line-height:1.5}label{display:block;font-size:13px;font-weight:650;margin:18px 0 6px}input{width:100%;padding:12px;border:1px solid #c7d0d1;border-radius:8px;font:inherit}button{margin-top:22px;width:100%;padding:12px;border:0;border-radius:8px;background:#0b5f66;color:white;font:inherit;font-weight:700;cursor:pointer}button:disabled{opacity:.6;cursor:wait}.error{min-height:22px;color:#a52b39;font-size:13px}.foot{font-size:12px;color:#77858a;margin-top:24px}@media(prefers-color-scheme:dark){:root{background:#11191e;color:#e7edef}.panel{background:#1a252b;border-color:#334149}p,.foot{color:#aab8bd}input{background:#11191e;color:#e7edef;border-color:#43535a}}
</style></head><body><main class="panel"><div class="kicker">Export Filing Tools</div><h1>FormBridge</h1><p>Sign in with your authorised account to access the filing utilities.</p><form id="login"><label for="username">Username</label><input id="username" name="username" autocomplete="username" required maxlength="64"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required maxlength="256"><div class="error" id="error" role="alert">${safeMessage}</div><button id="submit" type="submit">Sign in</button></form><div class="foot">Access is restricted to authorised users. Files continue to be processed locally in your browser.</div></main>
<script>
const form=document.getElementById('login');const button=document.getElementById('submit');const errorBox=document.getElementById('error');
form.addEventListener('submit',async event=>{event.preventDefault();button.disabled=true;errorBox.textContent='';try{const response=await fetch('/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({username:form.username.value,password:form.password.value})});const data=await response.json();if(!response.ok)throw new Error(data.error||'Unable to sign in.');location.replace('/');}catch(error){errorBox.textContent=error.message||'Unable to sign in.';}finally{button.disabled=false;}});
</script></body></html>`;
}

module.exports = { loadUsers, hashPassword, verifyPassword, DUMMY_HASH, makeLoginPage };
);
    const n = Number(parts[1]), r = Number(parts[2]), p = Number(parts[3]);
    const validHash = parts.length === 6 && parts[0] === 'scrypt' &&
      Number.isSafeInteger(n) && n >= 16384 && n <= 131072 && r === 8 && p === 1 &&
      /^[A-Za-z0-9_-]{22}$/.test(parts[4] || '') &&
      /^[A-Za-z0-9_-]{86}$/.test(parts[5] || '') &&
      Buffer.from(parts[4] || '', 'base64url').length === 16 &&
      Buffer.from(parts[5] || '', 'base64url').length === 64;
    if (!/^[a-z0-9._-]{2,64}$/.test(username) || !validHash || users.has(username)) {
      throw new Error(`Invalid or duplicate account configuration for ${username || '(empty username)'}.`);
    }
    users.set(username, hash);
  }
  return users;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const N = 32768, r = 8, p = 1;
  const key = crypto.scryptSync(String(password), salt, 64, { N, r, p, maxmem: 128 * 1024 * 1024 });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

function verifyPassword(password, encoded) {
  try {
    const [scheme, nText, rText, pText, saltText, keyText] = String(encoded).split('$');
    if (scheme !== 'scrypt') return false;
    const N = Number(nText), r = Number(rText), p = Number(pText);
    if (![N, r, p].every(Number.isSafeInteger) || N < 16384 || N > 131072 || r !== 8 || p !== 1) return false;
    const salt = Buffer.from(saltText, 'base64url');
    const expected = Buffer.from(keyText, 'base64url');
    if (salt.length !== 16 || expected.length !== 64) return false;
    const actual = crypto.scryptSync(String(password), salt, 64, { N, r, p, maxmem: 128 * 1024 * 1024 });
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

const DUMMY_HASH = hashPassword('formbridge-invalid-user-dummy-password');

function makeLoginPage(message = '') {
  const safeMessage = String(message).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Sign in · FormBridge</title>
<style>
:root{color-scheme:light dark;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#f3f5f4;color:#16222b}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px}.panel{width:min(100%,420px);background:#fff;border:1px solid #dce3e2;border-radius:14px;padding:32px;box-shadow:0 12px 36px #16222b12}.kicker{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#64747c;font-weight:700}h1{font-size:28px;margin:12px 0 6px}p{color:#58666e;line-height:1.5}label{display:block;font-size:13px;font-weight:650;margin:18px 0 6px}input{width:100%;padding:12px;border:1px solid #c7d0d1;border-radius:8px;font:inherit}button{margin-top:22px;width:100%;padding:12px;border:0;border-radius:8px;background:#0b5f66;color:white;font:inherit;font-weight:700;cursor:pointer}button:disabled{opacity:.6;cursor:wait}.error{min-height:22px;color:#a52b39;font-size:13px}.foot{font-size:12px;color:#77858a;margin-top:24px}@media(prefers-color-scheme:dark){:root{background:#11191e;color:#e7edef}.panel{background:#1a252b;border-color:#334149}p,.foot{color:#aab8bd}input{background:#11191e;color:#e7edef;border-color:#43535a}}
</style></head><body><main class="panel"><div class="kicker">Export Filing Tools</div><h1>FormBridge</h1><p>Sign in with your authorised account to access the filing utilities.</p><form id="login"><label for="username">Username</label><input id="username" name="username" autocomplete="username" required maxlength="64"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required maxlength="256"><div class="error" id="error" role="alert">${safeMessage}</div><button id="submit" type="submit">Sign in</button></form><div class="foot">Access is restricted to authorised users. Files continue to be processed locally in your browser.</div></main>
<script>
const form=document.getElementById('login');const button=document.getElementById('submit');const errorBox=document.getElementById('error');
form.addEventListener('submit',async event=>{event.preventDefault();button.disabled=true;errorBox.textContent='';try{const response=await fetch('/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({username:form.username.value,password:form.password.value})});const data=await response.json();if(!response.ok)throw new Error(data.error||'Unable to sign in.');location.replace('/');}catch(error){errorBox.textContent=error.message||'Unable to sign in.';}finally{button.disabled=false;}});
</script></body></html>`;
}

module.exports = { loadUsers, hashPassword, verifyPassword, DUMMY_HASH, makeLoginPage };
