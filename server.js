'use strict';

const path = require('node:path');
const fs = require('node:fs/promises');
const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const { Pool } = require('pg');
const { rateLimit } = require('express-rate-limit');
const { loadUsers, verifyPassword, DUMMY_HASH, makeLoginPage } = require('./auth');

const PORT = Number(process.env.PORT || 8080);
const SESSION_SECRET = process.env.SESSION_SECRET || '';
const DATABASE_URL = process.env.DATABASE_URL || '';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const ROOT = __dirname;

const PAGES = new Set([
  'index.html', 'sandvik-converter.html', 'seco-converter.html',
  'anu-worles-converter.html', 'anu-worles-tech-converter.html',
  'vvdn-converter.html', 'cass-reconciliation.html', 'asb-converter.html'
]);

function sameOrigin(req) {
  const origin = req.get('origin');
  if (!origin) return false;
  try { return new URL(origin).origin === `${req.protocol}://${req.get('host')}`; }
  catch { return false; }
}

async function serveToolPage(res, page, next) {
  try {
    let html = await fs.readFile(path.join(ROOT, page), 'utf8');
    const signOut = '<a href="/logout" aria-label="Sign out of FormBridge" style="position:fixed;right:14px;bottom:14px;z-index:99999;padding:8px 12px;border-radius:999px;background:#16222b;color:#fff;text-decoration:none;font:600 12px system-ui;box-shadow:0 2px 8px #0003">Sign out</a>';
    html = html.replace(/<\/body>/i, `${signOut}</body>`);
    res.type('html').send(html);
  } catch (err) { next(err); }
}

function buildApp({ pool, users }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.use(session({
    name: 'fb.sid',
    store: new PgSession({ pool, tableName: 'formbridge_sessions', createTableIfMissing: true, pruneSessionInterval: 15 * 60 }),
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: { httpOnly: true, secure: 'auto', sameSite: 'lax', path: '/', maxAge: SESSION_TTL_MS }
  }));

  app.get('/healthz', async (req, res) => {
    try { await pool.query('SELECT 1'); res.type('text').send('ok'); }
    catch { res.status(503).type('text').send('database unavailable'); }
  });

  app.get('/login', (req, res) => {
    if (req.session.user) return res.redirect('/');
    res.status(200).type('html').send(makeLoginPage());
  });

  app.get('/logout', (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    res.type('html').send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign out · FormBridge</title><main style="font:16px system-ui;max-width:420px;margin:15vh auto;padding:24px"><h1>Sign out of FormBridge?</h1><p>Your current session will be ended.</p><button id="out" style="padding:10px 18px">Sign out</button> <a href="/">Cancel</a><p id="error" role="alert"></p></main><script>document.getElementById('out').onclick=async()=>{const r=await fetch('/auth/logout',{method:'POST',credentials:'same-origin'});if(r.ok)location.replace('/login');else document.getElementById('error').textContent='Unable to sign out. Please try again.';};</script>`);
  });

  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many sign-in attempts. Please wait 15 minutes and try again.' }
  });

  app.post('/auth/login', loginLimiter, express.json({ limit: '10kb', strict: true }), (req, res, next) => {
    if (!sameOrigin(req)) return res.status(403).json({ error: 'Request origin could not be verified.' });
    const username = String(req.body?.username || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const storedHash = users.get(username);
    const valid = storedHash ? verifyPassword(password, storedHash) : verifyPassword(password, DUMMY_HASH);
    if (!valid || !storedHash) return res.status(401).json({ error: 'Incorrect username or password.' });
    req.session.regenerate(err => {
      if (err) return next(err);
      req.session.user = username;
      req.session.createdAt = Date.now();
      req.session.save(saveErr => {
        if (saveErr) return next(saveErr);
        res.json({ ok: true });
      });
    });
  });

  app.post('/auth/logout', (req, res, next) => {
    if (!sameOrigin(req)) return res.status(403).json({ error: 'Request origin could not be verified.' });
    req.session.destroy(err => {
      if (err) return next(err);
      res.clearCookie('fb.sid', { httpOnly: true, secure: true, sameSite: 'lax', path: '/' });
      res.status(204).end();
    });
  });

  app.use((req, res, next) => {
    if (req.path === '/healthz' || req.path === '/login' || req.path === '/logout' || req.path === '/auth/login' || req.path === '/auth/logout') return next();
    if (!req.session.user) return req.path.startsWith('/api/') ? res.status(401).json({ error: 'Sign-in required.' }) : res.redirect('/login');
    next();
  });

  app.get('/auth/status', (req, res) => res.json({ authenticated: true, username: req.session.user }));
  app.get('/', (req, res, next) => serveToolPage(res, 'index.html', next));
  app.get('/:page', (req, res, next) => {
    const page = req.params.page;
    if (!PAGES.has(page)) return next();
    serveToolPage(res, page, next);
  });

  app.use((req, res) => res.status(404).type('text').send('Not found'));
  app.use((err, req, res, next) => {
    console.error('FormBridge request failed:', err?.message || 'unknown error');
    if (res.headersSent) return next(err);
    res.status(500).json({ error: 'A server error occurred. Please try again.' });
  });
  return app;
}

async function start() {
  if (SESSION_SECRET.length < 32) throw new Error('SESSION_SECRET must contain at least 32 characters.');
  if (!DATABASE_URL) throw new Error('DATABASE_URL is required. A persistent PostgreSQL database is required for sessions.');
  const users = loadUsers(process.env.APP_USERS);
  if (!users.size) throw new Error('APP_USERS must contain at least one username:scrypt-hash entry.');
  const pool = new Pool({ connectionString: DATABASE_URL, max: 5, idleTimeoutMillis: 30000, connectionTimeoutMillis: 10000 });
  await pool.query('SELECT 1');
  const app = buildApp({ pool, users });
  const server = app.listen(PORT, () => console.log(`FormBridge listening on ${PORT}`));
  const shutdown = async () => { server.close(); await pool.end(); process.exit(0); };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

if (require.main === module) start().catch(err => { console.error(`FormBridge startup blocked: ${err.message}`); process.exit(1); });
module.exports = { buildApp, sameOrigin };
