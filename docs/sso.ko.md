# SSO (OIDC) 안내

[English](sso.md)

Taskhouse는 OpenID Connect를 지원하는 IdP라면 어디로든 로그인할 수 있습니다. Keycloak 26으로 확인했습니다.

## 설정하기

1. IdP에 클라이언트를 만들고 다음을 등록합니다.
   - 리다이렉트 URI `$PUBLIC_URL/api/auth/oidc/callback`
   - 로그아웃 후 이동 주소 `$PUBLIC_URL/`
2. Taskhouse에서는 둘 중 하나로 설정합니다.
   - **관리 → SSO** 화면에 입력(클라이언트 비밀은 `SECRET_KEY`로 암호화해 저장)
   - `.env`에 `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`. 환경변수가 있으면 그쪽이 우선이고 화면은 읽기
     전용이 됩니다.

`PUBLIC_URL`은 사람들이 접속하는 주소로 설정되어 있어야 합니다.

## 계정 연결 방식

- 계정은 IdP의 `sub`로 찾습니다.
- 처음 로그인하면 같은 이메일의 기존 로컬 계정에 연결하거나 새 계정을 만듭니다(`OIDC_AUTO_CREATE=0`이면 만들지 않음).
  둘 다 IdP가 확인한 이메일(`email_verified`)일 때만 합니다.
- `email_verified`를 보내지 않는 IdP라면 `OIDC_TRUST_EMAIL=1`로 허용할 수 있습니다. IdP가 `false`라고 하면 여전히 거부합니다.
- 이미 `sub`로 연결된 사람은 이메일 클레임과 상관없이 로그인합니다.

## 그룹과 관리자

- 그룹은 로그인할 때마다 `groups` 클레임(`OIDC_GROUPS_CLAIM`)에서 가져옵니다. SSO 로그인은 자기가 넣은 구성원만
  넣고 빼며, 직접 넣은 구성원은 남습니다.
- `OIDC_ADMIN_GROUP` 구성원은 사이트 관리자가 됩니다.
- 로그아웃하면 IdP 세션도 끝납니다.

## SSO만 쓰기

`PASSWORD_LOGIN=0`이면 로그인 화면에 SSO만 나옵니다. 비밀번호가 있는 관리자는 로그인 화면의 "관리자 비상 로그인"으로
여전히 들어올 수 있습니다.

## Pagehouse와 함께 쓸 때

Pagehouse와 계정을 공유하면([설치 안내](install.ko.md#pagehouse와-함께-쓰기)) SSO 설정도 하나입니다.

- IdP의 클라이언트 하나에 두 제품의 리다이렉트 URI와 로그아웃 후 이동 주소를 모두 등록합니다.
- 두 제품의 `SECRET_KEY`를 같게 둡니다.
- 어느 제품에서든 SSO로 한 번 로그인하면 양쪽에 로그인되고, `OIDC_ADMIN_GROUP`은 두 제품의 관리자 여부를 함께 정합니다.
- `.env`의 `OIDC_*`는 제품마다 따로이므로 양쪽에 모두 넣거나 모두 비워 두세요.

## 로컬에서 해 보기

`scripts/keycloak-dev.sh`가 테스트용 Keycloak(realm, client, 그룹 매퍼, 테스트 사용자)을 띄웁니다.
