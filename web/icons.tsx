import { useEffect, useState } from 'react'

// Inline SVG icons (Lucide-style strokes, the same set as Pagehouse) so they look the same on every OS, unlike emoji.
const paths = {
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM21 21l-4.35-4.35',
  home: 'M3 10.5 12 3l9 7.5M5 9.5V20h5v-6h4v6h5V9.5',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z',
  plus: 'M12 5v14M5 12h14',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12ZM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  link: 'M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  chevron: 'm9 6 6 6-6 6',
  down: 'm6 9 6 6 6-6',
  x: 'M18 6 6 18M6 6l12 12',
  logout: 'M15 4h4v16h-4M10 17l5-5-5-5M15 12H3',
  sun: 'M12 4V2M12 22v-2M4.93 4.93 3.51 3.51M20.49 20.49l-1.42-1.42M4 12H2M22 12h-2M4.93 19.07l-1.42 1.42M20.49 3.51l-1.42 1.42M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z',
  monitor: 'M3 4h18v12H3zM8 20h8M12 16v4',
  bell: 'M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0',
  board: 'M4 4h4v16H4zM10 4h4v10h-4zM16 4h4v13h-4z',
  backlog: 'M4 6h16M4 12h16M4 18h10',
  filter: 'M3 5h18l-7 8v6l-4 2v-8L3 5Z',
  paperclip: 'm21 11-8.5 8.5a5 5 0 0 1-7-7L14 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 7',
  subtask: 'M6 3v12a3 3 0 0 0 3 3h9M14 14l4 4-4 4',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
  folder: 'M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z',
} as const

export type IconName = keyof typeof paths

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg className="icon-svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={name === 'more' ? 3 : 1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={paths[name]} />
    </svg>
  )
}

// Issue type marks: a coloured square with a white glyph, picked by the type's level and name (names come from data).
const TYPE_LOOK: { test: (name: string, level: number) => boolean; color: string; glyph: string }[] = [
  { test: (_, l) => l === 0, color: '#8b5cf6', glyph: 'M13 3 6 13h5l-1 8 7-10h-5l1-8Z' },
  { test: (n) => /버그|bug/i.test(n), color: '#e5484d', glyph: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z' },
  { test: (n) => /스토리|story/i.test(n), color: '#30a46c', glyph: 'M8 5h8v14l-4-3-4 3Z' },
  { test: (_, l) => l === 2, color: '#5eb1ef', glyph: 'M7 7h10v10H7z' },
]
export function TypeIcon({ type, size = 16 }: { type: { name: string; level: number }; size?: number }) {
  const look = TYPE_LOOK.find((x) => x.test(type.name, type.level)) ?? { color: '#3e7bfa', glyph: 'm7 12 3.5 3.5L17 9' }
  const filled = look.glyph.endsWith('Z') || look.glyph.endsWith('z')
  return (
    <svg className="icon-svg" width={size} height={size} viewBox="0 0 24 24" role="img" aria-label={type.name}>
      <title>{type.name}</title>
      <rect width="24" height="24" rx="5" fill={look.color} />
      <path d={look.glyph} fill={filled ? '#fff' : 'none'} stroke="#fff" strokeWidth={filled ? 0 : 2.6} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// Priority 0 (urgent) … 4 (lowest): arrows like most trackers use, so the order reads at a glance.
const PRIORITY_LOOK = [
  { color: '#e5484d', d: 'm6 13 6-6 6 6M6 19l6-6 6 6' },
  { color: '#f76b15', d: 'm6 15 6-6 6 6' },
  { color: '#e2a336', d: 'M6 10h12M6 15h12' },
  { color: '#3e7bfa', d: 'm6 9 6 6 6-6' },
  { color: '#8d8d86', d: 'm6 5 6 6 6-6M6 11l6 6 6-6' },
]
export function PriorityIcon({ priority, label, size = 16 }: { priority: number; label: string; size?: number }) {
  const look = PRIORITY_LOOK[priority] ?? PRIORITY_LOOK[2]
  return (
    <svg className="icon-svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={look.color} strokeWidth={2.6}
      strokeLinecap="round" strokeLinejoin="round" role="img" aria-label={label}>
      <title>{label}</title>
      <path d={look.d} />
    </svg>
  )
}

// A person's profile photo, or their initial on a colour picked from their id (the same person always looks the same).
// Everyone is tried for a photo; a missing one is a cached 404. bumpAvatar() refetches after a change.
const AVATAR_COLORS = ['#3e7bfa', '#30a46c', '#8b5cf6', '#e5484d', '#f76b15', '#0d9488', '#d6409f', '#6e56cf']
let avatarBust = 0
export const bumpAvatar = () => (avatarBust = Date.now())
export function Avatar({ user, size }: { user: { id: number; name: string } | null; size?: 'sm' | 'lg' | 'xl' }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [user?.id])
  if (!user) return <span className={`avatar empty ${size ?? ''}`} aria-hidden="true" />
  return (
    <span className={`avatar ${size ?? ''}`} title={user.name} style={{ background: AVATAR_COLORS[user.id % AVATAR_COLORS.length] }}>
      {user.name.slice(0, 1)}
      {!failed && <img src={`/api/users/${user.id}/avatar${avatarBust ? `?v=${avatarBust}` : ''}`} alt="" loading="lazy" onError={() => setFailed(true)} />}
    </span>
  )
}
