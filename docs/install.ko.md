# 설치 안내

[English](install.md)

- [요구 사항](#요구-사항)
- [설치](#설치)
- [HTTPS](#https)
- [백업과 복원](#백업과-복원)
- [Pagehouse와 함께 쓰기](#pagehouse와-함께-쓰기)
- [모니터링](#모니터링)
- [AI 에이전트 (MCP)](#ai-에이전트-mcp)
- [이미지와 취약점](#이미지와-취약점)

## 요구 사항

- Docker 24+ 또는 Podman 4+가 있는 Linux 서버 한 대(amd64 또는 arm64).
- 컨테이너 셋: 앱, PostgreSQL 17, 백업 작업. 다른 서비스는 필요 없습니다.
- 이슈 5만 건으로 측정(`npx tsx scripts/perf.ts`):

| 쿼리 | 응답 |
|---|---|
| 백로그, 보드, 내 이슈, 라벨, 오래된 진행 건 | 4~19ms |
| 본문 검색(한글 2글자·단어) | 15~31ms |
| 5만 자짜리 설명 저장 | 89ms |

## 설치

### 릴리스 번들로 (인터넷 없이도 됨)

[릴리스](https://github.com/spro1/taskhouse/releases)에서 `taskhouse-<버전>-<amd64|arm64>.tar.gz`와 `SHA256SUMS`를 받아
서버로 옮긴 뒤:

```sh
sha256sum -c SHA256SUMS --ignore-missing
tar xzf taskhouse-<버전>-amd64.tar.gz
cd taskhouse-<버전>
scripts/install.sh images.tar
```

번들에 컨테이너 이미지가 들어 있어(약 180MB) 아무것도 내려받지 않습니다. 직접 만들려면 인터넷이 되는 곳에서 이
저장소를 받아 `scripts/bundle.sh`를 실행하세요.

### 소스에서

```sh
git clone https://github.com/spro1/taskhouse.git && cd taskhouse
scripts/install.sh
```

설치 스크립트는:

- 무작위 DB 비밀번호와 `SECRET_KEY`를 넣은 `.env`를 만들고(권한 600, 백업에 들어가지 않으니 따로 보관),
- 이미지를 빌드하거나 불러와 모두 띄우고,
- 앱이 응답할 때까지 기다렸다가 1회용 설정 토큰을 출력합니다.

모든 설정은 [`.env.example`](../.env.example)에 설명이 있습니다. `.env`를 고친 뒤에는 `docker compose up -d`
(또는 `podman compose up -d`)로 반영합니다.

## HTTPS

리버스 프록시(nginx, Caddy 등) 뒤에 두고 `.env`에 다음을 넣습니다.

- `PUBLIC_URL=https://tasks.example.com`: 메일·웹훅의 링크, SSO 리다이렉트, 보안 쿠키.
- `BIND_ADDRESS=127.0.0.1`: 프록시만 앱에 닿게.
- `TRUST_PROXY=1`: 앞단 프록시 수. 로그인 제한과 감사 로그가 실제 주소를 봅니다.

프록시는 `/api/live`의 WebSocket 업그레이드를 넘겨야 합니다(보드 실시간 갱신). nginx 예:

```nginx
location / {
  proxy_pass http://127.0.0.1:3000;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  client_max_body_size 60m;
}
```

## 백업과 복원

```sh
scripts/backup.sh                # 수동 백업 → ./backups/manual-<시각>/
scripts/restore.sh <폴더 이름>    # 현재 상태를 prerestore-…로 먼저 백업한 뒤 복원
scripts/upgrade.sh               # preupgrade-… 백업 → 새 이미지 → 재기동(마이그레이션 자동 적용)
scripts/upgrade.sh images.tar    # 같은 작업을 새 오프라인 번들로
```

- 자동 백업은 24시간마다(`BACKUP_INTERVAL_HOURS`) 실행하고 14개(`BACKUP_KEEP`)를 남깁니다.
- 백업 하나는 `db.dump` + `files/`입니다. 첨부는 내용이 바뀌지 않으므로 이전 백업과 하드링크로 공유하고, 백업마다
  새 파일만 늘어납니다.
- `./backups`는 `.env`와 함께 서버 밖(NAS 등)으로도 복사해 두세요.
- 업그레이드 전에 [버전별 안내](upgrading.ko.md)를 읽으세요.

## Pagehouse와 함께 쓰기

Taskhouse와 [Pagehouse](https://github.com/spro1/pagehouse)(위키)는 별도 제품이지만, 한 제품군의 두 제품처럼 계정을
함께 쓸 수 있습니다. 두 제품이 **같은 PostgreSQL 데이터베이스**(같은 `DATABASE_URL`)를 쓰면 계정을 공유합니다. 각
제품의 테이블은 자기 스키마(`taskhouse`, `pagehouse`)에 있고, 사용자·비밀번호·로그인·그룹·SSO 설정은 `accounts`
스키마에 한 벌만 있습니다.

| 함께 쓰는 것 | 제품마다 따로인 것 |
|---|---|
| 계정 (이름, 이메일, 비밀번호, 비활성화 여부) | 누가 관리자인지, 프로젝트 역할 등 모든 권한 |
| 로그인: 한쪽에서 로그인·로그아웃하면 다른 쪽도 같습니다 | API 토큰 |
| 그룹과 구성원 | 이슈, 페이지, 첨부, 웹훅, 감사 로그, 그 밖의 모든 설정 |
| SSO 설정 (어느 제품의 관리 → SSO에서든) | |

### 함께 설치하기 (서버 한 대)

둘 중 하나를 평소처럼 설치한 뒤, 다른 제품을 설치할 때 `--share-with`에 먼저 설치한 제품의 폴더를 지정합니다. 어느
쪽이 먼저여도 되고, 새 서버에 둘 다 설치할 때도 같습니다.

```sh
# Pagehouse가 /opt/pagehouse에 설치되어 있을 때 Taskhouse 추가 (이 폴더에서 실행)
scripts/install.sh --share-with /opt/pagehouse            # 포트 3000, Pagehouse가 3000이면 3001
PORT=8081 scripts/install.sh --share-with /opt/pagehouse  # 포트를 직접 지정

# Taskhouse가 /opt/taskhouse에 설치되어 있을 때 Pagehouse 추가
curl -fsSL https://github.com/spro1/pagehouse/releases/latest/download/install.sh | sh -s -- --share-with /opt/taskhouse --port 3001
```

- 추가하는 제품은 자기 데이터베이스를 띄우지 않고, 먼저 설치한 제품의 compose 네트워크에 붙어 그 데이터베이스를
  씁니다(`docker-compose.shared.yml`). DB 비밀번호와 `SECRET_KEY`는 설치 스크립트가 그 설치의 `.env`에서 옮겨 적습니다.
- 먼저 설치한 제품은 계속 실행되며 계정, 비밀번호, 그룹, 로그인 상태, 내용이 그대로입니다.
- 추가한 제품에는 초기 설정과 설정 토큰이 없고, 기존 계정으로 바로 로그인합니다. 처음에는 그 제품의 관리자가 없고,
  다른 제품의 관리자가 처음 들어오면 관리자가 됩니다.
- 설치 뒤 두 제품의 `.env`에 `PUBLIC_URL`을 넣고 각 폴더에서 `compose up -d`로 반영하면 메뉴에 상대 제품 링크가 나옵니다.

### 함께 운영할 때

- 추가한 제품은 먼저 설치한 제품이 실행 중이어야 동작합니다(데이터베이스가 그쪽에 있음).
- 각 제품의 백업에는 공유 데이터베이스 전체(두 제품 모두)와 그 제품의 첨부 파일이 들어갑니다. 한쪽을 복원하면
  계정과 두 제품이 모두 그 시점으로 돌아갑니다.
- `scripts/restore.sh` 전에 다른 제품을 멈추고(그 폴더에서 `compose stop app`) 끝난 뒤 다시 시작하세요. 두 번째
  제품을 추가하기 전에 만든 백업은 복원을 거부하고 아무것도 바꾸지 않습니다.

### 관련 설정

- 두 제품에 같은 `SECRET_KEY`(SSO 클라이언트 비밀을 양쪽이 읽어야 함). 설치 스크립트가 맞춰 줍니다.
- `PUBLIC_URL`: 상대 제품 링크.
- `COOKIE_DOMAIN`은 서브도메인이 서로 다를 때만: 상위 도메인(`tasks.example.com`과 `wiki.example.com`이면
  `example.com`). 같은 호스트 이름이면 비워 둡니다. 로그인 쿠키가 그 도메인 아래 모든 사이트로 가므로, 모두 직접
  운영하는 사이트일 때만 쓰세요.
- SSO: IdP의 클라이언트 하나에 두 제품의 콜백 주소를 모두 등록합니다. 설정을 바꾸면 다른 제품에는 30초 안에
  반영됩니다. `OIDC_ADMIN_GROUP`을 지정했다면 SSO로 로그인할 때마다 두 제품의 관리자 여부가 그 그룹에 따라 정해집니다.

### 알아 둘 것

- 한 제품에서 만든 계정은 다른 제품에서 일반 구성원입니다. 계정을 비활성화하면 양쪽 모두 막힙니다. Pagehouse에서
  그룹을 삭제하면 그 그룹에 준 프로젝트 역할도 없어집니다.
- **이미 계정이 있는 두 설치**는 같은 데이터베이스로 지정해 합칠 수 없습니다. 두 번째 제품이 시작을 거부하고
  아무것도 바꾸지 않습니다. 기존 계정 합치기는 아직 지원하지 않습니다.
- 서버가 서로 다르거나 직접 운영하는 PostgreSQL을 쓸 때는 설치 옵션이 없습니다. 두 제품에 같은 `DATABASE_URL`과
  같은 `SECRET_KEY`를 주고, 그 데이터베이스는 직접 백업하세요. 덤프 하나에 두 제품이 모두 들어 있습니다.
- 두 제품을 따로 쓰려면 기본 설치처럼 데이터베이스를 따로 주면 됩니다. 그러면 아무것도 공유하지 않습니다.

### 추가한 제품을 다시 없애기

그 폴더에서 `compose down -v`를 실행한 뒤 공유 데이터베이스에서 그 제품의 테이블과 메뉴 링크를 지웁니다. 계정은 남습니다.

```sh
# Taskhouse를 추가했던 경우, Pagehouse 폴더에서:
docker compose exec db psql -U pagehouse -c "DROP SCHEMA taskhouse CASCADE" -c "DELETE FROM accounts.settings WHERE key = 'url:taskhouse'"
# Pagehouse를 추가했던 경우, Taskhouse 폴더에서:
docker compose exec db psql -U taskhouse -c "DROP SCHEMA pagehouse CASCADE" -c "DELETE FROM accounts.settings WHERE key = 'url:pagehouse'"
```

## 모니터링

**관리 → 모니터링**에서 앱 상태를 봅니다(15초마다 갱신).

- 최근 15분의 요청, 서버 오류, 느린 요청
- DB 응답 시간, 실시간 연결, 밀린 웹훅과 메일
- 저장 공간, 백업 지연 경고, 사용 현황

백업 지연 경고는 app 컨테이너가 `./backups`를 읽기 전용으로 볼 수 있어야 나옵니다(지금의 `docker-compose.yml`에
들어 있음).

Prometheus는 `.env`에 `METRICS_TOKEN`을 넣고 `Authorization: Bearer <토큰>`으로 `/metrics`를 수집합니다. 지표는
인스턴스별이고 재시작하면 0부터 셉니다. `GET /healthz`는 앱과 DB가 살아 있으면 응답합니다.

## AI 에이전트 (MCP)

**내 설정 → API 토큰**에서 토큰을 만들면 Claude Code에 추가하는 명령이 함께 나옵니다.

```sh
claude mcp add --transport http taskhouse https://tasks.example.com/api/mcp --header "Authorization: Bearer th_…"
```

- 도구: `list_projects`, `search_issues`(TQL), `get_issue`, `create_issue`, `update_issue`, `transition_issue`,
  `get_comments`, `add_comment`.
- 설명과 댓글은 Markdown으로 주고받습니다.
- 모든 도구는 REST API를 토큰 주인으로 호출하므로 권한·워크플로 규칙·변경 이력이 화면과 같습니다.

## 이미지와 취약점

| 이미지 | 기반 | Trivy | Grype |
|---|---|---|---|
| `taskhouse` (앱, 186MB) | node:26-alpine, npm·셸·시스템 OpenSSL 제거 | 0 | 0 |
| `taskhouse-postgres` (302MB) | postgres:17-alpine, OS 패치, gosu 제거 | 0 | 17 (아래) |

- DB 이미지의 Grype 결과는 alpine에 아직 수정 버전이 없는 항목입니다.
  - busybox wget(CVE-2025-60876, wget을 쓰지 않음)
  - OpenSSL 3.5.9의 QUIC·DTLS·CMS·DANE·Suite B 관련 항목(PostgreSQL이 compose 내부망에서 TLS 없이 동작하므로 해당
    경로를 타지 않음)
- alpine에 패치가 나오면 `scripts/upgrade.sh`로 다시 빌드하면 반영됩니다(`apk upgrade`).
- DB는 UTF-8 로캘(`en_US.UTF-8`)로 초기화합니다. `C` 로캘이나 PG17 builtin `C.UTF-8`에서는 `pg_trgm`이 한글
  trigram을 만들지 않아 한국어 검색이 인덱스를 못 씁니다. 앱이 시작할 때 점검해 경고합니다.
