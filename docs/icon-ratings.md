# Icon ratings

The API creates the rating table during startup. A positive icon ID and an
integer from 1 through 5 identify a vote. Each icon and PixelIt device UUID pair
has one permanent vote. A retry returns the original vote and the current
aggregate, even if the retry sends a different star count. Hidden and missing
icons cannot receive votes. Hidden icons are excluded from the ratings list.

- `GET /api/icon-ratings` returns an array with one entry per rated visible icon.
  The optional `X-PixelIt-Rating-UUID` header includes the caller's own rating
  in each entry. Without it, `myRating` is always `null`.
- `POST /api/icon-ratings` requires the `X-PixelIt-Rating-UUID` header and a JSON
  body such as `{"iconId":123,"stars":4}`. It returns the updated entry with HTTP
  200. Invalid requests return 400, unavailable icons 404, and rate-limited
  requests 429.

An entry looks like `{"iconId":123,"average":4.5,"count":2,"myRating":4}`.
Responses are marked `Cache-Control: no-store`. The existing bitmap endpoints
retain their response formats. Use the 40-character hexadecimal UUID from the
connected PixelIt's telemetry preview. The same device has the same vote across
browsers. Telemetry uploads can stay disabled. The UUID identifies the device
for deduplication and is supplied by the client. Voting requests have a dedicated per-client-IP
limit of 1,000 requests per 15 minutes by default. Rating reads use the global
API limit.
