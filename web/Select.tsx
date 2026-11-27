// A select with our own drop-down list (the browser's list can't be styled): icons and avatars in options, the same
// look in every browser and theme. Keyboard: Enter/Space/↓ opens, ↑↓ move, Enter picks, Esc closes, letters jump.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './icons.tsx'

export type Option<V> = { value: V; label: string; icon?: ReactNode; hint?: string }

export function Select<V extends string | number>({ value, options, onChange, label, disabled, className, placeholder, placement }: {
  value: V; options: Option<V>[]; onChange: (v: V) => void; label: string; disabled?: boolean; className?: string; placeholder?: string; placement?: 'end'
}) {
  const [open, setOpen] = useState(false)
  const [idx, setIdx] = useState(0)
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; width: number; maxHeight: number }>()
  const button = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const current = options.find((o) => o.value === value)

  const show = () => {
    if (disabled) return
    setIdx(Math.max(0, options.findIndex((o) => o.value === value)))
    setOpen(true)
  }
  const close = (focus = true) => { setOpen(false); if (focus) button.current?.focus() }
  const pick = (o: Option<V>) => { close(); if (o.value !== value) onChange(o.value) }

  // Placed under the button (or above, when there's more room there), in a portal so scrolling panels never clip it.
  useLayoutEffect(() => {
    if (!open || !button.current) return
    const r = button.current.getBoundingClientRect()
    const below = innerHeight - r.bottom - 12
    const above = r.top - 12
    const width = Math.max(r.width, 180)
    const left = Math.min(placement === 'end' ? r.right - width : r.left, innerWidth - width - 8)
    setPos(below >= 200 || below >= above ? { left, top: r.bottom + 4, width, maxHeight: Math.min(320, below) } : { left, bottom: innerHeight - r.top + 4, width, maxHeight: Math.min(320, above) })
  }, [open])
  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => !button.current?.contains(e.target as Node) && !list.current?.contains(e.target as Node) && close(false)
    const moved = (e: Event) => !list.current?.contains(e.target as Node) && close(false)
    addEventListener('mousedown', away)
    addEventListener('scroll', moved, true)
    addEventListener('resize', moved)
    return () => { removeEventListener('mousedown', away); removeEventListener('scroll', moved, true); removeEventListener('resize', moved) }
  }, [open])
  useEffect(() => { if (open) list.current?.children[idx]?.scrollIntoView({ block: 'nearest' }) }, [idx, open])

  const key = (e: React.KeyboardEvent) => {
    if (!open) {
      if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(e.key)) { e.preventDefault(); show() }
      return
    }
    if (e.key === 'Escape' || e.key === 'Tab') { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation() } close(e.key === 'Escape') }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((idx + 1) % options.length) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((idx + options.length - 1) % options.length) }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (options[idx]) pick(options[idx]) }
    else if (e.key.length === 1) {
      const n = options.findIndex((o, i) => i > idx && o.label.toLowerCase().startsWith(e.key.toLowerCase()))
      const m = n >= 0 ? n : options.findIndex((o) => o.label.toLowerCase().startsWith(e.key.toLowerCase()))
      if (m >= 0) setIdx(m)
    }
  }

  return (
    <>
      <button ref={button} type="button" className={`select ${className ?? ''}`} disabled={disabled} aria-label={label} aria-haspopup="listbox" aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); open ? close() : show() }} onKeyDown={key}>
        {current?.icon}
        <span className="select-label">{current?.label ?? placeholder ?? ''}</span>
        {!disabled && <Icon name="down" size={15} />}
      </button>
      {open && pos && createPortal(
        <ul ref={list} className="select-menu" role="listbox" aria-label={label} style={pos} onMouseDown={(e) => e.preventDefault()}>
          {options.map((o, i) => (
            <li key={String(o.value)} role="option" aria-selected={o.value === value} className={`${i === idx ? 'on' : ''} ${o.value === value ? 'chosen' : ''}`}
              onMouseEnter={() => setIdx(i)} onClick={(e) => { e.stopPropagation(); pick(o) }}>
              {o.icon}<span className="grow ellipsis">{o.label}</span>{o.hint && <span className="muted small">{o.hint}</span>}
              {o.value === value && <svg className="icon-svg check-mark" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10" /></svg>}
            </li>
          ))}
        </ul>,
        document.body,
      )}
    </>
  )
}
