<div align="center">

<img src="docs/images/logo.svg" width="72" height="72" alt="Taskhouse 로고">

# Taskhouse

**소규모 조직과 팀이 자기 서버에 설치해 쓰는 온프레미스 이슈 트래커.**<br>
백로그, 스프린트, 보드를 사내망 안에서 한곳에.<br>
Jira를 대신할 오픈소스 셀프호스팅 도구이자 [Pagehouse](https://github.com/spro1/pagehouse)(위키)의 짝 제품입니다.

[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![CI](https://github.com/spro1/taskhouse/actions/workflows/ci.yml/badge.svg)](https://github.com/spro1/taskhouse/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/spro1/taskhouse?include_prereleases&sort=semver)](https://github.com/spro1/taskhouse/releases)
![Docker | Podman](https://img.shields.io/badge/runs%20on-Docker%20%7C%20Podman-2f6feb)
![Air-gapped](https://img.shields.io/badge/air--gapped-supported-2f6feb)

[맞는지 보기](#우리-조직에-맞을까) · [설치](#설치) · [첫날 할 일](#첫날-할-일) · [운영](#운영) · [FAQ](#faq) · [English](README.md)

<img src="docs/images/screenshot-board.png" alt="할 일, 진행 중, 리뷰 중, 완료 열이 있는 Taskhouse 스프린트 보드" width="100%">

</div>

## 누구를 위한 것인가

- 호스팅 트래커 비용이 부담되거나, 갱신 때마다 사용자 수를 세기 지친 **5~100명 규모의 회사와 팀**
- 보안 정책, 고객 요구, 폐쇄망 때문에 **업무 데이터를 남의 서버에 둘 수 없는** 조직
- **전담 운영 인력이 없어** 서버 한 대에 올려 두고 신경 쓰지 않고 싶은 팀

## 우리 조직에 맞을까

| | Taskhouse |
|---|---|
| **데이터 위치** | 전부 내 서버(PostgreSQL과 파일 볼륨). 외부 폰트·CDN·사용 통계 없음. 밖으로 나가는 요청은 직접 켠 것(SSO, 메일, 웹훅)뿐 |
| **인터넷 없이** | 이미지가 든 오프라인 번들로 설치와 업그레이드 |
| **비용** | Apache-2.0 오픈소스, 사용자 수 제한 없음 |
| **필요한 것** | Docker 또는 Podman이 있는 Linux 서버 한 대 |
| **구성 요소** | 앱, PostgreSQL, 백업 작업. 컨테이너 셋, 외부 서비스 없음 |
| **데이터 안전** | 매일 자동 백업(첨부는 하드링크라 새 파일만 늘어남), 업그레이드·복원 전 자동 백업 |
| **떠날 때** | 프로젝트 전체를 JSON으로(설명·댓글·링크·이력 포함), 이슈 목록을 CSV로 내보내기 |
| **로그인** | 초대 링크로 만드는 로컬 계정, 또는 OpenID Connect SSO(Keycloak으로 확인, IdP 그룹과 관리자 반영) |
| **위키와 함께** | 같은 데이터베이스를 쓰면 [Pagehouse](https://github.com/spro1/pagehouse)와 사용자·로그인·그룹·SSO를 공유 |

## 기능

| | |
|---|---|
| 📋 **이슈** | 에픽·스토리·작업·버그·하위 작업(계층 검사), 서식 있는 설명과 댓글·`@`멘션, 연결(차단·관련), 첨부, 지켜보기, 전체 변경 이력. 두 사람이 다른 필드를 고치면 서로 덮어쓰지 않음 |
| 🏃 **스크럼** | 끌어서 순서를 바꾸는 백로그, 스프린트(완료하면 남은 이슈를 옮김), 카드를 끌면 상태가 바뀌는 보드. 검색·담당자·내 이슈만 빠른 필터 |
| 🔀 **워크플로** | 기본은 자유 이동. 상태와 전이마다 누가 쓸 수 있는지, 조건(열린 차단 이슈 없음, 하위 작업 완료, 필수 필드), 이동 후 처리. 보드에 보일 상태 선택 |
| 👆 **빠른 사용** | 이슈를 누르면 오른쪽 패널에 열림, 어디서나 `C`로 이슈 만들기, ⌘K로 키 이동과 검색, 상위 이슈와 연결은 키나 제목으로 검색해 선택. 다른 사람의 변경이 바로 보임 |
| 🔎 **검색** | TQL(JQL 부분집합, `CHANGED`·`linked`·`membersOf()` 등)과 필터 칩이 같은 엔진, 저장된 필터. 한국어 조사 처리, 2글자 단어도 인덱스 사용. 볼 수 없는 이슈는 나오지 않음 |
| 🔒 **권한** | 사람이나 그룹에 주는 프로젝트 역할 4종(열람자·보고자·멤버·관리자), 공개 범위 3종. 권한 밖 이슈는 모든 경로에서 404 |
| 🔔 **알림** | 앱 내 알림, 메일 묶음(SMTP), 서명·재시도하는 웹훅, Slack·Mattermost·Teams. 볼 권한이 있는 사람에게만 |
| 🤖 **AI 에이전트** | 내장 MCP 서버: 개인 API 토큰으로 이슈 검색·조회·생성·수정·상태 이동·댓글. 권한은 토큰 주인과 같음 |
| 📊 **관리** | 초대, 비활성화, 관리자 지정, 재설정 링크와 임시 비밀번호, 화면에서 SSO 설정, 모니터링(요청·오류·DB·백업·저장 공간)과 Prometheus 지표, 감사 로그 |
| 🌐 **화면** | 한국어·영어, 밝게·어둡게 테마, 프로필 사진(계정마다 저장). Pagehouse와 같은 모양과 사이드바 |

<table>
  <tr>
    <td width="50%"><img src="docs/images/screenshot-panel.png" alt="이슈를 오른쪽 패널에 연 백로그"></td>
    <td width="50%"><img src="docs/images/screenshot-dark.png" alt="어둡게 테마의 보드"></td>
  </tr>
  <tr>
    <td align="center"><sub>백로그와 이슈 패널</sub></td>
    <td align="center"><sub>어둡게 테마</sub></td>
  </tr>
</table>

## 설치

Linux(amd64 또는 arm64)에 Docker 24+ 또는 Podman 4+가 필요합니다.

**릴리스 번들로**(인터넷 없이도 됨). [릴리스](https://github.com/spro1/taskhouse/releases)에서
`taskhouse-<버전>-amd64.tar.gz`(또는 `-arm64`)와 `SHA256SUMS`를 받아 서버로 옮긴 뒤:

```sh
sha256sum -c SHA256SUMS --ignore-missing
tar xzf taskhouse-<버전>-amd64.tar.gz && cd taskhouse-<버전>
scripts/install.sh images.tar
```

**소스에서:**

```sh
git clone https://github.com/spro1/taskhouse.git && cd taskhouse
scripts/install.sh
```

설치 스크립트는 무작위 DB 비밀번호와 `SECRET_KEY`를 넣은 `.env`(권한 600)를 만들고, 모두 띄운 뒤 정상이 될 때까지
기다렸다가 1회용 설정 토큰을 출력합니다. 같은 서버에 Pagehouse가 이미 있다면 `--share-with /opt/pagehouse`를 붙여
계정을 공유할 수 있습니다. 자세한 내용은 [설치 안내](docs/install.ko.md)에 있습니다.

## 첫날 할 일

1. **관리자.** `http://<서버>:3000`을 열고 설치 때 출력된 설정 토큰(`docker compose logs app`에도 있음)으로 첫 계정을
   만듭니다. 이 계정이 관리자가 됩니다.
2. **HTTPS.** 리버스 프록시 뒤에 두고 `.env`에 `PUBLIC_URL`, `BIND_ADDRESS=127.0.0.1`, `TRUST_PROXY=1`을 넣습니다.
   [예시](docs/install.ko.md#https)를 보세요.
3. **팀 초대.** **관리 → 사람과 SSO**에서 초대 링크를 만들어 메신저로 보냅니다. 메일 서버가 없어도 됩니다.
4. **프로젝트.** 팀이나 제품마다 하나씩 만듭니다. 만든 사람이 관리자입니다. 프로젝트 **설정**에서 사람이나 그룹을
   추가하고, 기본 상태(할 일, 진행 중, 리뷰 중, 완료)가 맞지 않으면 고칩니다.
5. **백업.** `backups/`가 매일 쌓이는지 확인하고, `.env`와 함께 서버 밖으로 복사해 둡니다.
6. **메일(선택).** `.env`에 `SMTP_URL`을 넣으면 알림 메일과 "비밀번호를 잊으셨나요?" 링크가 동작합니다. 없으면
   **관리 → 사람과 SSO**에서 관리자가 재설정 링크나 임시 비밀번호를 발급합니다.
7. **SSO(선택).** [SSO 안내](docs/sso.ko.md)를 보세요.

## 운영

| 작업 | 방법 |
|---|---|
| 백업 | 24시간마다 `backups/`에 자동(14개 보관). 수동: `scripts/backup.sh` |
| 복원 | `scripts/restore.sh <백업>`. 현재 상태를 먼저 백업합니다 |
| 업그레이드 | [버전별 안내](docs/upgrading.ko.md)를 읽고, 새 파일을 설치 폴더에 덮어쓴 뒤 `scripts/upgrade.sh`(번들이면 `images.tar`). 먼저 백업하고 `.env`와 데이터는 그대로 둡니다 |
| 상태 | `curl localhost:3000/healthz`. **관리 → 모니터링**에서 요청·오류·DB·백업·저장 공간. `METRICS_TOKEN`을 넣으면 `/metrics`로 Prometheus 수집 |
| 로그 | `docker compose logs app` |

데이터는 compose 볼륨(데이터베이스와 첨부)에, 백업은 설치 폴더의 `backups/`에 있습니다.

## 보안

- **내가 켜지 않으면 밖으로 나가는 것이 없습니다.** 사용 통계도 외부에서 불러오는 자원도 없습니다. 밖으로 나가는
  요청은 직접 설정한 SSO, 메일, 웹훅뿐이고, 웹훅은 루프백·링크로컬 주소로 보내지 않습니다.
- **권한은 서버에서 검사합니다.** 볼 수 없는 이슈는 API, 검색, 첨부, 알림, MCP 어디서든 404입니다.
- **브라우저 보호:** 엄격한 Content-Security-Policy와 프레임 차단, 다른 사이트에서 온 변경 요청 거부, 요청 크기 제한,
  주소·계정별 로그인 시도 제한. 저장된 서식 문서는 HTML 문자열이 아니라 React 요소로만 그립니다.
- **계정:** SSO는 IdP가 확인한 이메일로만 계정을 연결하거나 만듭니다. DB에 저장하는 비밀값(웹훅 키, SSO 클라이언트
  비밀)은 `SECRET_KEY`로 암호화합니다. API 토큰은 만료가 있고 계정을 비활성화하면 폐기됩니다.
- **컨테이너:** root가 아닌 사용자로 실행, 앱 이미지에 패키지 관리자와 셸 없음, 고칠 수 있는 CVE가 있으면 CI 실패
  (Trivy), Dependabot이 매주 업데이트 PR을 엽니다.

취약점은 [SECURITY.md](SECURITY.md)의 방법으로 비공개 제보해 주세요.

## FAQ

**인터넷이 필요한가요?**
아니요. 설치(릴리스 번들), 사용, 업그레이드 모두 인터넷 없이 됩니다.

**Pagehouse와 계정을 같이 쓸 수 있나요?**
네. 같은 PostgreSQL 데이터베이스를 쓰면 사용자·로그인·그룹·SSO 설정을 공유하고 서로 메뉴로 오갑니다. 역할과 권한은
제품마다 따로입니다. [Pagehouse와 함께 쓰기](docs/install.ko.md#pagehouse와-함께-쓰기)를 보세요.

**AI 에이전트가 이슈를 다룰 수 있나요?**
네. 개인 API 토큰으로 `/api/mcp`(MCP)에 연결합니다. **내 설정 → API 토큰**에 Claude Code용 명령이 나옵니다.
[AI 에이전트](docs/install.ko.md#ai-에이전트-mcp)를 보세요.

**Jira에서 옮겨 올 수 있나요?**
아직 Jira 가져오기는 없습니다. REST API나 MCP로 이슈를 만들 수 있습니다.

**서버가 죽으면요?**
매일 백업이 `backups/`에 쌓입니다. 이 폴더와 `.env`를 서버 밖에 복사해 두면 새 서버에 설치한 뒤
`scripts/restore.sh`로 되살릴 수 있습니다.

## 로드맵

- Git·CI 연동
- 버전과 릴리스
- 차트(번다운, 속도)
- 사용자 정의 필드와 자동화 규칙
- 타임라인
- 이슈별 열람 제한

## 문서

- [설치 안내](docs/install.ko.md): 설치 방법, HTTPS, 백업, Pagehouse와 함께 쓰기, 모니터링, MCP, 이미지
- [업그레이드 안내](docs/upgrading.ko.md): 버전마다 바뀐 것과 할 일
- [SSO 안내](docs/sso.ko.md): OpenID Connect 설정, 계정 연결, 그룹과 관리자
- [기여 방법](CONTRIBUTING.md) · [보안 정책](SECURITY.md)

## 개발

Node 22.18 이상(배포 이미지는 Node 26 LTS).

```sh
npm ci
npm run dev:db                  # Docker 없이 PostgreSQL 17 (포트 55432, .devdb)
DATABASE_URL=postgres://taskhouse:taskhouse@localhost:55432/taskhouse npm run dev
npm test                        # 임베디드 PostgreSQL로 통합 테스트
npm run typecheck && npm audit
```

구성:

- `server/`: API, 검색(TQL), 백그라운드 작업, 마이그레이션
- `web/`: React + Tiptap, 화면 문구는 `web/i18n.ts`
- `scripts/`: 설치, 업그레이드, 백업, 복원, 오프라인 번들
- `docker/postgres/`: 보안 강화 PostgreSQL 이미지

의존성은 최신 안정판만 쓰고 `npm audit`이 0건이어야 합니다. 공유 계정 테이블을 바꾸는 마이그레이션은
`ADD COLUMN IF NOT EXISTS`로 쓰고, Pagehouse에도 같은 변경을 넣습니다.

## 라이선스

[Apache-2.0](LICENSE): 사내 사용, 수정, 재배포가 자유롭습니다.

Jira는 Atlassian의 상표입니다. Taskhouse는 Atlassian과 관계가 없고 Atlassian의 보증을 받지 않았습니다.
