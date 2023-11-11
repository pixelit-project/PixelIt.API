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
pixelit_api:
  restart: unless-stopped
  container_name: pixelit_api
  image: ghcr.io/pixelit-project/pixelit.api:latest
  volumes:
    - /etc/localtime:/etc/localtime:ro
  environment:
    PORT: 8080
    TELEMETRY_USER_CHECK: false
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
## Develop

Install dependencies with `npm install` and run dev server with `npn run dev`.

## Changelog

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
