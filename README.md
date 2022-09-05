# PixelIt.api

This is the API service for the [PixelIt](https://github.com/pixelit-project/PixelIt) project, this provides the bitmaps for the Pixelit.

<a href="https://t.me/pixelitdisplay">
    <img src="https://img.shields.io/endpoint?label=Telegram&style=for-the-badge&url=https%3A%2F%2Frunkit.io%2Fdamiankrawczyk%2Ftelegram-badge%2Fbranches%2Fmaster%3Furl%3Dhttps%3A%2F%2Ft.me%2Fpixelitdisplay"/>
</a> 
<a href="https://github.com/pixelit-project/PixelIt/discussions">
    <img src="https://img.shields.io/github/discussions/pixelit-project/PixelIt?&logo=github&label=GitHub%20Discussions&style=for-the-badge"/>
</a> 
<a href="https://discord.gg/JHE9P9zczW">
    <img src="https://img.shields.io/discord/558849582377861122?logo=discord&label=Discrod&style=for-the-badge"/>
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
    MYSQL_HOST: host
    MYSQL_DATABASE: database
    MYSQL_USER: user
    MYSQL_PASSWORD: password
    GITHUB_TOKEN: token
    SEQ_SERVER: http://seqserver:5341
    SEQ_APIKEY: xxxxxxxxxxxx
```

## Develop

Install dependencies with `npm install` and run dev server with `npn run dev`.

## Changelog

### 1.0.1 (2022-09-05)

- (o0shojo0o) fix id check

### 1.0.0 (2022-09-05)

- (o0shojo0o) inital commit
