'use strict';
/*
 * FormBridge server.
 *  - Login (server-side session cookie) in front of every page and every API call.
 *  - All conversion logic lives in ./logic and runs only here; the browser pages only show screens.
 *  - Nothing is written to disk and request bodies are never logged: invoices are processed in memory.
 */
process.env.TZ = process.env.TZ || 'Asia/Kolkata';   // same date handling as the staff's browsers had

const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const J = require('./lib/json');

const TOOLS = {
  sandvik: require('./logic/sandvik'),
  seco: require('./logic/seco'),
  anu: require('./logic/anu'),
  tech: require('./logic/tech'),
  vvdn: require('./logic/vvdn')
};

const PORT = process.env.PORT || 8080;
const SECRET = process.env.SESSION_SECRET || '';
const SESSION_HOURS = Number(process.env.SESSION_HOURS) || 12;

/* ---------- users: APP_USERS="amey:password1,kuldeep:password2" ---------- */
function loadUsers() {
  const users = new Map();
  String(process.env.APP_USERS || '').split(',').forEach(pair => {
    const i = pair.indexOf(':');
    if (i > 0) users.set(pair.slice(0, i).trim().toLowerCase(), pair.slice(i + 1));
  });
  return users;
}
const USERS = loadUsers();
const CONFIGURED = USERS.size > 0 && SECRET.length >= 24;
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
function checkLogin(user, password) {
  const stored = USERS.get(String(user || '').trim().toLowerCase());
  // always do one comparison so timing does not reveal whether the user exists
  const a = sha(stored === undefined ? crypto.randomBytes(8).toString('hex') : stored), b = sha(password || '');
  return crypto.timingSafeEqual(a, b) && stored !== undefined;
}

/* ---------- signed session cookie ---------- */
const b64u = (buf) => Buffer.from(buf).toString('base64url');
function sign(payload) {
  const body = b64u(JSON.stringify(payload));
  const mac = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return body + '.' + mac;
}
function verify(token) {
  if (!token || token.indexOf('.') < 0) return null;
  const [body, mac] = token.split('.');
  const want = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  const x = Buffer.from(mac), y = Buffer.from(want);
  if (x.length !== y.length || !crypto.timingSafeEqual(x, y)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return p && p.exp > Date.now() ? p : null;
  } catch (e) { return null; }
}
function readCookie(req, name) {
  const h = req.headers.cookie || '';
  for (const part of h.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return '';
}
function setSession(req, res, user) {
  const exp = Date.now() + SESSION_HOURS * 3600 * 1000;
  const flags = ['HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=' + SESSION_HOURS * 3600];
  if (req.secure) flags.push('Secure');
  res.setHeader('Set-Cookie', 'fb_session=' + encodeURIComponent(sign({ u: user, exp })) + '; ' + flags.join('; '));
}
function clearSession(res) { res.setHeader('Set-Cookie', 'fb_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'); }

/* ---------- failed-login throttle ---------- */
const attempts = new Map();   // ip -> {n, first}
function throttled(ip) {
  const a = attempts.get(ip);
  if (!a) return false;
  if (Date.now() - a.first > 15 * 60 * 1000) { attempts.delete(ip); return false; }
  return a.n >= 10;
}
function noteFail(ip) {
  const a = attempts.get(ip);
  if (!a || Date.now() - a.first > 15 * 60 * 1000) attempts.set(ip, { n: 1, first: Date.now() });
  else a.n++;
}

/* ---------- app ---------- */
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);   // Railway terminates https in front of us

app.use((req, res, next) => {
  const t0 = Date.now();
  res.on('finish', () => console.log(req.method, req.path, res.statusCode, (Date.now() - t0) + 'ms'));  // never the body
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  next();
});

app.get('/healthz', (req, res) => res.type('text').send('ok'));

if (!CONFIGURED) {
  app.use((req, res) => res.status(503).type('html').send(
    '<!doctype html><meta charset="utf-8"><title>FormBridge setup needed</title>' +
    '<body style="font:16px system-ui;max-width:640px;margin:60px auto;padding:0 20px;line-height:1.5">' +
    '<h1>FormBridge is not set up yet</h1><p>Login is not configured, so the site is locked on purpose.</p>' +
    '<p>In Railway, open this service → <b>Variables</b> and add:</p><ul>' +
    '<li><code>APP_USERS</code> – for example <code>amey:ChooseAPassword,kuldeep:AnotherPassword</code></li>' +
    '<li><code>SESSION_SECRET</code> – any long random text (at least 24 characters)</li></ul>' +
    '<p>Railway will restart the service by itself after you save.</p>'));
} else {
  app.get('/assets/login.js', (req, res) => res.type('js').sendFile(path.join(__dirname, 'views', 'login.js')));
  app.get('/login', (req, res) => res.type('html').sendFile(path.join(__dirname, 'views', 'login.html')));

  app.post('/api/login', express.text({ type: '*/*', limit: '10kb' }), (req, res) => {
    let body; try { body = JSON.parse(req.body || '{}'); } catch (e) { body = {}; }
    if (throttled(req.ip)) return res.status(429).json({ error: 'Too many attempts. Wait 15 minutes and try again.' });
    if (!checkLogin(body.user, body.password)) { noteFail(req.ip); return res.status(401).json({ error: 'Wrong user name or password.' }); }
    attempts.delete(req.ip);
    setSession(req, res, String(body.user).trim().toLowerCase());
    res.json({ ok: true });
  });
  app.post('/api/logout', (req, res) => { clearSession(res); res.json({ ok: true }); });

  // everything below needs a valid session
  app.use((req, res, next) => {
    const s = verify(readCookie(req, 'fb_session'));
    if (s) { req.user = s.u; return next(); }
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Please sign in again.' });
    res.redirect('/login');
  });

  app.get('/api/me', (req, res) => res.json({ user: req.user }));

  app.post('/api/:tool/:action',
    express.text({ type: '*/*', limit: '30mb' }),
    async (req, res) => {
      const tool = Object.prototype.hasOwnProperty.call(TOOLS, req.params.tool) ? TOOLS[req.params.tool] : null;
      const fn = tool && Object.prototype.hasOwnProperty.call(tool.api, req.params.action) ? tool.api[req.params.action] : null;
      if (!fn) return res.status(404).json({ error: 'Unknown request.' });
      let payload;
      try { payload = J.parse(req.body || '{}'); } catch (e) { return res.status(400).json({ error: 'Bad request.' }); }
      if (payload && typeof payload.fileB64 === 'string') { payload.file = Buffer.from(payload.fileB64, 'base64'); delete payload.fileB64; }
      try {
        const out = await fn(payload || {});
        res.type('json').send(J.stringify(out === undefined ? {} : out));
      } catch (e) {
        console.error('api error', req.params.tool, req.params.action, e && e.message);
        res.status(500).json({ error: 'The server could not process that. Check the file and try again.' });
      }
    });

  app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
  app.use(express.static(path.join(__dirname, 'public'), { index: false, dotfiles: 'deny', maxAge: 0 }));
}

app.use((req, res) => res.status(404).type('text').send('Not found'));
app.use((err, req, res, next) => { console.error('error', err && err.message); res.status(500).type('text').send('Server error'); });

if (require.main === module) {
  app.listen(PORT, () => console.log('FormBridge listening on ' + PORT + (CONFIGURED ? '' : ' (LOGIN NOT CONFIGURED - site locked)')));
}
module.exports = app;
