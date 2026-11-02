# Icon reports and administration


## Setup

Set `ADMIN_ORIGIN` to the exact public HTTPS origin without a trailing slash,
for example `https://pixelit.bastelbunker.de`, and `ADMIN_PASSWORD` to a strong
password of 16–1024 characters in the server environment or Docker Compose.
The API derives a salted password hash internally; no generator command is needed.
Keep the password out of Git and logs. Restart the API after changing it; this also
revokes existing sessions.

For existing installations, `ADMIN_PASSWORD_HASH` remains supported when
`ADMIN_PASSWORD` is unset. If both are present, `ADMIN_PASSWORD` takes precedence;
an empty or invalid password disables admin access rather than falling back.

## Automatic database setup

At startup the API applies the bundled `migrations/*.sql` files before opening its
HTTP port. The MySQL user needs `CREATE`, `SELECT` and `INSERT` for migration setup,
in addition to the existing application permissions (including moderation `UPDATE`).
The existing PixelIt database and bitmap/user tables must already exist.

The moderation migration only creates new tables; existing bitmap data is unchanged.
Already applied migrations are tracked with checksums in `pixel_it_schema_migrations`
and skipped on later starts. A database lock serializes migration runs across API
instances. Migration files must not be edited after deployment; add a new versioned
file for future schema changes. The runner supports simple, idempotent DDL only,
without stored procedures or semicolons inside SQL string literals.

If the database is unavailable, permissions are missing, or a migration fails, the
API exits with code 1 without accepting requests. Check the database and permissions,
then restart. MySQL DDL is not transactional; a partial run is retried safely because
the current migration uses `CREATE TABLE IF NOT EXISTS`. Keep normal database backups.
An installation that previously applied the moderation SQL manually is also supported:
its existing tables are retained and the migration is registered on the first start.

## Sessions and deployment

Open `/admin/` on that HTTPS origin. Without a valid password and origin, admin routes
return 503. This first version has one shared administrator identity, not GitHub
OAuth or multiple accounts. Keep the password private. Sessions last 30 minutes,
are stored in memory (maximum 100), and are revoked by logout or API restart.
Run one API process, or use sticky routing; multiple replicas need a shared session
store. HTTPS termination must be supplied by your reverse proxy. Do not expose the
container directly to the public internet. State-changing admin requests require
an exact matching Origin; cookies are Secure, HttpOnly, host-only and SameSite=Strict.
The public CORS policy is not extended to credentialed cross-origin requests.

Endpoints:

- `POST /api/reports`: JSON `{ "iconId": 123, "reason": "Explanation" }`.
  Positive safe integer ID; 1–1000 character reason. Returns 202 for an existing
  icon (including duplicate pending/approved reports), 404 for unknown IDs.
  Limited to 5 requests per client per 15 minutes by default, plus the global API limit.
- `POST /api/admin/login`: JSON `{ "password": "..." }`; 5 attempts per client
  per 15 minutes, plus global limit. Sets the session cookie.
- `POST /api/admin/logout`: revokes the session.
- `GET /api/admin/reports?before=123`: newest first, maximum 50 records; pass the
  last record ID as `before` to continue.
- `POST /api/admin/reports/:id/approve`: hides the icon from all public bitmap reads.
- `POST /api/admin/reports/:id/reject`: rejects a pending report.
- `POST /api/admin/reports/:id/restore`: restores an approved report's icon.

Decision requests use an empty JSON object. They require the admin session and
matching Origin. Invalid state transitions return 409. Moderation changes retain
bitmap data, record the decision timestamp and an audit event, and invalidate bitmap
caches, including unlimited ID caches. In-flight reads can finish with their old
snapshot; subsequent reads reload. Existing browser gallery lists need refreshing.
Hiding cannot remove copies already downloaded by devices or other clients.

The device WebUI's report button is a separate companion change, not included here.
Add it to `PixelIt.WebUI`, reusing its API base URL; update `PixelIt.Docs` with the
public reporting flow when that UI is shipped. No firmware payload or polling is
added by this API change.

`GET /api/admin/icons/:id` supplies an authenticated, bounded icon preview, including
hidden icons. The admin UI draws the first frame on demand; it does not autoplay
animations or send anything to a display. Report text is rendered as plain text.

## Rate limits and operational logs

All moderation API routes remain subject to the existing global `/api/` limiter.
Additional independent limits are defined alongside the existing limits in
`libs/rateLimit.js`. Counters use the trusted client IP and group IPv6 addresses
by /56. Unlike the global limiter, these limits have no IP exemptions.

| Environment variable | Default |
| --- | --- |
| `API_REPORT_LIMIT_WINDOW_MS` | `900000` |
| `API_REPORT_LIMIT_MAX` | `5` |
| `API_ADMIN_LOGIN_LIMIT_WINDOW_MS` | `900000` |
| `API_ADMIN_LOGIN_LIMIT_MAX` | `5` |
| `API_ADMIN_READ_LIMIT_WINDOW_MS` | `300000` |
| `API_ADMIN_READ_LIMIT_MAX` | `60` |
| `API_ADMIN_ACTION_LIMIT_WINDOW_MS` | `900000` |
| `API_ADMIN_ACTION_LIMIT_MAX` | `30` |

Use positive integers; invalid values fall back to the defaults. Login attempts
are counted before origin and session checks. Authenticated report lists and icon
previews share the read limit. Decisions and logout share the action limit.
HTTP 429 responses include the existing standard rate-limit headers. Counters are
per API process and reset on restart, as with the existing application limits.

The existing console/Seq logger records configuration status, accepted reports,
invalid requests, login success/failure, expired or missing sessions, origin
rejections, previews, report lists, committed decisions, conflicts, logout, rate
limits, cache invalidation and migration progress/failures. Request events include
client IP and available rate-limit/user-agent context; decisions include report ID,
action and administrator identity. Passwords, cookies, tokens, report text, SQL
values and arbitrary database error messages are excluded from new logs. Safe
error codes and migration filenames are logged for diagnosis. The database audit
history remains transactional and separate from operational logging.

## Admin telemetry overview

`GET /api/admin/statistics` requires an admin session and shares the admin read
limit with reports and previews. It caches aggregates for 60 seconds and does not
require a device UUID or change the public telemetry access check.

The overview shows distinct stored device records last updated within 24 hours,
7 days and 30 days, plus all stored telemetry records. These overlapping windows
are based on the last report per device, not live connections or a historical
activity series. Firmware, hardware type and matrix distributions cover the last
30 days and return at most eight groups each. Matrix names are checked against
firmware's supported names (`Colum major`, `Column major`, `Row major`,
`MicroMatrix`, `Tiled 4x 8x8 CJMCU (Column major)` and
`Tiled 4x 8x8 CJMCU (Row major)`). Other names, including misplaced sensor
names, are grouped as `Custom` before aggregation in both public and admin
statistics. Matching is case-sensitive; stored telemetry is unchanged. Extend
the list in `libs/pixelItRepo.js` when adding supported firmware matrix names. Percentages use all devices in that
30-day window, so displayed groups may add up to less than 100 percent. No device
UUIDs, IP addresses or geographic positions are returned. Data is loaded when the
statistics tab opens or the refresh button is used; there is no background polling.

## Login page visibility

Without a valid session, `/admin/` serves only the login form. The dashboard HTML
and `/admin/app.js` are available only with a valid admin session. Login code and
shared styles remain public; all data endpoints independently enforce admin access.
After logout or session expiry, the browser returns to the login page.
