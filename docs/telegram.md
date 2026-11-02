# Telegram moderation notifications

Telegram notifications are optional and require the existing GitHub login setup.
Each owner/moderator opts in separately; public gallery users cannot subscribe.
No firmware or companion client changes are required.

## Server setup

1. Create a dedicated bot with **@BotFather** in Telegram and save its token.
2. Add these variables to the API container environment and restart the API:

   | Variable | Value |
   | --- | --- |
   | `TELEGRAM_BOT_TOKEN` | BotFather token; server-only secret |
   | `TELEGRAM_BOT_USERNAME` | Bot username without `@` |
   | `TELEGRAM_WEBHOOK_SECRET` | Random secret of 32–256 characters, using letters, digits, `_` and `-` |

   Generate a webhook secret, for example, with `openssl rand -hex 32`.
   Missing or invalid configuration disables Telegram features while leaving
   ordinary admin access available. Keep secrets out of Git and logs.
3. The API registers the HTTPS webhook automatically after migrations complete and
   its HTTP port is listening. No command or manual registration is needed.
   Each restart applies the current origin, token and secret; queued Telegram
   updates are preserved. Use a dedicated bot: registration replaces that bot's
   existing webhook. All replicas must use the same public origin and bot settings.

   Each registration attempt has a five-second timeout, 16 KB response limit and
   no redirects. On failure, the API continues running and retries automatically
   after 1, 2, 4, 8 and then every 15 minutes until registration succeeds. Telegram's
   `retry_after` can extend a wait, capped at 24 hours. Only one registration request
   per process is active at a time; success ends the retries, and stopping the
   worker cancels scheduled retries. Warnings include the next delay without credentials.
   Existing subscriptions and notification delivery remain available; new account
   links and `/stop` need a working webhook. Connectivity recovery needs no restart;
   changing environment variables still requires restarting the API.

   Reverse proxies must forward `X-Telegram-Bot-Api-Secret-Token` and avoid logging
   request bodies or credentials. Keep the webhook outside interactive proxy login
   challenges.

The migration creates `pixel_it_telegram` automatically; the database account
also requires `DELETE` permission. Runtime files remain inside existing `libs/`
and `routes/` folders, already included in the Docker image.

## Connect an account

In the admin UI, open **Benachrichtigungen → Telegram verbinden**, open the generated
link and press **Start** in the bot's private chat. Return to the UI and click
**Aktualisieren** to confirm the connection. There is no browser polling.
The bot confirms a successfully saved connection once in the private chat.
This confirmation uses the webhook response and contains no GitHub credentials.
Expired, invalid or replayed link codes do not produce a confirmation.

The random linking code is stored only as a SHA-256 hash, expires after five minutes
and is consumed once. Do not share the link: it authorizes linking your subscription.
Generating another link invalidates the previous one. Only private chats from the
chat owner are accepted. A Telegram chat can be linked to only one GitHub account.
An existing active connection remains active until replaced or disconnected.

Use **Verbindung entfernen** or send `/stop` to the bot to disable notifications
and delete the subscription and pending linking code. Removing a moderator also
removes the subscription. After being added again, they must opt in again.
Changing the configured owner excludes the former owner from delivery unless
that account is still a moderator. A send already in flight may finish during
revocation.

## Delivery and limits

Only genuinely new reports increment counters; duplicate pending/approved reports
keep the existing public 202 response and do not trigger another notification.
Counter increments commit in the same transaction as the new report. Each connected
account has one bounded counter (maximum 1,000,000), with no per-report delivery queue.
Accounts start receiving notifications only for reports created after connection.
Notifications include the number of new reports and the admin link, without report
text, icon data, GitHub usernames or reporter information. Counts describe newly
received reports; some may already have been processed by another moderator.

After startup/migrations, the server checks for pending notifications every 60 seconds,
processing at most ten recipients per run, sequentially. At the full 101-account
capacity, delivery can take around eleven minutes, longer during failures. No device
requests or firmware payloads are added. Every authenticated recipient is rechecked
against current membership and its current chat connection before sending.
A database transaction claims and clears a counter before sending, preventing
multiple API processes from sending the same batch. New reports arriving afterward
remain pending for a later batch. Restarts preserve unclaimed counters.

Telegram calls time out after five seconds, limit responses to 16 KB and follow
no redirects. There are no automatic retries of a claimed batch: delivery is best
effort, with at most one attempt per batch. A crash, timeout or upstream failure
can lose a notification; reports remain available in the admin UI. This avoids
duplicate notifications when Telegram may have accepted a timed-out request.
A 403 removes the blocked chat's subscription. A 429 pauses subsequent batches
for the supplied `retry_after`, bounded to 60 seconds–24 hours. Delivery failures
are logged without bot tokens, chat IDs, linking codes or upstream error bodies.

## Endpoints and access

- `GET /api/admin/telegram`: own `available`, `connected` and `pending` status.
- `POST /api/admin/telegram/link`: creates own short-lived bot URL and `expiresIn`.
- `POST /api/admin/telegram/disconnect`: removes own subscription and pending link.
- `POST /api/telegram/webhook`: accepts bot updates only with the configured secret
  header; it requires neither an admin cookie nor browser Origin. Replayed `/start`
  codes cannot reconnect an account. Other messages and non-private chats are ignored.

Admin endpoints require the existing session; writes also require the exact Origin
and a GitHub account. Client-supplied account IDs are ignored. Status shares the
admin read limiter; link/disconnect share the admin action limiter. Webhook requests
have a separate IP-based limiter, without exemptions, in addition to the global API
limiter. Default: 120 requests per 60 seconds, configurable with positive integer
`API_TELEGRAM_WEBHOOK_LIMIT_MAX` and `API_TELEGRAM_WEBHOOK_LIMIT_WINDOW_MS`.
Proxy trust and IPv6 grouping follow the existing API configuration. A webhook
failure may be retried by Telegram; expired or consumed link codes have no effect.

See [Telegram's Bot API](https://core.telegram.org/bots/api#setwebhook) for webhook
registration and [deep links](https://core.telegram.org/bots/features#deep-linking)
for the account-linking flow.
