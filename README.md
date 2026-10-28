# PixelIt.API

This is the API service for the [PixelIt](https://github.com/pixelit-project/PixelIt) project, this provides the bitmaps for the Pixelit.

[![CodeQL](https://github.com/pixelit-project/PixelIt.API/actions/workflows/codeql.yml/badge.svg)](https://github.com/pixelit-project/PixelIt.API/actions/workflows/codeql.yml)

_____
<a href="https://t.me/pixelitdisplay">
    <img src="https://img.shields.io/endpoint?label=Telegram&style=for-the-badge&url=https%3A%2F%2Frunkit.io%2Fdamiankrawczyk%2Ftelegram-badge%2Fbranches%2Fmaster%3Furl%3Dhttps%3A%2F%2Ft.me%2Fpixelitdisplay"/>
</a> 
<a href="https://github.com/pixelit-project/PixelIt/discussions">
    <img src="https://img.shields.io/github/discussions/pixelit-project/PixelIt?&logo=github&label=GitHub%20Discussions&style=for-the-badge"/>
</a> 
<a href="https://discord.gg/ERBSHWxB2S">
    <img src="https://img.shields.io/discord/1145731525996970025?logo=discord&label=Discrod&style=for-the-badge"/>
</a>

## Installation

Use docker-compose

```yml
services:
  pixelit_api:
    restart: unless-stopped
    container_name: pixelit_api
    image: ghcr.io/pixelit-project/pixelit.api:latest
    ports:
      - "8080:8080"
    volumes:
      - /etc/localtime:/etc/localtime:ro
    environment:
      PORT: 8080
      TELEMETRY_USER_CHECK: "true"
      # Set to the actual reverse proxy IP(s) or CIDR(s); empty disables proxy trust.
      # Example for a proxy container with a fixed IP: "172.20.0.10"
      TRUSTED_PROXIES: ""
      MYSQL_HOST: host
      MYSQL_DATABASE: database
      MYSQL_USER: user
      MYSQL_PASSWORD: password
      GITHUB_TOKEN: token
      API_GLOBAL_LIMIT_WINDOW_MS: 300000
      API_GLOBAL_LIMIT_MAX: 100
      API_TELEMETRY_LIMIT_WINDOW_MS: 900000
      API_TELEMETRY_LIMIT_MAX: 10
      API_SAVEBITMAP_LIMIT_WINDOW_MS: 900000
      API_SAVEBITMAP_LIMIT_MAX: 10
      API_GLOBAL_LIMIT_EXCLUDE: "192.168.0.1, 192.168.2.1, 192.168.3.1, ::1"
      API_TELEMETRY_LIMIT_EXCLUDE: "192.168.0.1, 192.168.2.1, 192.168.3.1, ::1"
      API_SAVEBITMAP_LIMIT_EXCLUDE: "192.168.0.1, 192.168.2.1, 192.168.3.1, ::1"
      SEQ_SERVER: http://seqserver:5341
      SEQ_APIKEY: xxxxxxxxxxxx
```
<!--
### **WORK IN PROGRESS**
-->
## Environment variables

Set these values in the Docker Compose `environment` section or in a `.env`
file when running the API locally. Defaults below apply when a variable is not
set; the Compose example explicitly enables `TELEMETRY_USER_CHECK`.

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `8080` | Port on which the API listens inside the container. If changed, update the container side of the port mapping, e.g. `8080:9090` for `PORT: 9090`. |
| `TELEMETRY_USER_CHECK` | `false` | Set to `"true"` to restrict `/api/Statistics`, `/api/UserMap`, and `/api/UserMapData` to clients whose `uuid` query parameter matches a telemetry record updated within the last 30 days. Otherwise the response contains `error: { telemetryUser: false }`. This does not disable telemetry collection. The check is cached for 30 seconds. |
| `TRUSTED_PROXIES` | Empty (no proxy trust) | Comma-separated trusted proxy IPs or CIDRs used to resolve the client IP from `X-Forwarded-For`. Leave empty for direct access. See the proxy configuration notes below. |
| `MYSQL_HOST` | Not set by the API | MySQL server hostname or IP, reachable from the API container. |
| `MYSQL_DATABASE` | Not set by the API | Name of the existing PixelIt database. |
| `MYSQL_USER` | Not set by the API | MySQL user with access to the PixelIt tables. |
| `MYSQL_PASSWORD` | Not set by the API | Password for the MySQL user. |
| `GITHUB_TOKEN` | Not set (unauthenticated requests) | Optional token sent with GitHub API requests for PixelIt release information. |
| `API_GLOBAL_LIMIT_WINDOW_MS` | `300000` (5 minutes) | Rate-limit window in milliseconds for all `/api/` routes. |
| `API_GLOBAL_LIMIT_MAX` | `100` | Maximum requests per client in the global window. |
| `API_GLOBAL_LIMIT_EXCLUDE` | Empty | Comma-separated exact client IPs exempt from the global limiter only. |
| `API_TELEMETRY_LIMIT_WINDOW_MS` | `900000` (15 minutes) | Additional rate-limit window in milliseconds for `POST /api/Telemetry`. |
| `API_TELEMETRY_LIMIT_MAX` | `10` | Maximum telemetry requests per client in the telemetry window. |
| `API_TELEMETRY_LIMIT_EXCLUDE` | Empty | Comma-separated exact client IPs exempt from the telemetry limiter only. |
| `API_SAVEBITMAP_LIMIT_WINDOW_MS` | `900000` (15 minutes) | Additional rate-limit window in milliseconds for `POST /api/SaveBitmap`. |
| `API_SAVEBITMAP_LIMIT_MAX` | `10` | Maximum bitmap uploads per client in the bitmap window. |
| `API_SAVEBITMAP_LIMIT_EXCLUDE` | Empty | Comma-separated exact client IPs exempt from the bitmap limiter only. |
| `SEQ_SERVER` | Not set (Seq logging disabled) | Optional Seq server URL, e.g. `http://seqserver:5341`. Console logging remains enabled. |
| `SEQ_APIKEY` | Not set | API key for the Seq server, if required by that server. |

Use positive integers for rate-limit windows and request counts. A value of `0`
falls back to the default; it does not disable the limiter. Exceeding a limit
returns HTTP 429. Telemetry and bitmap requests are subject to both the global
and their endpoint-specific limiter. Excluding an IP from one limiter does not
exempt it from the others. Rate-limit counters are stored in memory per API
process and reset on restart.

### Proxy configuration and rate limits

By default the API uses the direct peer IP and ignores `X-Forwarded-For`.
When running behind a reverse proxy, set `TRUSTED_PROXIES` to a comma-separated
list of trusted proxy IPs or CIDRs, for example `127.0.0.1,::1` for a local proxy.
For a reverse proxy in another Docker container, use its address on the shared
Docker network; `127.0.0.1` refers to the API container itself. Keep the value
empty when accessing the API directly.
Use the actual proxy addresses for your deployment, restrict direct access to
the API, and ensure the proxy overwrites incoming forwarding headers.
Do not trust all addresses or a shared network containing untrusted clients.

Rate limits group IPv6 clients by /56 subnet. The existing `*_LIMIT_EXCLUDE`
settings match exact resolved client IPs, including normalized IPv4-mapped IPv6.

## Develop

Install dependencies with `npm install` and run dev server with `npm run dev`.

### Write requests

`SaveBitmap` and `Telemetry` return HTTP 200 only after the database write
completes, HTTP 400 for invalid input, and HTTP 500 for persistence failures.
The JSON body limit remains 100 KB (HTTP 413 when exceeded).

Bitmap uploads require nonempty `name` and `userName` strings (up to 255
characters), integer `sizeX`/`sizeY` dimensions from 1 to 256, a boolean
`animated`, and a string `rgb565array`. Each frame must contain exactly
`sizeX * sizeY` integer RGB565 values from 0 to 65535. Static data uses
`[0,65535]`; animated data uses `[0,65535],[65535,0]`, without an outer array.

Telemetry requires a 40-character hexadecimal `uuid`, nonempty `version` and
`type` strings, a `matrix` object with positive integer `type`, nonempty `name`,
and integer `width`/`height` from 1 to 256, plus a `sensors` array of at most
32 nonempty strings. Text fields are limited to 255 characters. `buildSection`
is optional and may be empty. GeoIP data is resolved by the server.

Run the regression tests with `npm test`. HTTP tests use a temporary loopback
server; database and GeoIP calls are stubbed, so no credentials are needed.

## Changelog

### Unreleased

- (o0shojo0o) Document all environment variables, defaults, telemetry access checks, and rate-limit configuration.
- (o0shojo0o) Trust forwarded client IPs only from proxies configured via `TRUSTED_PROXIES`.
- (o0shojo0o) Normalize client IPs and group IPv6 rate limits by /56 subnet.
- (o0shojo0o) Validate bitmap and telemetry payloads before writing to the database.
- (o0shojo0o) Return HTTP 200 only after successful persistence and HTTP 500 on write failures.
- (o0shojo0o) Add regression tests and a CI workflow for API validation, persistence errors, and rate limits.

### 1.8.10 (2025-12-28)
- (o0shojo0o) added new api endpoint `getBMPByID_v2` for better handling of animated bitmaps

### 1.8.7 (2024-10-07)

- (o0shojo0o) add uuid to each request

### 1.8.6 (2024-10-06)

- (o0shojo0o) change node from 20 to 21
- (o0shojo0o) update dependencies

### 1.8.5 (2023-11-16)

- (o0shojo0o) Build statistics revised

### 1.8.3 (2023-11-15)

- (o0shojo0o) Version statistics revised

### 1.8.1 (2023-11-11)

- (o0shojo0o) small fixes

### 1.8.0 (2023-11-11)

- (o0shojo0o) only active telemetry users can see statistics
- (o0shojo0o) added ENV param `TELEMETRY_USER_CHECK`

### 1.7.2 (2023-11-03)

- (o0shojo0o) small fixes

### 1.7.1 (2023-11-03)

- (o0shojo0o) added more statistics to endpoint `Statistics`

### 1.7.0 (2023-11-03)

- (o0shojo0o) added new api endpoint `Statistics`

### 1.6.0 (2023-10-27)

- (o0shojo0o) added `buildSection` for endpoint `Telemetry` 

### 1.5.0 (2023-09-26)

- (o0shojo0o) added ENV param `API_SAVEBITMAP_LIMIT_EXCLUDE`

### 1.4.2 (2023-09-05)

- (o0shojo0o) fix endpoint `SaveBitmap`

### 1.4.1 (2023-09-05)

- (o0shojo0o) small fixes

### 1.4.0 (2023-09-05)

- (o0shojo0o) added new api endpoint `SaveBitmap`

### 1.3.0 (2023-07-27)

- (o0shojo0o) added environment variable `API_GLOBAL_LIMIT_EXCLUDE`
- (o0shojo0o) added environment variable `API_TELEMETRY_LIMIT_EXCLUDE`

### 1.2.1 (2023-07-27)

- (o0shojo0o) fix rate limit key

### 1.2.0 (2023-07-27)

- (o0shojo0o) added environment variable `API_GLOBAL_LIMIT_WINDOW_MS`
- (o0shojo0o) added environment variable `API_GLOBAL_LIMIT_MAX`
- (o0shojo0o) added environment variable `API_TELEMETRY_LIMIT_WINDOW_MS`
- (o0shojo0o) added environment variable `API_TELEMETRY_LIMIT_MAX`
- (o0shojo0o) added environment variable `API_TELEMETRY_LIMIT_MAX`
- (o0shojo0o) enrich log with rate limit data
- (o0shojo0o) added .env file support 

### 1.1.1 (2023-02-14)

- (o0shojo0o) added rate limits

### 1.1.0 (2022-12-13)

- (o0shojo0o) no prereleases for releases statistics, information, etc. not considered.

### 1.0.1 (2022-09-05)

- (o0shojo0o) fix id check

### 1.0.0 (2022-09-05)

- (o0shojo0o) inital commit
