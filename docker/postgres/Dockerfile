# PostgreSQL for Taskhouse: the official alpine image with patched OS packages and without gosu.
# Initialised with a UTF-8 locale (see docker-compose.yml): musl then classifies Hangul as letters, so pg_trgm indexes
# Korean text. A C locale would not (checked: 0 trigrams for '가나다').
# gosu only switches root -> postgres at startup and ships an old Go runtime that scanners flag; running as the
# postgres user from the start makes the entrypoint skip it.
FROM docker.io/library/postgres:19-alpine
RUN apk upgrade --no-cache && rm -f /usr/local/bin/gosu
USER postgres
