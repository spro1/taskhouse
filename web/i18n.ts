// UI strings. Korean is the default; English is picked on the sign-in screen or in My settings (and kept per account).
// To add a language: copy `en`, translate the values, add it to LANGS. The type makes every language define every key.

const ko = {
  'common.add': '추가', 'common.cancel': '취소', 'common.create': '만들기', 'common.delete': '삭제', 'common.empty': '없음', 'common.more': '더 보기',
  'common.none': '없습니다.', 'common.save': '저장', 'common.saved': '저장했습니다.', 'common.system': '시스템',

  'auth.name': '이름', 'auth.email': '이메일', 'auth.password': '비밀번호 (8자 이상)', 'auth.password.title': '비밀번호', 'auth.login': '로그인',
  'auth.sso': '{name}로 로그인', 'auth.breakGlass': '관리자 비상 로그인 (SSO 장애 시)', 'auth.newPassword': '새 비밀번호 (8자 이상)', 'auth.setPassword': '비밀번호 바꾸기',
  'setup.sub': '처음 실행입니다. 서버 로그에 나온 설정 토큰으로 관리자 계정을 만드세요.', 'setup.token': '설정 토큰', 'setup.submit': '관리자 계정 만들기',
  'invite.submit': '계정 만들기', 'reset.sub': '새 비밀번호를 정하세요. 다른 기기의 로그인은 끊깁니다.',
  'link.invalid': '링크가 만료되었거나 이미 사용되었습니다. 관리자에게 새 링크를 요청하세요.',
  'forgot.link': '비밀번호를 잊으셨나요?', 'forgot.title': '비밀번호 재설정', 'forgot.sub': '계정의 이메일을 입력하세요. 계정이 있으면 1시간 동안 쓸 수 있는 재설정 링크를 보냅니다.',
  'forgot.send': '재설정 링크 보내기', 'forgot.sent': '계정이 있는 주소라면 메일을 보냈습니다. 받은편지함(과 스팸함)을 확인하세요.', 'forgot.back': '로그인으로 돌아가기',
  'forgot.askAdmin': '비밀번호를 잊으셨다면 관리자에게 재설정 링크를 요청하세요.',
  'temp.title': '비밀번호를 새로 정하세요', 'temp.sub': '{name}님은 관리자가 발급한 임시 비밀번호로 로그인했습니다. 계속하려면 직접 비밀번호를 정하세요.', 'temp.current': '임시 비밀번호',
  'sso.err.unavailable': 'SSO 서버에 연결할 수 없습니다. 잠시 뒤에 다시 시도하거나 관리자에게 알려 주세요.', 'sso.err.account_disabled': '비활성화된 계정입니다. 관리자에게 문의하세요.',
  'sso.err.email_taken': '같은 이메일의 계정이 이미 있는데, SSO에서 이메일이 확인되지 않아 연결하지 않았습니다. 관리자에게 문의하세요.',
  'sso.err.no_email': 'SSO 계정에 이메일이 없어 계정을 만들 수 없습니다.', 'sso.err.no_account': '아직 계정이 없습니다. 관리자에게 초대를 요청하세요.', 'sso.err.failed': 'SSO 로그인에 실패했습니다. 다시 시도해 주세요.',

  'nav.quick': '검색 또는 이슈 키', 'nav.search': '고급 검색', 'nav.notifications': '알림', 'nav.admin': '관리', 'nav.logout': '로그아웃',
  'home.projects': '프로젝트', 'home.noProjects': '아직 프로젝트가 없습니다.', 'home.key': '키 (예: DEMO)', 'home.newProject': '새 프로젝트', 'home.mine': '{name}님의 미완료 이슈',
  'vis.private': '비공개', 'vis.view': '모두 보기', 'vis.edit': '모두 편집',
  'vis.private.long': '비공개 (역할이 있는 사람만)', 'vis.view.long': '모두 보기 (로그인한 모두가 열람)', 'vis.edit.long': '모두 편집 (로그인한 모두가 멤버)',
  'role.viewer': '열람자', 'role.reporter': '보고자', 'role.member': '멤버', 'role.admin': '관리자',
  'project.notFound': '프로젝트를 찾을 수 없습니다.', 'project.board': '보드', 'project.backlog': '백로그', 'project.settings': '설정',
  'quick.placeholder': '이슈 키(DEMO-12) 또는 제목·본문',
  'notes.none': '알림이 없습니다.', 'notes.created': '{actor}님이 {key} 이슈를 만들었습니다', 'notes.updated': '{actor}님이 {key} 이슈를 바꿨습니다',
  'notes.transitioned': '{actor}님이 {key} 상태를 바꿨습니다', 'notes.commented': '{actor}님이 {key}에 댓글을 남겼습니다',
  'priority.0': '긴급', 'priority.1': '높음', 'priority.2': '보통', 'priority.3': '낮음', 'priority.4': '최저',
  'category.0': '할 일', 'category.1': '진행', 'category.2': '완료',

  'board.until': '{date}까지', 'board.noSprint': '진행 중인 스프린트가 없어 열린 이슈 전체(최근 14일 완료 포함)를 보여 줍니다.',
  'backlog.count': '{n}건 · {points}점', 'backlog.newIssue': '새 이슈 제목 입력 후 Enter',
  'sprint.start': '스프린트 시작', 'sprint.complete': '스프린트 완료', 'sprint.create': '스프린트 만들기', 'sprint.active': '진행 중',
  'sprint.completed': '스프린트를 완료했습니다. 미완료 {n}건을 {to}로 옮겼습니다.',

  'field.type': '유형', 'field.status': '상태', 'field.priority': '우선순위', 'field.assignee': '담당자', 'field.description': '설명', 'field.parent': '상위',
  'field.sprint': '스프린트', 'field.points': '포인트', 'field.due': '기한', 'field.labels': '라벨', 'field.links': '링크', 'field.attachments': '첨부',
  'col.key': '이슈 키', 'col.title': '제목', 'col.updated': '변경',
  'issue.notFound': '이슈를 찾을 수 없거나 볼 권한이 없습니다.', 'issue.addDescription': '설명 추가…', 'issue.noDescription': '설명 없음',
  'issue.epicChildren': '에픽의 이슈', 'issue.subtasks': '하위 작업', 'issue.comments': '댓글 {n}', 'issue.history': '변경 이력 {n}',
  'issue.comment': '댓글', 'issue.addComment': '댓글 달기', 'issue.assignMe': '나에게 할당', 'issue.labelsHint': '쉼표로 구분', 'issue.epicNoParent': '에픽은 상위가 없습니다',
  'issue.reporter': '보고자', 'issue.created': '생성', 'issue.updated': '변경', 'issue.resolved': '해결', 'issue.watch': '지켜보기', 'issue.unwatch': '지켜보기 중지',
  'issue.deleteConfirm': '{key}를 삭제할까요? 프로젝트 관리자가 복원할 수 있습니다.', 'issue.addChild': '{type} 추가', 'issue.child': '하위 이슈',
  'history.created': '생성', 'history.deleted': '삭제', 'history.restored': '복원', 'history.docChanged': '설명 변경',
  'link.blocks': '차단함', 'link.blockedBy': '차단됨', 'link.relates': '관련', 'link.duplicates': '중복함', 'link.duplicatedBy': '중복됨', 'link.add': '링크',
  'editor.content': '내용', 'editor.toolbar': '서식', 'editor.hint': '@로 사람 멘션 · ⌘Enter로 {action}',

  'search.filterName': '필터 이름', 'search.saved': '저장된 필터', 'search.deleteFilter': '필터 삭제', 'search.examples': '예시', 'search.run': '검색',
  'search.save': '필터로 저장', 'search.count': '{n}건', 'search.countMore': '{n}건 이상',

  'settings.visibility': '공개 범위', 'export.title': '내보내기', 'export.sub': '이슈, 설명, 댓글, 링크, 변경 이력, 스프린트를 담습니다. 첨부 파일 자체는 백업에 들어 있습니다.',
  'export.json': 'JSON (전체)', 'export.csv': 'CSV (이슈 목록)',
  'roles.title': '역할', 'roles.group': '그룹: {name}', 'roles.pick': '사람 또는 그룹 추가…', 'roles.save': '역할 저장',
  'rule.assignee': '담당자만', 'rule.reporter': '보고자만', 'rule.admin': '프로젝트 관리자만', 'rule.needPoints': '포인트 필수', 'rule.needAssignee': '담당자 필수',
  'rule.needDue': '기한 필수', 'rule.subtasksDone': '하위 작업 모두 완료', 'rule.noBlockers': '차단 이슈 없음', 'rule.toReporter': '보고자에게 할당', 'rule.toMe': '나에게 할당',
  'rule.unassign': '담당자 비우기', 'rule.who': '누가', 'rule.when': '조건', 'rule.after': '이동 후',
  'workflow.statuses': '상태', 'workflow.statuses.sub': '보드의 열 순서입니다. 차트와 스프린트 완료 판정은 이름이 아니라 범주를 봅니다.',
  'workflow.statusName': '상태 이름', 'workflow.category': '범주', 'workflow.up': '위로', 'workflow.addStatus': '상태 추가', 'workflow.transitions': '전이 규칙',
  'workflow.onlyListed': '아래에 적은 이동만 허용합니다.', 'workflow.free': '규칙이 없으면 어느 상태로든 이동할 수 있습니다. 규칙을 하나라도 추가하면 적은 이동만 허용합니다.',
  'workflow.moveName': '이름 (비우면 도착 상태 이름)', 'workflow.from': '출발 상태', 'workflow.fromAny': '어느 상태에서든', 'workflow.to': '도착 상태',
  'workflow.deleteMove': '전이 삭제', 'workflow.addMove': '전이 추가', 'workflow.save': '워크플로 저장',
  'hooks.title': '웹훅과 메신저', 'hooks.chat': '메신저', 'hooks.failed': '실패: {error}', 'hooks.ok': '정상', 'hooks.secret': '서명 비밀값 (한 번만 표시됩니다)', 'hooks.json': 'JSON (서명)',

  'me.title': '내 설정', 'me.language': '언어', 'me.mail': '알림 메일', 'me.mailOff': '이 서버에는 메일 발송(SMTP)이 설정되어 있지 않습니다.',
  'me.mailDigest': '읽지 않은 알림을 메일로 묶어 받기 (마지막 알림 후 5분, 최대 30분 뒤)', 'me.passwordMismatch': '새 비밀번호가 서로 다릅니다.',
  'me.passwordChanged': '비밀번호를 바꿨습니다. 다른 기기의 로그인은 끊겼습니다.', 'me.currentPassword': '현재 비밀번호', 'me.confirmPassword': '새 비밀번호 확인',
  'me.change': '바꾸기', 'me.set': '설정하기',
  'tokens.title': '내 API 토큰', 'tokens.sub': '스크립트와 AI 에이전트가 내 권한으로 API를 씁니다. 90일 뒤 만료됩니다.', 'tokens.once': '새 토큰 (지금만 보입니다):',
  'tokens.expires': '{date} 만료', 'tokens.revoke': '폐기', 'tokens.name': '토큰 이름',

  'admin.only': '사이트 관리자만 볼 수 있습니다.', 'admin.people': '사람', 'admin.inviteEmail': '초대할 이메일', 'admin.invite': '초대 링크 만들기',
  'admin.inviteLink': '{email} 초대 링크 (7일, 1회용)', 'admin.signIn': '로그인', 'admin.lastLogin': '마지막 로그인', 'admin.isAdmin': '관리자', 'admin.isAdminOf': '{name} 관리자',
  'admin.reset': '재설정 링크', 'admin.resetLink': '{name} 비밀번호 재설정 링크 (24시간, 1회용)', 'admin.temp': '임시 비밀번호',
  'admin.temp.confirm': '{name}님에게 임시 비밀번호를 발급할까요? 지금 비밀번호는 더 이상 쓸 수 없고 모든 기기에서 로그아웃됩니다. 다음 로그인 때 직접 비밀번호를 정해야 합니다.',
  'admin.temp.label': '{name} 임시 비밀번호 (한 번만 표시)', 'admin.enable': '다시 활성화', 'admin.disable': '비활성화', 'admin.disableNote': '비활성화하면 모든 세션과 API 토큰이 즉시 끊깁니다.',
  'audit.title': '감사 로그', 'audit.when': '시각', 'audit.who': '누가', 'audit.what': '무엇', 'audit.target': '대상', 'audit.result': '결과', 'audit.ok': '성공', 'audit.failed': '실패',
  'audit.auth.login': '로그인', 'audit.auth.sso': 'SSO 로그인', 'audit.auth.setup': '초기 설정', 'audit.auth.reset': '비밀번호 재설정', 'audit.auth.forgot': '비밀번호 찾기 요청',
  'audit.user.password': '비밀번호 변경', 'audit.user.update': '사용자 변경', 'audit.user.invite': '초대', 'audit.user.reset_link': '재설정 링크 발급',
  'audit.user.temp_password': '임시 비밀번호 발급', 'audit.group.update': '그룹 변경', 'audit.token.create': 'API 토큰 발급', 'audit.token.revoke': 'API 토큰 폐기',
  'audit.project.create': '프로젝트 생성', 'audit.project.update': '프로젝트 변경', 'audit.project.roles': '역할 변경', 'audit.project.workflow': '워크플로 변경',
  'audit.project.export': '내보내기', 'audit.webhook.create': '웹훅 추가', 'audit.webhook.delete': '웹훅 삭제', 'audit.issue.delete': '이슈 삭제',
  'audit.issue.restore': '이슈 복원', 'audit.issue.bulk': '일괄 수정', 'audit.settings.sso': 'SSO 설정 변경',

  'sso.title': 'SSO (OpenID Connect)', 'sso.on': '켜짐', 'sso.off': '꺼짐',
  'sso.env': '서버의 환경변수(OIDC_ISSUER 등)로 설정되어 있어 여기서는 바꿀 수 없습니다. 이 화면에서 관리하려면 .env에서 지우고 재시작하세요.',
  'sso.redirect': '리다이렉트 URI (IdP에 등록)', 'sso.redirect.hint': '로그아웃 후 이동 주소로 이 서버 주소(/로 끝남)도 등록하세요. 그래야 로그아웃 때 SSO 세션도 끝납니다. 다른 주소로 접속한다면 서버에 PUBLIC_URL을 설정하세요.',
  'sso.issuer': 'Issuer URL', 'sso.test': '연결 확인', 'sso.test.ok': '연결됨: {issuer}', 'sso.test.fail': '연결할 수 없습니다: {error}', 'sso.clientId': '클라이언트 ID',
  'sso.secret': '클라이언트 비밀', 'sso.secret.kept': '저장됨 — 비워 두면 그대로 둡니다',
  'sso.plain': '서버에 SECRET_KEY가 없어 클라이언트 비밀이 암호화되지 않은 채 DB(와 백업)에 저장됩니다. .env에 SECRET_KEY를 넣고 재시작하면 자동으로 암호화됩니다.',
  'sso.label': '버튼 문구', 'sso.groupsClaim': '그룹 클레임 이름', 'sso.adminGroup': '사이트 관리자 그룹', 'sso.passwordLogin': '비밀번호 로그인 허용',
  'sso.passwordLogin.hint': '끄면 관리자를 제외한 모두가 SSO로만 로그인합니다(관리자는 IdP 장애 때 비상 로그인으로 들어올 수 있습니다).',
  'sso.autoCreate': '처음 SSO로 로그인할 때 계정 만들기', 'sso.autoCreate.hint': '끄면 이미 계정이 있는 사람(같은 이메일의 계정 포함)만 로그인할 수 있습니다.',
  'sso.trustEmail': 'IdP가 확인 표시를 하지 않은 이메일도 믿기',
  'sso.trustEmail.hint': '같은 이메일의 기존 계정에 연결할 때만 쓰입니다. email_verified를 아예 보내지 않는 IdP(일부 Entra ID 설정)에서, 사용자가 IdP에서 자기 이메일을 바꿀 수 없을 때만 켜세요.',
  'sso.enable': 'SSO 켜기', 'sso.disable': '끄기', 'sso.saved.on': 'SSO를 켰습니다.', 'sso.saved.off': 'SSO를 껐습니다.',

  'err.bad_credentials': '이메일 또는 비밀번호가 맞지 않습니다.', 'err.too_many_attempts': '시도가 너무 많습니다. 15분 뒤에 다시 해 주세요.',
  'err.sso_only': '이 서버는 SSO로만 로그인할 수 있습니다.', 'err.bad_setup_token': '설정 토큰이 맞지 않습니다. 서버 로그에서 확인하세요.',
  'err.already_set_up': '이미 설정이 끝났습니다.', 'err.login_required': '로그인이 필요합니다.', 'err.bad_request': '요청이 올바르지 않습니다.',
  'err.transition_not_allowed': '워크플로에서 허용하지 않는 이동입니다.', 'err.validation_failed': '전이 조건을 만족하지 않습니다.',
  'err.conflict': '다른 사람이 먼저 이 값을 바꿨습니다. 최신 값을 불러왔습니다.',
  'err.bad_hierarchy': '계층이 맞지 않습니다. 하위 작업은 표준 이슈 아래, 표준 이슈는 에픽 아래에만 둘 수 있습니다.',
  'err.bad_field': '입력값이 올바르지 않습니다.', 'err.forbidden': '권한이 없습니다.', 'err.not_found': '찾을 수 없습니다.', 'err.key_taken': '이미 쓰는 프로젝트 키입니다.',
  'err.sprint_already_active': '이미 진행 중인 스프린트가 있습니다.', 'err.status_in_use': '이슈가 쓰고 있는 상태는 삭제할 수 없습니다.',
  'err.bad_query': '검색 조건이 올바르지 않습니다.', 'err.file_too_large': '파일이 너무 큽니다.', 'err.too_large': '보낸 내용이 너무 큽니다.',
  'err.storage_full': '첨부 저장 공간이 가득 찼습니다. 관리자에게 문의하세요.', 'err.cross_site': '다른 사이트에서 온 요청이라 거부했습니다.',
  'err.admin_only': '사이트 관리자만 할 수 있습니다.', 'err.reset_invalid': '링크가 만료되었거나 이미 사용되었습니다.', 'err.invite_invalid': '링크가 만료되었거나 이미 사용되었습니다.',
  'err.email_taken': '이미 같은 이메일의 계정이 있습니다.', 'err.not_yourself': '자기 자신에게는 할 수 없습니다.', 'err.keep_yourself_admin': '자신의 관리자 역할은 남겨 두어야 합니다.',
  'err.group_from_sso': 'SSO에서 오는 그룹은 여기서 바꿀 수 없습니다.', 'err.mail_off': '이 서버에는 메일 발송이 설정되어 있지 않습니다.',
  'err.sso_env': 'SSO가 환경변수로 설정되어 있어 바꿀 수 없습니다.', 'err.sso_issuer': 'Issuer는 http(s) 주소여야 합니다.',
  'err.sso_incomplete': 'SSO를 켜려면 Issuer와 클라이언트 ID가 필요합니다.', 'err.sso_discovery': 'Issuer에서 OpenID 설정을 받지 못했습니다. 주소를 확인하세요.',
  'err.internal': '서버 오류가 났습니다. 잠시 뒤에 다시 시도하세요.',
}

export type Key = keyof typeof ko
type Dict = Record<Key, string>

const en: Dict = {
  'common.add': 'Add', 'common.cancel': 'Cancel', 'common.create': 'Create', 'common.delete': 'Delete', 'common.empty': 'None', 'common.more': 'Load more',
  'common.none': 'Nothing here.', 'common.save': 'Save', 'common.saved': 'Saved.', 'common.system': 'System',

  'auth.name': 'Name', 'auth.email': 'Email', 'auth.password': 'Password (8+ characters)', 'auth.password.title': 'Password', 'auth.login': 'Sign in',
  'auth.sso': 'Sign in with {name}', 'auth.breakGlass': 'Admin emergency sign-in (SSO down)', 'auth.newPassword': 'New password (8+ characters)', 'auth.setPassword': 'Set password',
  'setup.sub': 'First run. Create the admin account with the setup token from the server log.', 'setup.token': 'Setup token', 'setup.submit': 'Create admin account',
  'invite.submit': 'Create account', 'reset.sub': 'Choose a new password. Other devices will be signed out.',
  'link.invalid': 'This link has expired or was already used. Ask an administrator for a new one.',
  'forgot.link': 'Forgot your password?', 'forgot.title': 'Reset your password', 'forgot.sub': "Enter your account's email. If it has an account, a reset link (valid for one hour) is on its way.",
  'forgot.send': 'Send reset link', 'forgot.sent': 'If that address has an account, the email is on its way. Check your inbox (and spam).', 'forgot.back': 'Back to sign in',
  'forgot.askAdmin': 'Forgot your password? Ask an administrator for a reset link.',
  'temp.title': 'Choose your own password', 'temp.sub': '{name}, you signed in with a temporary password from an administrator. Set your own to continue.', 'temp.current': 'Temporary password',
  'sso.err.unavailable': "The sign-on provider can't be reached. Try again shortly or tell an administrator.", 'sso.err.account_disabled': 'This account is disabled. Contact an administrator.',
  'sso.err.email_taken': "An account with this email already exists, and the sign-on provider didn't confirm the email, so they weren't linked. Contact an administrator.",
  'sso.err.no_email': "The sign-on account has no email, so no account can be created.", 'sso.err.no_account': "There is no account for you yet. Ask an administrator for an invite.", 'sso.err.failed': 'Single sign-on failed. Try again.',

  'nav.quick': 'Search or issue key', 'nav.search': 'Advanced search', 'nav.notifications': 'Notifications', 'nav.admin': 'Admin', 'nav.logout': 'Sign out',
  'home.projects': 'Projects', 'home.noProjects': 'No projects yet.', 'home.key': 'Key (e.g. DEMO)', 'home.newProject': 'New project', 'home.mine': 'Open issues for {name}',
  'vis.private': 'Private', 'vis.view': 'Everyone can view', 'vis.edit': 'Everyone can edit',
  'vis.private.long': 'Private (people with a role only)', 'vis.view.long': 'Everyone can view (all signed-in people)', 'vis.edit.long': 'Everyone can edit (all signed-in people are members)',
  'role.viewer': 'Viewer', 'role.reporter': 'Reporter', 'role.member': 'Member', 'role.admin': 'Admin',
  'project.notFound': 'Project not found.', 'project.board': 'Board', 'project.backlog': 'Backlog', 'project.settings': 'Settings',
  'quick.placeholder': 'Issue key (DEMO-12) or title / text',
  'notes.none': 'No notifications.', 'notes.created': '{actor} created {key}', 'notes.updated': '{actor} updated {key}',
  'notes.transitioned': '{actor} changed the status of {key}', 'notes.commented': '{actor} commented on {key}',
  'priority.0': 'Urgent', 'priority.1': 'High', 'priority.2': 'Medium', 'priority.3': 'Low', 'priority.4': 'Lowest',
  'category.0': 'To do', 'category.1': 'In progress', 'category.2': 'Done',

  'board.until': 'until {date}', 'board.noSprint': 'No active sprint, so this shows all open issues (and those done in the last 14 days).',
  'backlog.count': '{n} issues · {points} points', 'backlog.newIssue': 'New issue title, then Enter',
  'sprint.start': 'Start sprint', 'sprint.complete': 'Complete sprint', 'sprint.create': 'Create sprint', 'sprint.active': 'active',
  'sprint.completed': 'Sprint completed. {n} unfinished issues moved to {to}.',

  'field.type': 'Type', 'field.status': 'Status', 'field.priority': 'Priority', 'field.assignee': 'Assignee', 'field.description': 'Description', 'field.parent': 'Parent',
  'field.sprint': 'Sprint', 'field.points': 'Points', 'field.due': 'Due', 'field.labels': 'Labels', 'field.links': 'Links', 'field.attachments': 'Attachments',
  'col.key': 'Issue key', 'col.title': 'Title', 'col.updated': 'Updated',
  'issue.notFound': "Issue not found, or you can't see it.", 'issue.addDescription': 'Add a description…', 'issue.noDescription': 'No description',
  'issue.epicChildren': 'Issues in this epic', 'issue.subtasks': 'Subtasks', 'issue.comments': 'Comments {n}', 'issue.history': 'History {n}',
  'issue.comment': 'Comment', 'issue.addComment': 'Comment', 'issue.assignMe': 'Assign to me', 'issue.labelsHint': 'Comma-separated', 'issue.epicNoParent': 'Epics have no parent',
  'issue.reporter': 'Reporter', 'issue.created': 'Created', 'issue.updated': 'Updated', 'issue.resolved': 'Resolved', 'issue.watch': 'Watch', 'issue.unwatch': 'Stop watching',
  'issue.deleteConfirm': 'Delete {key}? A project admin can restore it.', 'issue.addChild': 'Add {type}', 'issue.child': 'child issue',
  'history.created': 'Created', 'history.deleted': 'Deleted', 'history.restored': 'Restored', 'history.docChanged': 'description changed',
  'link.blocks': 'blocks', 'link.blockedBy': 'is blocked by', 'link.relates': 'relates to', 'link.duplicates': 'duplicates', 'link.duplicatedBy': 'is duplicated by', 'link.add': 'Link',
  'editor.content': 'Content', 'editor.toolbar': 'Formatting', 'editor.hint': '@ to mention someone · ⌘Enter to {action}',

  'search.filterName': 'Filter name', 'search.saved': 'Saved filters', 'search.deleteFilter': 'Delete filter', 'search.examples': 'Examples', 'search.run': 'Search',
  'search.save': 'Save as filter', 'search.count': '{n} issues', 'search.countMore': 'More than {n} issues',

  'settings.visibility': 'Visibility', 'export.title': 'Export', 'export.sub': 'Issues, descriptions, comments, links, history and sprints. Attachment files themselves are in the backups.',
  'export.json': 'JSON (everything)', 'export.csv': 'CSV (issue list)',
  'roles.title': 'Roles', 'roles.group': 'Group: {name}', 'roles.pick': 'Add a person or group…', 'roles.save': 'Save roles',
  'rule.assignee': 'Assignee only', 'rule.reporter': 'Reporter only', 'rule.admin': 'Project admins only', 'rule.needPoints': 'Points required', 'rule.needAssignee': 'Assignee required',
  'rule.needDue': 'Due date required', 'rule.subtasksDone': 'All subtasks done', 'rule.noBlockers': 'No open blockers', 'rule.toReporter': 'Assign to reporter', 'rule.toMe': 'Assign to me',
  'rule.unassign': 'Unassign', 'rule.who': 'Who', 'rule.when': 'When', 'rule.after': 'Then',
  'workflow.statuses': 'Statuses', 'workflow.statuses.sub': 'The board columns, in order. Charts and sprint completion look at the category, not the name.',
  'workflow.statusName': 'Status name', 'workflow.category': 'Category', 'workflow.up': 'Move up', 'workflow.addStatus': 'Add status', 'workflow.transitions': 'Transitions',
  'workflow.onlyListed': 'Only the moves listed below are allowed.', 'workflow.free': 'With no transitions, any move is allowed. Add one and only the listed moves are.',
  'workflow.moveName': 'Name (empty = target status name)', 'workflow.from': 'From status', 'workflow.fromAny': 'From any status', 'workflow.to': 'To status',
  'workflow.deleteMove': 'Delete transition', 'workflow.addMove': 'Add transition', 'workflow.save': 'Save workflow',
  'hooks.title': 'Webhooks and chat', 'hooks.chat': 'Chat', 'hooks.failed': 'Failed: {error}', 'hooks.ok': 'OK', 'hooks.secret': 'Signing secret (shown once)', 'hooks.json': 'JSON (signed)',

  'me.title': 'My settings', 'me.language': 'Language', 'me.mail': 'Email notifications', 'me.mailOff': "This server doesn't have email (SMTP) set up.",
  'me.mailDigest': 'Email me unread notifications in a digest (5 minutes after the last one, at most 30)', 'me.passwordMismatch': "The new passwords don't match.",
  'me.passwordChanged': 'Password changed. Other devices were signed out.', 'me.currentPassword': 'Current password', 'me.confirmPassword': 'Confirm new password',
  'me.change': 'Change', 'me.set': 'Set',
  'tokens.title': 'My API tokens', 'tokens.sub': 'Scripts and AI agents use the API as you, with your permissions. Tokens expire after 90 days.', 'tokens.once': 'New token (shown only now):',
  'tokens.expires': 'expires {date}', 'tokens.revoke': 'Revoke', 'tokens.name': 'Token name',

  'admin.only': 'Only site admins can see this.', 'admin.people': 'People', 'admin.inviteEmail': 'Email to invite', 'admin.invite': 'Create invite link',
  'admin.inviteLink': 'Invite link for {email} (7 days, single use)', 'admin.signIn': 'Sign-in', 'admin.lastLogin': 'Last sign-in', 'admin.isAdmin': 'Admin', 'admin.isAdminOf': '{name} is admin',
  'admin.reset': 'Reset link', 'admin.resetLink': 'Password reset link for {name} (24 hours, single use)', 'admin.temp': 'Temporary password',
  'admin.temp.confirm': "Issue a temporary password for {name}? Their current password stops working and they're signed out everywhere. They must choose their own at the next sign-in.",
  'admin.temp.label': 'Temporary password for {name} (shown once)', 'admin.enable': 'Enable', 'admin.disable': 'Disable', 'admin.disableNote': 'Disabling ends all sessions and API tokens at once.',
  'audit.title': 'Audit log', 'audit.when': 'When', 'audit.who': 'Who', 'audit.what': 'Action', 'audit.target': 'Target', 'audit.result': 'Result', 'audit.ok': 'OK', 'audit.failed': 'Failed',
  'audit.auth.login': 'Sign-in', 'audit.auth.sso': 'SSO sign-in', 'audit.auth.setup': 'First-run setup', 'audit.auth.reset': 'Password reset', 'audit.auth.forgot': 'Password reset requested',
  'audit.user.password': 'Password changed', 'audit.user.update': 'Account changed', 'audit.user.invite': 'Invite created', 'audit.user.reset_link': 'Reset link issued',
  'audit.user.temp_password': 'Temporary password issued', 'audit.group.update': 'Group changed', 'audit.token.create': 'API token created', 'audit.token.revoke': 'API token revoked',
  'audit.project.create': 'Project created', 'audit.project.update': 'Project changed', 'audit.project.roles': 'Roles changed', 'audit.project.workflow': 'Workflow changed',
  'audit.project.export': 'Exported', 'audit.webhook.create': 'Webhook added', 'audit.webhook.delete': 'Webhook removed', 'audit.issue.delete': 'Issue deleted',
  'audit.issue.restore': 'Issue restored', 'audit.issue.bulk': 'Bulk edit', 'audit.settings.sso': 'SSO settings changed',

  'sso.title': 'Single sign-on (OpenID Connect)', 'sso.on': 'On', 'sso.off': 'Off',
  'sso.env': "SSO is set by environment variables (OIDC_ISSUER …) on the server, so it can't be changed here. Remove them from .env and restart to manage it on this screen.",
  'sso.redirect': 'Redirect URI (register at the provider)', 'sso.redirect.hint': "Also allow this server's address (ending in /) as a post-logout redirect, so signing out ends the SSO session too. Set PUBLIC_URL on the server if people use a different address.",
  'sso.issuer': 'Issuer URL', 'sso.test': 'Test connection', 'sso.test.ok': 'Connected: {issuer}', 'sso.test.fail': "Couldn't reach it: {error}", 'sso.clientId': 'Client ID',
  'sso.secret': 'Client secret', 'sso.secret.kept': 'Saved — leave empty to keep it',
  'sso.plain': "SECRET_KEY isn't set on the server, so the client secret is stored unencrypted in the database (and its backups). Add SECRET_KEY to .env and restart; it is then encrypted automatically.",
  'sso.label': 'Button text', 'sso.groupsClaim': 'Groups claim name', 'sso.adminGroup': 'Site admin group', 'sso.passwordLogin': 'Allow password sign-in',
  'sso.passwordLogin.hint': 'Off: everyone but administrators must use SSO (admins keep an emergency way in if the provider is down).',
  'sso.autoCreate': 'Create accounts on first sign-in', 'sso.autoCreate.hint': 'Off: only people who already have an account (including one with the same email) can sign in.',
  'sso.trustEmail': "Trust emails the provider doesn't mark verified",
  'sso.trustEmail.hint': "Used only to link to an existing account with the same email. Only for providers that never send email_verified (some Entra ID setups), and only if users can't change their own email there.",
  'sso.enable': 'Turn on SSO', 'sso.disable': 'Turn off', 'sso.saved.on': 'SSO is on.', 'sso.saved.off': 'SSO is off.',

  'err.bad_credentials': "The email or password isn't right.", 'err.too_many_attempts': 'Too many attempts. Try again in 15 minutes.',
  'err.sso_only': 'This server only allows single sign-on.', 'err.bad_setup_token': "The setup token isn't right. Check the server log.",
  'err.already_set_up': 'Setup is already done.', 'err.login_required': 'Please sign in.', 'err.bad_request': "The request isn't valid.",
  'err.transition_not_allowed': "The workflow doesn't allow that move.", 'err.validation_failed': "The transition's conditions aren't met.",
  'err.conflict': 'Someone changed this value first. The latest value is loaded.',
  'err.bad_hierarchy': "That hierarchy isn't allowed: subtasks go under standard issues, standard issues under epics.",
  'err.bad_field': "A value isn't valid.", 'err.forbidden': "You don't have permission.", 'err.not_found': 'Not found.', 'err.key_taken': 'That project key is taken.',
  'err.sprint_already_active': 'A sprint is already active.', 'err.status_in_use': "A status that issues use can't be removed.",
  'err.bad_query': "The search isn't valid.", 'err.file_too_large': 'The file is too large.', 'err.too_large': 'What you sent is too large.',
  'err.storage_full': 'Attachment storage is full. Contact an administrator.', 'err.cross_site': 'Refused: the request came from another site.',
  'err.admin_only': 'Only site admins can do that.', 'err.reset_invalid': 'This link has expired or was already used.', 'err.invite_invalid': 'This link has expired or was already used.',
  'err.email_taken': 'An account with this email already exists.', 'err.not_yourself': "You can't do that to yourself.", 'err.keep_yourself_admin': 'Keep your own admin role.',
  'err.group_from_sso': "Groups from single sign-on can't be changed here.", 'err.mail_off': "This server doesn't have email set up.",
  'err.sso_env': "SSO is set by environment variables and can't be changed here.", 'err.sso_issuer': 'The issuer must be an http(s) URL.',
  'err.sso_incomplete': 'Turning SSO on needs an issuer and a client ID.', 'err.sso_discovery': "The issuer didn't answer with an OpenID configuration. Check the address.",
  'err.internal': 'Something went wrong on the server. Try again shortly.',
}

export const LANGS = { ko: { label: '한국어', dict: ko }, en: { label: 'English', dict: en } } as const
export type Lang = keyof typeof LANGS

function initial(): Lang {
  try {
    const saved = localStorage.getItem('th:lang')
    if (saved && saved in LANGS) return saved as Lang
  } catch {}
  return 'ko'
}

export const lang: Lang = initial()
document.documentElement.lang = lang

export function t(key: Key, vars?: Record<string, string | number>): string {
  let s: string = LANGS[lang].dict[key] ?? ko[key] ?? key
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v))
  return s
}

export const hasKey = (key: string): key is Key => key in ko

// Every component reads `lang` once at load, so switching reloads the app.
export function setLang(l: Lang) {
  try {
    localStorage.setItem('th:lang', l)
  } catch {}
  location.reload()
}
