# Taskhouse

소규모 조직(5~100명)이 자기 서버에 설치해 쓰는 경량 이슈 트래커입니다. 앱 하나와 PostgreSQL 하나로 동작합니다.
Apache-2.0 라이선스의 오픈소스입니다. 보안 문제는 [SECURITY.md](SECURITY.md)의 방법으로 비공개 제보해 주세요.

## 지금 들어 있는 것 (0·1단계 + TQL)

- 첫 실행 설정 토큰(서버 로그에 출력), 초대 링크 계정, 비밀번호 로그인(10회 실패 시 15분 잠금), OIDC SSO(PKCE, nonce, 그룹 동기화, 관리자 그룹)
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
- 관리 화면(초대, 비활성화, 관리자 지정, 비밀번호 재설정 링크, 감사 로그), 내 설정(비밀번호 변경, 알림 메일, API 토큰)
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

`.env`에 `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`을 넣고, IdP에는 리다이렉트 URI `$PUBLIC_URL/api/auth/oidc/callback`과
로그아웃 후 이동 주소 `$PUBLIC_URL/`을 등록합니다. 그룹은 `groups` 클레임(`OIDC_GROUPS_CLAIM`)에서 로그인할 때마다 가져오고,
`OIDC_ADMIN_GROUP` 구성원은 사이트 관리자가 됩니다. 로그아웃하면 IdP 세션도 끝납니다.
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
