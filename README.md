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
- Sessions are stored in PostgreSQL, use an HttpOnly/SameSite cookie, rotate on login, and are destroyed on logout.
- Passwords are verified with Node's scrypt KDF and timing-safe comparison. Plain-text account entries are rejected.
- Login attempts are rate-limited; login/logout POST requests require a same-origin request.
- The service fails closed if required auth or database configuration is missing.
- The health endpoint checks database connectivity and exposes no application data.
- Converter files are served from an explicit allowlist. Files are still processed locally in the browser; the server does not receive invoice or spreadsheet contents.

## Deployment notes

This branch is not a production deployment. Configure a separate staging service and its PostgreSQL database before testing. Do not point the current production domain at this branch until browser regression tests and a user acceptance check have passed. Keep `main` unchanged until the pull request is explicitly approved and merged.

## Tests

```bash
npm test
```
