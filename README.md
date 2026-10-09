# FormBridge (server version)

Reserved only for New Globe Logistik LLP.

All conversion logic (invoice reading, mapping, HS rules, checks, CSV building) runs in `logic/` on the server.
The browser only receives the screens in `public/`. Every page and every request needs a sign-in.

## Set up on Railway
1. Put these files at the top level of a PRIVATE GitHub repo. If you reuse the old repo, first delete the old
   `Dockerfile`, `Caddyfile` and `site/` folder.
2. Railway > New Project > Deploy from GitHub repo > pick the repo.
3. Open the service > Variables, and add:
   - `APP_USERS`  e.g.  amey:ChoosePassword1,kuldeep:ChoosePassword2   (user:password pairs, comma separated)
   - `SESSION_SECRET`  any long random text, at least 24 characters
4. Settings > Networking > Generate Domain. Open the link and sign in.

Until both variables are set the site shows a "not set up yet" page and stays locked on purpose.
To add or remove a user, edit `APP_USERS`; Railway restarts by itself. Changing `SESSION_SECRET` signs everyone out.

## Updating a tool
Change the file in `logic/` (rules and parsing) or `public/` (screens), commit, and Railway redeploys.

## Notes
- Invoices are processed in memory only. Nothing is written to disk and request contents are never logged.
- Dates are handled in India time (`TZ` defaults to Asia/Kolkata).
- Run locally: `npm install`, then `APP_USERS=me:pw SESSION_SECRET=any-long-random-text-here node server.js`.
- Known advisories: `xlsx` 0.18.5 (no fixed version on npm) and `pdfjs-dist` 3.11.174 are pinned to the versions the
  converters were validated on. Upgrade after re-checking against real invoices.
