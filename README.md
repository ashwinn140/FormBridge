# FormBridge — authenticated server wrapper

This branch adds a server-side access gate around the existing seven browser-based tools. It does not rewrite their conversion logic: the original HTML utilities remain in the repository root and continue to process selected files in the user's browser.

## Runtime requirements

- Node.js 20 or newer
- PostgreSQL database (used for persistent, revocable server sessions)
- HTTPS in production

The service intentionally refuses to start unless the session secret, PostgreSQL connection, and at least one hashed user account are configured. It must never fall back to a public/unauthenticated mode.

## Environment variables

- `DATABASE_URL`: PostgreSQL connection string. Use a persistent database, not an ephemeral local file.
- `SESSION_SECRET`: random secret of at least 32 characters.
- `APP_USERS`: comma-separated `username:scrypt-hash` entries. Never put plain-text passwords here.
- `PORT`: supplied by the hosting platform.

Generate a password hash interactively (password input is not echoed):

```bash
npm install
npm run password-hash
```

Copy the resulting `scrypt$...` value into `APP_USERS`, for example `operator:scrypt$...`. Repeat the entry for each authorised user. Use a password of at least 14 characters.

Generate `SESSION_SECRET` with a password manager or a cryptographically secure generator, for example `openssl rand -base64 48`.

## Security behaviour

- Every converter page is protected on the server; direct URL access redirects to sign-in.
- Sessions are stored in PostgreSQL, use an HttpOnly/SameSite cookie, rotate on login, enforce an absolute eight-hour lifetime, and are destroyed on logout.
- Passwords are verified with Node's scrypt KDF and timing-safe comparison. Plain-text account entries are rejected.
- Login attempts are rate-limited per application process; login/logout POST requests require a same-origin request. Multi-instance production deployments should use a shared rate-limit store.
- The service fails closed if required auth or database configuration is missing.
- The health endpoint checks database connectivity and exposes no application data.
- Converter files are served from an explicit allowlist. Files are still processed locally in the browser; the server does not receive invoice or spreadsheet contents.

## Deployment notes

This branch is not a production deployment. Railway currently has a separate `FormBridge-Staging` service and a separate persistent PostgreSQL service, but both are inside the Railway environment named `production`; they are separate services, not a separate Railway environment. The existing `FormBridge` production service remains connected to `main`. Do not point the production domain at the staging service until browser regression tests and user acceptance have passed. Keep `main` unchanged until the pull request is explicitly approved and merged. A committed `package-lock.json` is a production gate for reproducible dependency installs.

## Tests

```bash
node --check server.js
node --check auth.js
node scripts/check-html-scripts.js
npm audit --omit=dev
npm test
```

The current CI suite runs these checks automatically. It includes 25 automated tests; these validate code-level behaviour and synthetic workbook structures, not browser-based regression with real customer files. The browser pages use SheetJS 0.20.3 from the official SheetJS CDN; PDF.js remains on 3.11.174 with `isEvalSupported: false` as a mitigation, not a substitute for a supported-version upgrade. Third-party scripts still need vendoring or Subresource Integrity (SRI), and a restrictive Content Security Policy needs a separate compatibility pass because the existing tools contain inline scripts.
