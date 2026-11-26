// Site admin: people (invite, disable, admin, reset link) and the audit log.
import { useEffect, useState } from 'react'
import { api, message } from './api.ts'
import { toast, type Me } from './App.tsx'

type Person = { id: number; email: string; name: string; isAdmin: boolean; sso: boolean; lastLoginAt: string | null; disabledAt: string | null }
type Entry = { id: number; at: string; action: string; target: string | null; ip: string; ok: boolean; actor: string | null; detail: any }

const ACTIONS: Record<string, string> = {
  'auth.login': '로그인', 'auth.sso': 'SSO 로그인', 'auth.setup': '초기 설정', 'auth.reset': '비밀번호 재설정', 'user.password': '비밀번호 변경',
  'user.update': '사용자 변경', 'user.invite': '초대', 'user.reset_link': '재설정 링크 발급', 'group.update': '그룹 변경', 'token.create': 'API 토큰 발급',
  'token.revoke': 'API 토큰 폐기', 'project.create': '프로젝트 생성', 'project.update': '프로젝트 변경', 'project.roles': '역할 변경',
  'project.workflow': '워크플로 변경', 'project.export': '내보내기', 'webhook.create': '웹훅 추가', 'webhook.delete': '웹훅 삭제',
  'issue.delete': '이슈 삭제', 'issue.restore': '이슈 복원', 'issue.bulk': '일괄 수정',
}

export function Admin({ me }: { me: Me }) {
  const [people, setPeople] = useState<Person[]>([])
  const [log, setLog] = useState<Entry[]>([])
  const [link, setLink] = useState<{ label: string; url: string } | null>(null)
  const [email, setEmail] = useState('')
  const load = () => api<Person[]>('GET', '/api/admin/users').then(setPeople)
  const loadLog = (before?: number) => api<Entry[]>('GET', `/api/admin/audit${before ? `?before=${before}` : ''}`).then((r) => setLog(before ? [...log, ...r] : r))
  useEffect(() => { load(); loadLog() }, [])
  const update = (p: Person, change: object) => api('PATCH', `/api/admin/users/${p.id}`, change).then(() => { load(); loadLog() }, (e) => toast(message(e)))
  const show = (label: string, url: string) => setLink({ label, url: location.origin + url })
  if (!me.isAdmin) return <p>사이트 관리자만 볼 수 있습니다.</p>
  return (
    <div className="settings">
      <h1>관리</h1>
      <section>
        <h3>사람</h3>
        {link && <p className="token">{link.label}: <code>{link.url}</code></p>}
        <form className="inline" onSubmit={(e) => {
          e.preventDefault()
          api('POST', '/api/admin/invites', { email }).then((r) => { show(`${email} 초대 링크 (7일, 1회용)`, r.url); setEmail('') }, (x) => toast(message(x)))
        }}>
          <input type="email" required placeholder="초대할 이메일" value={email} onChange={(e) => setEmail(e.target.value)} />
          <button>초대 링크 만들기</button>
        </form>
        <table className="results">
          <thead><tr><th>이름</th><th>이메일</th><th>로그인</th><th>마지막 로그인</th><th>관리자</th><th></th></tr></thead>
          <tbody>
            {people.map((p) => (
              <tr key={p.id} className={p.disabledAt ? 'muted' : ''}>
                <td>{p.name}</td>
                <td>{p.email}</td>
                <td>{p.sso ? 'SSO' : '비밀번호'}</td>
                <td>{p.lastLoginAt ? new Date(p.lastLoginAt).toLocaleString() : '없음'}</td>
                <td><input type="checkbox" aria-label={`${p.name} 관리자`} checked={p.isAdmin} disabled={p.id === me.id} onChange={(e) => update(p, { isAdmin: e.target.checked })} /></td>
                <td>
                  {!p.disabledAt && <button className="link" onClick={() => api('POST', `/api/admin/users/${p.id}/reset-link`).then((r) => show(`${p.name} 비밀번호 재설정 링크 (24시간, 1회용)`, r.url), (x) => toast(message(x)))}>재설정 링크</button>}{' '}
                  {p.id !== me.id && (
                    <button className="link" onClick={() => update(p, { disabled: !p.disabledAt })}>{p.disabledAt ? '다시 활성화' : '비활성화'}</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small">비활성화하면 모든 세션과 API 토큰이 즉시 끊깁니다.</p>
      </section>
      <section>
        <h3>감사 로그</h3>
        <table className="results">
          <thead><tr><th>시각</th><th>누가</th><th>무엇</th><th>대상</th><th>IP</th><th>결과</th></tr></thead>
          <tbody>
            {log.map((e) => (
              <tr key={e.id}>
                <td className="muted">{new Date(e.at).toLocaleString()}</td>
                <td>{e.actor ?? '-'}</td>
                <td>{ACTIONS[e.action] ?? e.action}</td>
                <td>{e.target ?? ''}</td>
                <td className="muted">{e.ip}</td>
                <td>{e.ok ? '성공' : <span className="error">실패</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {log.length > 0 && log.length % 100 === 0 && <button onClick={() => loadLog(log.at(-1)!.id)}>더 보기</button>}
      </section>
    </div>
  )
}
