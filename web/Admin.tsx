// Site admin: people (invite, disable, admin, reset link, temporary password), single sign-on and the audit log.
import { useEffect, useState } from 'react'
import { api, message } from './api.ts'
import { Link, toast, type Me } from './App.tsx'
import { Monitor } from './Monitor.tsx'
import { hasKey, t, type Key } from './i18n.ts'

type Person = { id: number; email: string; name: string; isAdmin: boolean; sso: boolean; lastLoginAt: string | null; disabledAt: string | null }
type Entry = { id: number; at: string; action: string; target: string | null; ip: string; ok: boolean; actor: string | null; detail: any }

export function Admin({ me, tab }: { me: Me; tab: 'people' | 'monitor' | 'audit' }) {
  const [people, setPeople] = useState<Person[]>([])
  const [log, setLog] = useState<Entry[]>([])
  const [link, setLink] = useState<{ label: string; value: string } | null>(null)
  const [email, setEmail] = useState('')
  const load = () => api<Person[]>('GET', '/api/admin/users').then(setPeople)
  const loadLog = (before?: number) => api<Entry[]>('GET', `/api/admin/audit${before ? `?before=${before}` : ''}`).then((r) => setLog(before ? [...log, ...r] : r))
  useEffect(() => { load(); loadLog() }, [])
  const update = (p: Person, change: object) => api('PATCH', `/api/admin/users/${p.id}`, change).then(() => { load(); loadLog() }, (e) => toast(message(e)))
  const show = (label: string, value: string) => setLink({ label, value })
  const temp = (p: Person) => {
    if (!confirm(t('admin.temp.confirm', { name: p.name }))) return
    api('POST', `/api/admin/users/${p.id}/temp-password`).then((r) => { show(t('admin.temp.label', { name: p.name }), r.password); loadLog() }, (x) => toast(message(x)))
  }
  if (!me.isAdmin) return <p>{t('admin.only')}</p>
  return (
    <div className="settings">
      <h1>{t('nav.admin')}</h1>
      <nav className="tabs">
        <Link to="/admin" className={tab === 'people' ? 'on' : ''}>{t('admin.tab.people')}</Link>
        <Link to="/admin/monitor" className={tab === 'monitor' ? 'on' : ''}>{t('admin.tab.monitor')}</Link>
        <Link to="/admin/audit" className={tab === 'audit' ? 'on' : ''}>{t('admin.tab.audit')}</Link>
      </nav>
      {tab === 'monitor' && <Monitor />}
      {tab === 'people' && <>
      <section>
        <h3>{t('admin.people')}</h3>
        {link && <p className="token">{link.label}: <code>{link.value}</code></p>}
        <form className="inline" onSubmit={(e) => {
          e.preventDefault()
          api('POST', '/api/admin/invites', { email }).then((r) => { show(t('admin.inviteLink', { email }), location.origin + r.url); setEmail('') }, (x) => toast(message(x)))
        }}>
          <input type="email" required placeholder={t('admin.inviteEmail')} aria-label={t('admin.inviteEmail')} value={email} onChange={(e) => setEmail(e.target.value)} />
          <button>{t('admin.invite')}</button>
        </form>
        <table className="results">
          <thead><tr><th>{t('auth.name')}</th><th>{t('auth.email')}</th><th>{t('admin.signIn')}</th><th>{t('admin.lastLogin')}</th><th>{t('admin.isAdmin')}</th><th></th></tr></thead>
          <tbody>
            {people.map((p) => (
              <tr key={p.id} className={p.disabledAt ? 'muted' : ''}>
                <td>{p.name}</td>
                <td>{p.email}</td>
                <td>{p.sso ? 'SSO' : t('auth.password.title')}</td>
                <td>{p.lastLoginAt ? new Date(p.lastLoginAt).toLocaleString() : t('common.empty')}</td>
                <td><input type="checkbox" aria-label={t('admin.isAdminOf', { name: p.name })} checked={p.isAdmin} disabled={p.id === me.id} onChange={(e) => update(p, { isAdmin: e.target.checked })} /></td>
                <td>
                  {!p.disabledAt && <button className="link" onClick={() => api('POST', `/api/admin/users/${p.id}/reset-link`).then((r) => show(t('admin.resetLink', { name: p.name }), location.origin + r.url), (x) => toast(message(x)))}>{t('admin.reset')}</button>}{' '}
                  {!p.disabledAt && p.id !== me.id && <button className="link" onClick={() => temp(p)}>{t('admin.temp')}</button>}{' '}
                  {p.id !== me.id && (
                    <button className="link" onClick={() => update(p, { disabled: !p.disabledAt })}>{p.disabledAt ? t('admin.enable') : t('admin.disable')}</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small">{t('admin.disableNote')}</p>
      </section>
      <Sso />
      </>}
      {tab === 'audit' && <section>
        <h3>{t('audit.title')}</h3>
        <table className="results">
          <thead><tr><th>{t('audit.when')}</th><th>{t('audit.who')}</th><th>{t('audit.what')}</th><th>{t('audit.target')}</th><th>IP</th><th>{t('audit.result')}</th></tr></thead>
          <tbody>
            {log.map((e) => (
              <tr key={e.id}>
                <td className="muted">{new Date(e.at).toLocaleString()}</td>
                <td>{e.actor ?? '-'}</td>
                <td>{hasKey(`audit.${e.action}`) ? t(`audit.${e.action}` as Key) : e.action}</td>
                <td>{e.target ?? ''}</td>
                <td className="muted">{e.ip}</td>
                <td>{e.ok ? t('audit.ok') : <span className="error">{t('audit.failed')}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {log.length > 0 && log.length % 100 === 0 && <button onClick={() => loadLog(log.at(-1)!.id)}>{t('common.more')}</button>}
      </section>}
    </div>
  )
}

type SsoView = {
  source: 'env' | 'admin'; enabled: boolean; issuer: string; clientId: string; hasSecret: boolean; label: string; groupsClaim: string
  adminGroup: string; passwordLogin: boolean; autoCreate: boolean; trustEmail: boolean; redirectUri: string; encrypted: boolean
}

// Single sign-on (OpenID Connect). Read-only when the server sets it with OIDC_* environment variables.
function Sso() {
  const [v, setV] = useState<SsoView>()
  const [f, setF] = useState({ issuer: '', clientId: '', clientSecret: '', label: '', groupsClaim: 'groups', adminGroup: '', passwordLogin: true, autoCreate: true, trustEmail: false })
  const [test, setTest] = useState('')
  const apply = (s: SsoView) => {
    setV(s)
    setF({ issuer: s.issuer, clientId: s.clientId, clientSecret: '', label: s.label, groupsClaim: s.groupsClaim, adminGroup: s.adminGroup,
      passwordLogin: s.passwordLogin, autoCreate: s.autoCreate, trustEmail: s.trustEmail })
  }
  useEffect(() => { api<SsoView>('GET', '/api/admin/sso').then(apply) }, [])
  if (!v) return null
  const env = v.source === 'env'
  const save = (enabled: boolean) => api<SsoView>('PUT', '/api/admin/sso', { ...f, enabled }).then((s) => { apply(s); toast(t(enabled ? 'sso.saved.on' : 'sso.saved.off')) }, (x) => toast(message(x)))
  const text = (k: 'issuer' | 'clientId' | 'clientSecret' | 'label' | 'groupsClaim' | 'adminGroup', label: string, extra: object = {}) => (
    <label>{label}<input value={f[k]} disabled={env} onChange={(e) => setF({ ...f, [k]: e.target.value })} {...extra} /></label>
  )
  return (
    <section className="sso">
      <h3>{t('sso.title')} <span className={`pill ${v.enabled ? 'c2' : 'c0'}`}>{v.enabled ? t('sso.on') : t('sso.off')}</span></h3>
      {env && <p className="muted">{t('sso.env')}</p>}
      <label>{t('sso.redirect')}<input readOnly value={v.redirectUri} onFocus={(e) => e.target.select()} /></label>
      <p className="muted small">{t('sso.redirect.hint')}</p>
      <div className="inline">
        {text('issuer', t('sso.issuer'), { placeholder: 'https://sso.example.com/realms/company', type: 'url' })}
        {!env && <button type="button" onClick={() => api('POST', '/api/admin/sso/test', { issuer: f.issuer }).then((r) => setTest(r.ok ? t('sso.test.ok', { issuer: r.issuer }) : t('sso.test.fail', { error: r.error })))}>{t('sso.test')}</button>}
      </div>
      {test && <p className="muted small" role="status">{test}</p>}
      {text('clientId', t('sso.clientId'))}
      {!env && text('clientSecret', t('sso.secret'), { type: 'password', placeholder: v.hasSecret ? t('sso.secret.kept') : '', autoComplete: 'new-password' })}
      {!env && !v.encrypted && v.hasSecret && <p className="error small">{t('sso.plain')}</p>}
      {text('label', t('sso.label'), { placeholder: 'SSO' })}
      {text('groupsClaim', t('sso.groupsClaim'))}
      {text('adminGroup', t('sso.adminGroup'))}
      {(['autoCreate', 'passwordLogin', 'trustEmail'] as const).map((k) => (
        <div key={k}>
          <label className="check">
            <input type="checkbox" checked={f[k]} disabled={env} onChange={(e) => setF({ ...f, [k]: e.target.checked })} />{t(`sso.${k}`)}
          </label>
          <p className="muted small">{t(`sso.${k}.hint`)}</p>
        </div>
      ))}
      {!env && (
        <div className="inline">
          <button className="primary" onClick={() => save(true)}>{t(v.enabled ? 'common.save' : 'sso.enable')}</button>
          {v.enabled && <button onClick={() => save(false)}>{t('sso.disable')}</button>}
        </div>
      )}
    </section>
  )
}
