# Taskhouse

소규모 조직(5~100명)이 자기 서버에 설치해 쓰는 경량 이슈 트래커입니다. 앱 하나와 PostgreSQL 하나로 동작합니다.
Apache-2.0 라이선스의 오픈소스입니다. 보안 문제는 [SECURITY.md](SECURITY.md)의 방법으로 비공개 제보해 주세요.

## 지금 들어 있는 것 (0·1단계 + TQL)

- 첫 실행 설정 토큰(서버 로그에 출력), 초대 링크 계정, 비밀번호 로그인, OIDC SSO(PKCE, nonce, 그룹 동기화, 관리자 그룹; 관리 화면 또는 환경변수로 설정)
- Pagehouse(위키)와 계정 공유: 같은 데이터베이스를 쓰면 사용자·로그인·그룹·SSO 설정을 함께 쓰고 상단 메뉴로 오갑니다. 역할과 권한은 제품마다 따로(아래 "Pagehouse와 함께 쓰기")
- 로그인 시도 제한: 15분 동안 같은 주소·계정 10회, 같은 주소 50회, 같은 계정 30회(넘으면 429와 `Retry-After`)
- 비밀번호 찾기(메일 설정 시 1시간짜리 링크), 관리자가 발급하는 재설정 링크와 임시 비밀번호(다음 로그인 때 변경 강제)
- 한국어·영어 화면과 메일(계정마다 선택, 기본 한국어)
- DB에 저장하는 비밀값(웹훅 서명 키, SSO 클라이언트 비밀)은 `SECRET_KEY`로 암호화
- 개인 API 토큰(최대 365일, 기본 90일). 계정 비활성화 시 폐기, SSO 계정은 30일간 로그인이 없으면 정지
- 프로젝트 역할 4종(열람자·보고자·멤버·관리자)과 공개 범위 3종. 권한 밖 이슈는 모든 경로에서 404
- 이슈(에픽 > 표준 > 하위 작업 계층 검사), 필드 단위 병합(`_base`), 변경 이력, 댓글, 링크, 첨부(sha256 중복 제거), 지켜보기
- 설명·댓글은 Tiptap 서식 문서와 @멘션(멘션된 사람에게 알림). 저장된 문서는 HTML 문자열 없이 React 요소로만 그려서 스크립트가 끼어들 수 없음
- 워크플로: 기본은 자유 이동. 설정 화면에서 상태와 전이 규칙(누가·조건·이동 후 처리)을 편집
- 보드(드래그로 전이와 순서 변경), 백로그, 스프린트(시작·완료 시 미완료 이슈 이동)
- 실시간 갱신: 보드·백로그·이슈 화면이 다른 사람의 변경을 바로 반영(WebSocket + LISTEN/NOTIFY, 소켓으로는 ID만 보냄)
- 검색: TQL(JQL 부분집합, `CHANGED`, `linked`, `membersOf()` 등)과 필터 칩이 같은 엔진을 씀. 권한 조건 항상 포함, 3초 제한. ⌘K로 키 이동과 전문 검색. 저장된 필터
- 한국어 검색: 조사 처리, 2글자 단어도 인덱스 사용(한글 2음절 조각 GIN 인덱스)
- 알림: 앱 내 알림, 메일 묶음(SMTP 설정 시, 5분 조용하면 발송), 웹훅(HMAC 서명, 재시도 5회)과 메신저(Slack·Mattermost·Teams). 모두 볼 권한이 있는 사람에게만
- 관리 화면(초대, 비활성화, 관리자 지정, 비밀번호 재설정 링크, 임시 비밀번호, SSO 설정, 감사 로그), 내 설정(언어, 비밀번호 변경, 알림 메일, API 토큰)
- 내보내기: 프로젝트 전체 JSON(설명·댓글·링크·이력 포함), 이슈 목록 CSV
- 보안: 요청 크기 제한, 다른 사이트에서 온 변경 요청 거부, CSP·프레임 차단 헤더, 웹훅은 사이트 관리자만 등록하고 루프백·링크로컬로는 보내지 않음, 백업 파일은 소유자만 읽기
- 감사 로그, 자동 백업(첨부는 하드링크로 증분), 복원·업그레이드·오프라인 번들 스크립트, 첨부 저장 한도와 쓰지 않는 파일 정리

아직 없는 것(2·3단계): Git·CI 연동, 버전·릴리스, 차트, 사용자 정의 필드, 자동화 규칙, MCP 서버, 타임라인, 이슈별 열람 제한.

### 성능 (이슈 5만 건, `npx tsx scripts/perf.ts`)

| 쿼리 | 응답 |
|---|---|
| 백로그, 보드, 내 이슈, 라벨, 오래된 진행 건 | 4~19ms |
| 본문 검색(한글 2글자·단어) | 15~31ms |
| 5만 자짜리 설명 저장 | 89ms |

## 설치와 운영 (Podman 또는 Docker)

```sh
scripts/install.sh               # .env 생성(DB 비밀번호 무작위) → 이미지 빌드 → 기동 → 설정 토큰 출력
scripts/backup.sh                # 수동 백업 → ./backups/manual-<시각>/
scripts/restore.sh <폴더 이름>    # 현재 상태를 prerestore-…로 먼저 백업한 뒤 복원
scripts/upgrade.sh               # preupgrade-… 백업 → 새 이미지 → 재기동(마이그레이션 자동 적용)
```

폐쇄망: 인터넷이 되는 곳에서 `scripts/bundle.sh` → `taskhouse-<버전>.tar.gz`(이미지 포함, 약 180MB)를 옮겨
`tar xzf … && cd taskhouse-<버전> && scripts/install.sh images.tar`. 업그레이드는 `scripts/upgrade.sh images.tar`.

자동 백업은 24시간마다(`BACKUP_INTERVAL_HOURS`) 14개(`BACKUP_KEEP`)를 남깁니다. 백업 하나는 `db.dump` + `files/`이고,
첨부는 내용이 바뀌지 않으므로 이전 백업과 하드링크로 공유합니다. `./backups`는 서버 밖으로도 복사해 두세요.

### 기존 설치를 업그레이드할 때

- `.env`에 `SECRET_KEY`(긴 무작위 문자열)를 추가하고 재시작하세요. 이미 저장된 웹훅 서명 키는 시작할 때 암호화되고, 받는 쪽은 바꿀 것이 없습니다.
  `SECRET_KEY`가 없어도 지금처럼 동작합니다(평문 저장). 한 번 설정한 뒤 잃어버리면 웹훅 서명 키와 SSO 클라이언트 비밀을 다시 만들어야 합니다.
- 로그인 세션의 기본 수명이 24시간으로 바뀌었습니다. 다만 기존 설치는 `.env`에 `SESSION_HOURS=12`가 적혀 있어 12시간으로 남습니다. 새 기본값을 쓰려면 그 줄을 `24`로 고치거나 지우고 재시작하세요(새 로그인부터 적용).
- SSO로 새 계정을 만들 때도 IdP가 확인한 이메일이 필요합니다(Pagehouse와 같은 기준). `email_verified`를 보내지 않는 IdP를 쓰면 업그레이드 뒤 새 사용자가 SSO로 들어오지 못합니다(`no_email`).
  그런 IdP라면 `.env`에 `OIDC_TRUST_EMAIL=1`을 넣거나 관리 → SSO에서 "확인 표시를 하지 않은 이메일도 믿기"를 켜세요. 이미 계정이 있는 사람은 영향이 없습니다.
- `TRUST_PROXY`는 앞단 프록시 수입니다. 기존 `1`은 그대로 "프록시 1단"입니다. 이제 `X-Forwarded-For`의 오른쪽에서부터 세므로 클라이언트가 이 헤더를 꾸며도 로그인 제한을 피할 수 없습니다.
- 계정 테이블(`users`, `sessions`, `groups`, `group_members`)이 처음 시작할 때 데이터와 함께 `accounts` 스키마로 옮겨지고, SSO 설정은 `accounts.settings`로 옮겨집니다. 사용할 때 달라지는 것은 없습니다. DB 계정에 데이터베이스의 `CREATE` 권한이 있어야 합니다(기본 설치와 데이터베이스 소유자에게는 이미 있음). 직접 실행하는 SQL에는 스키마를 붙여야 하고(`accounts.users`), 이전 버전은 새 구조를 읽지 못하므로 되돌리려면 `preupgrade-…` 백업을 복원하세요.
- SSO에서 온 그룹도 이제 관리 화면에서 구성원을 고칠 수 있습니다. SSO 로그인은 자기가 넣은 구성원만 넣고 빼며, 직접 넣은 구성원은 건드리지 않습니다(Pagehouse와 같은 규칙).

### Pagehouse와 함께 쓰기

Taskhouse와 [Pagehouse](https://github.com/spro1/pagehouse)(위키)는 별도 제품이지만, 한 제품군의 두 제품처럼 계정을 함께 쓸 수 있습니다. 두 제품이 **같은 PostgreSQL 데이터베이스**(같은 `DATABASE_URL`)를 쓰면 계정을 공유합니다.
각 제품의 테이블은 자기 스키마(`taskhouse`, `pagehouse`)에 있고, 사용자·비밀번호·로그인·그룹·SSO 설정은 `accounts` 스키마에 한 벌만 있습니다.

| 함께 쓰는 것 | 제품마다 따로인 것 |
|---|---|
| 계정 (이름, 이메일, 비밀번호, 비활성화 여부) | 누가 관리자인지, 프로젝트 역할 등 모든 권한 |
| 로그인: 한쪽에서 로그인·로그아웃하면 다른 쪽도 같습니다 | API 토큰 |
| 그룹과 구성원 | 이슈, 페이지, 첨부, 웹훅, 감사 로그, 그 밖의 모든 설정 |
| SSO 설정 (어느 제품의 관리 → SSO에서든) | |

- **함께 설치하기 (서버 한 대)**: 둘 중 하나를 평소처럼 설치한 뒤, 다른 제품을 설치할 때 `--share-with`에 먼저 설치한 제품의 폴더를 지정합니다. 어느 쪽이 먼저여도 되고, 새 서버에 둘 다 설치할 때도 같습니다.
  ```sh
  # Pagehouse가 /opt/pagehouse에 설치되어 있을 때 Taskhouse 추가 (이 폴더에서 실행)
  scripts/install.sh --share-with /opt/pagehouse            # 포트 3000, Pagehouse가 3000이면 3001
  PORT=8081 scripts/install.sh --share-with /opt/pagehouse  # 포트를 직접 지정

  # Taskhouse가 /opt/taskhouse에 설치되어 있을 때 Pagehouse 추가
  curl -fsSL https://github.com/spro1/pagehouse/releases/latest/download/install.sh | sh -s -- --share-with /opt/taskhouse --port 3001
  ```
  추가하는 제품은 자기 데이터베이스를 띄우지 않고, 먼저 설치한 제품의 compose 네트워크에 붙어 그 데이터베이스를 씁니다(`docker-compose.shared.yml`). DB 비밀번호와 `SECRET_KEY`는 설치 스크립트가 그 설치의 `.env`에서 옮겨 적습니다.
  먼저 설치한 제품은 계속 실행되며 계정, 비밀번호, 그룹, 로그인 상태, 내용이 그대로입니다. 계정이 이미 있으므로 추가한 제품에는 초기 설정과 설정 토큰이 없고, 기존 계정으로 바로 로그인합니다.
  처음에는 그 제품의 관리자가 없고, 다른 제품의 관리자가 처음 들어오면 관리자가 됩니다. 설치 뒤 두 제품의 `.env`에 `PUBLIC_URL`을 넣고 각 폴더에서 `compose up -d`로 반영하면 상단 메뉴에 상대 제품 링크가 나옵니다.
- **함께 운영할 때**: 추가한 제품은 먼저 설치한 제품이 실행 중이어야 동작합니다(데이터베이스가 그쪽에 있음). 각 제품의 백업에는 공유 데이터베이스 전체(두 제품 모두)와 그 제품의 첨부 파일이 들어가고, 한쪽을 복원하면 계정과 두 제품이 모두 그 시점으로 돌아갑니다.
  `scripts/restore.sh` 전에 다른 제품을 멈추고(그 폴더에서 `compose stop app`) 끝난 뒤 다시 시작하세요. 두 번째 제품을 추가하기 전에 만든 백업은 복원을 거부하고 아무것도 바꾸지 않습니다.
- **추가한 제품을 다시 없애기**: 그 폴더에서 `compose down -v`를 실행한 뒤 공유 데이터베이스에서 그 제품의 테이블과 메뉴 링크를 지웁니다. Taskhouse를 추가했던 경우 Pagehouse 폴더에서
  `docker compose exec db psql -U pagehouse -c "DROP SCHEMA taskhouse CASCADE" -c "DELETE FROM accounts.settings WHERE key = 'url:taskhouse'"`, Pagehouse를 추가했던 경우 이 폴더에서
  `docker compose exec db psql -U taskhouse -c "DROP SCHEMA pagehouse CASCADE" -c "DELETE FROM accounts.settings WHERE key = 'url:pagehouse'"`. 계정은 남습니다.
- **관련 설정**(`SECRET_KEY`는 설치 스크립트가 맞춰 줌): 같은 값의 `SECRET_KEY`(SSO 클라이언트 비밀을 양쪽이 읽어야 함), `PUBLIC_URL`(상단 메뉴에 상대 제품 링크가 나옴),
  서브도메인이 서로 다르면 `COOKIE_DOMAIN`에 상위 도메인(`tasks.example.com`과 `wiki.example.com`이면 `example.com`). 같은 호스트 이름이면 `COOKIE_DOMAIN`은 비워 둡니다. 로그인 쿠키가 그 도메인 아래 모든 사이트로 전송되므로, 그 사이트가 모두 직접 운영하는 것일 때만 쓰세요.
- **SSO**: IdP의 클라이언트 하나에 두 제품의 콜백 주소를 모두 등록합니다. 설정을 바꾸면 다른 제품에는 30초 안에 반영됩니다. `OIDC_ADMIN_GROUP`을 지정했다면 SSO로 로그인할 때마다 두 제품의 관리자 여부가 그 그룹에 따라 정해집니다.
- 한 제품에서 만든 계정은 다른 제품에서 일반 구성원입니다. 계정을 비활성화하면 양쪽 모두 막힙니다. Pagehouse에서 그룹을 삭제하면 그 그룹에 준 프로젝트 역할도 없어집니다.
- **이미 계정이 있는 두 설치**는 같은 데이터베이스로 지정해 합칠 수 없습니다. 두 번째 제품이 시작을 거부하고 아무것도 바꾸지 않습니다. 기존 계정 합치기는 아직 지원하지 않습니다.
- 서버가 서로 다르거나 직접 운영하는 PostgreSQL을 쓸 때는 설치 옵션이 없습니다. 두 제품에 같은 `DATABASE_URL`과 같은 `SECRET_KEY`를 주고, 그 데이터베이스는 직접 백업하세요. 덤프 하나에 두 제품이 모두 들어 있습니다.
- 두 제품을 따로 쓰려면 기본 설치처럼 데이터베이스를 따로 주면 됩니다. 그러면 아무것도 공유하지 않습니다.
- 계정 테이블을 바꾸는 마이그레이션은 `ADD COLUMN IF NOT EXISTS`로 쓰고 기본값을 주며, Pagehouse에도 같은 변경을 넣습니다(`server/app.test.ts`의 `PAGEHOUSE_ACCOUNTS`가 상대 쪽 구조의 사본).

### 이미지와 취약점

| 이미지 | 기반 | Trivy | Grype |
|---|---|---|---|
| `taskhouse` (앱, 186MB) | node:26-alpine, npm·셸·시스템 OpenSSL 제거 | 0 | 0 |
| `taskhouse-postgres` (302MB) | postgres:17-alpine, OS 패치, gosu 제거 | 0 | 17 (아래) |

DB 이미지의 Grype 결과는 alpine에 아직 수정 버전이 없는 항목입니다. busybox wget(CVE-2025-60876, wget을 쓰지 않음)과
OpenSSL 3.5.9의 QUIC·DTLS·CMS·DANE·Suite B 관련 항목(PostgreSQL이 compose 내부망에서 TLS 없이 쓰므로 해당 경로를 타지 않음)입니다.
alpine에 패치가 나오면 `scripts/upgrade.sh`로 다시 빌드하면 반영됩니다(`apk upgrade`).

DB는 UTF-8 로캘(`en_US.UTF-8`)로 초기화합니다. `C` 로캘이나 PG17 builtin `C.UTF-8`에서는 `pg_trgm`이 한글 trigram을 만들지 않아
한국어 검색이 인덱스를 못 씁니다(측정 확인, alpine·Debian 모두 UTF-8 libc 로캘이면 정상). 앱이 시작할 때 점검해 경고합니다.

### SSO (OIDC)

관리 → SSO 화면에서 설정하거나(클라이언트 비밀은 `SECRET_KEY`로 암호화해 저장), `.env`에 `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`을 넣습니다(환경변수가 있으면 그쪽이 우선이고 화면은 읽기 전용). 그리고 IdP에는 리다이렉트 URI `$PUBLIC_URL/api/auth/oidc/callback`과
로그아웃 후 이동 주소 `$PUBLIC_URL/`을 등록합니다. 그룹은 `groups` 클레임(`OIDC_GROUPS_CLAIM`)에서 로그인할 때마다 가져오고,
`OIDC_ADMIN_GROUP` 구성원은 사이트 관리자가 됩니다. 로그아웃하면 IdP 세션도 끝납니다.
계정은 IdP의 `sub`로 찾습니다. 처음 로그인하면 같은 이메일의 기존 로컬 계정에 연결하거나 새 계정을 만드는데(`OIDC_AUTO_CREATE=0`이면 만들지 않음),
둘 다 IdP가 확인한 이메일(`email_verified`)일 때만 합니다. `email_verified`를 보내지 않는 IdP라면 `OIDC_TRUST_EMAIL=1`로 허용할 수 있습니다(IdP가 `false`라고 하면 여전히 거부).
이미 `sub`로 연결된 사람은 이메일 확인 여부와 상관없이 로그인합니다.
Pagehouse와 계정을 공유하면 SSO 설정도 하나입니다. IdP의 클라이언트 하나에 두 제품의 리다이렉트 URI와 로그아웃 후 이동 주소를 모두 등록하고, 두 제품의 `SECRET_KEY`를 같게 둡니다.
어느 제품에서든 SSO로 한 번 로그인하면 양쪽에 로그인되고, `OIDC_ADMIN_GROUP`은 두 제품의 관리자 여부를 함께 정합니다. `.env`의 `OIDC_*`는 제품마다 따로이므로 양쪽에 모두 넣거나 모두 비워 두세요.
`PASSWORD_LOGIN=0`(SSO 전용)이어도 비밀번호가 있는 관리자는 로그인 화면의 "관리자 비상 로그인"으로 들어올 수 있습니다.

Keycloak 26으로 확인했습니다. 로컬에서 직접 해 보려면 `scripts/keycloak-dev.sh`가 테스트용 Keycloak(realm·client·그룹 매퍼·테스트 사용자)을 띄웁니다.

## 개발

Node 22.18 이상(배포 이미지는 Node 26 LTS).

```sh
npm ci
npm run dev:db                  # Docker 없이 PostgreSQL 17 (포트 55432, .devdb)
DATABASE_URL=postgres://taskhouse:taskhouse@localhost:55432/taskhouse npm run dev
npm test                        # 임베디드 PostgreSQL로 통합 테스트
npm run typecheck && npm audit
# 이미지 검사: podman save -o app.tar localhost/taskhouse:latest && trivy image --input app.tar && grype docker-archive:app.tar
```

의존성은 최신 안정판만 쓰고 `npm audit`이 0건이어야 합니다. 이미지 빌드도 `npm audit --omit=dev`가 실패하면 멈춥니다.
