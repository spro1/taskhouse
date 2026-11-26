// Who may do what in a project. One place, so search, boards, issues and notifications can't disagree.
import type pg from 'pg'
import type { User } from './http.ts'

export const LEVEL = { viewer: 1, reporter: 2, member: 3, admin: 4 } as const
export const LEVEL_NAME = ['none', 'viewer', 'reporter', 'member', 'admin'] as const
type Q = Pick<pg.Pool, 'query'> | Pick<pg.PoolClient, 'query'>

// Site admins see everything; otherwise the best of the project's visibility and any role on the user or their groups.
const levelSql = (u: string, admin: string) => `CASE WHEN ${admin} THEN 4 ELSE GREATEST(
    CASE p.visibility WHEN 'edit' THEN 3 WHEN 'view' THEN 1 ELSE 0 END,
    COALESCE((SELECT max(r.level) FROM project_roles r WHERE r.project_id = p.id
      AND (r.user_id = ${u} OR r.group_id IN (SELECT group_id FROM group_members WHERE user_id = ${u}))), 0)) END`

export type Project = { id: number; key: string; name: string; visibility: string; level: number }

/** Projects the user can see, with their level in each. */
export async function projectsFor(q: Q, user: User, key?: string): Promise<Project[]> {
  const rows = (await q.query(
    `SELECT * FROM (SELECT p.id, p.key, p.name, p.visibility, ${levelSql('$1', '$2')} AS level FROM projects p
       WHERE ($3::text IS NULL OR p.key = $3)) x WHERE level > 0 ORDER BY name`,
    [user.id, user.isAdmin, key ?? null],
  )).rows
  return rows
}

/** Of these users, the ones who can see the project (notifications must never reach anyone else). */
export async function canSeeProject(q: Q, projectId: number, userIds: number[]): Promise<number[]> {
  if (!userIds.length) return []
  return (await q.query(
    `SELECT u.id FROM users u, projects p WHERE p.id = $1 AND u.id = ANY($2) AND u.disabled_at IS NULL AND ${levelSql('u.id', 'u.is_admin')} > 0`,
    [projectId, userIds],
  )).rows.map((r) => r.id)
}

/** Editing an issue: members and admins, or a reporter on their own issue. */
export const canEdit = (level: number, user: User, reporterId: number) => level >= LEVEL.member || (level === LEVEL.reporter && reporterId === user.id)
