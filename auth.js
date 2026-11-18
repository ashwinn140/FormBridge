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
    const parts = hash.split('$');
    const n = Number(parts[1]), r = Number(parts[2]), p = Number(parts[3]);
    const validHash = parts.length === 6 && parts[0] === 'scrypt' &&
      Number.isSafeInteger(n) && n >= 16384 && n <= 131072 && r === 8 && p === 1 &&
      /^[A-Za-z0-9_-]{22}$/.test(parts[4] || '') &&
      /^[A-Za-z0-9_-]{86}$/.test(parts[5] || '') &&
      Buffer.from(parts[4] || '', 'base64url').length === 16 &&
      Buffer.from(parts[5] || '', 'base64url').length === 64;
    if (!/^[a-z0-9._-]{2,64}$/.test(username) || !validHash || users.has(username)) {
      throw new Error('Invalid account configuration or duplicate username for ' + (username || '(empty username)') + '.');
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
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=Space+Grotesk:wght@500;600;700&display=swap" rel="stylesheet"><title>Sign in · FormBridge</title>
<style>
:root{color-scheme:dark;font-family:'DM Sans',system-ui,-apple-system,"Segoe UI",sans-serif;background:#0c131c;color:#edf4f8}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:radial-gradient(ellipse at 12% 0%,#1a3144 0,transparent 42%),radial-gradient(ellipse at 100% 20%,#242044 0,transparent 34%),#0c131c;color:#edf4f8}
.panel{width:min(100%,440px);background:rgba(20,31,43,.94);border:1px solid #2b3b49;border-radius:18px;padding:34px;box-shadow:0 24px 70px #0006}
.kicker{font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#a3b3c1;font-weight:700;display:flex;align-items:center;gap:10px}
.kicker:before{content:"";width:28px;height:28px;border-radius:9px;background:linear-gradient(135deg,#74b7ff,#6bd7d0,#b5a1ff);box-shadow:0 8px 28px #6bb9ff33}
h1{font:700 32px/1.08 'Space Grotesk',system-ui,sans-serif;margin:22px 0 8px;letter-spacing:-.03em}
p{color:#a3b3c1;line-height:1.55;margin:0}
label{display:block;font-size:13px;font-weight:650;margin:20px 0 7px;color:#dce7ee}
input{width:100%;padding:13px 14px;border:1px solid #35495a;border-radius:10px;background:#0c1721;color:#edf4f8;font:inherit;outline:none}
input:focus{border-color:#74b7ff;box-shadow:0 0 0 3px #74b7ff22}
button{margin-top:24px;width:100%;padding:13px 16px;border:0;border-radius:10px;background:linear-gradient(110deg,#74b7ff,#6bd7d0);color:#0c1721;font:700 14px 'DM Sans',system-ui,sans-serif;cursor:pointer}
button:disabled{opacity:.6;cursor:wait}
.error{min-height:22px;color:#ff9aa8;font-size:13px;margin-top:8px}
.foot{font-size:12px;color:#718394;margin-top:24px;padding-top:18px;border-top:1px solid #2b3b49}
@media(max-width:480px){.panel{padding:26px 22px}h1{font-size:29px}}
</style></head><body><main class="panel"><div class="kicker">Export Filing Tools</div><h1>FormBridge</h1><p>Sign in with your authorised account to access the filing utilities.</p><form id="login"><label for="username">Username</label><input id="username" name="username" autocomplete="username" required maxlength="64"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required maxlength="256"><div class="error" id="error" role="alert">${safeMessage}</div><button id="submit" type="submit">Sign in</button></form><div class="foot">Access is restricted to authorised users. Files continue to be processed locally in your browser.</div></main>
<script>
const form=document.getElementById('login');const button=document.getElementById('submit');const errorBox=document.getElementById('error');
form.addEventListener('submit',async event=>{event.preventDefault();button.disabled=true;errorBox.textContent='';try{const response=await fetch('/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({username:form.username.value,password:form.password.value})});const data=await response.json();if(!response.ok)throw new Error(data.error||'Unable to sign in.');location.replace('/');}catch(error){errorBox.textContent=error.message||'Unable to sign in.';}finally{button.disabled=false;}});
</script></body></html>`;
}

module.exports = { loadUsers, hashPassword, verifyPassword, DUMMY_HASH, makeLoginPage };
