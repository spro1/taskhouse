// Rich text for descriptions and comments (Tiptap), with @mentions. Documents are stored as Tiptap JSON;
// DocView renders them with React elements only (no HTML strings), so stored content can't inject script.
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Mention from '@tiptap/extension-mention'
import type { ReactNode } from 'react'
import { api, type Ref } from './api.ts'
import { t } from './i18n.ts'

type Item = { id: number; label: string }

// The @ popup: a small list under the caret, kept outside React so Tiptap can drive it directly.
const mentionSuggestion = {
  items: async ({ query }: { query: string }): Promise<Item[]> =>
    (await api<Ref[]>('GET', `/api/users?q=${encodeURIComponent(query)}`)).slice(0, 8).map((u) => ({ id: u.id, label: u.name })),
  render: () => {
    let el: HTMLDivElement
    let items: Item[] = []
    let index = 0
    let command: (i: Item) => void
    const draw = () => {
      el.replaceChildren(...items.map((it, i) => {
        const b = document.createElement('button')
        b.type = 'button'
        b.textContent = it.label
        b.className = i === index ? 'on' : ''
        b.onmousedown = (e) => { e.preventDefault(); command(it) }
        return b
      }))
      el.style.display = items.length ? 'block' : 'none'
    }
    const place = (rect?: (() => DOMRect | null) | null) => {
      const r = rect?.()
      if (r) Object.assign(el.style, { left: `${r.left + scrollX}px`, top: `${r.bottom + scrollY + 4}px` })
    }
    return {
      onStart: (p: any) => {
        el = document.createElement('div')
        el.className = 'mention-menu'
        el.setAttribute('role', 'listbox')
        document.body.append(el)
        items = p.items; index = 0; command = p.command
        place(p.clientRect); draw()
      },
      onUpdate: (p: any) => { items = p.items; index = 0; command = p.command; place(p.clientRect); draw() },
      onKeyDown: ({ event }: { event: KeyboardEvent }) => {
        if (!items.length) return false
        if (event.key === 'ArrowDown') index = (index + 1) % items.length
        else if (event.key === 'ArrowUp') index = (index + items.length - 1) % items.length
        else if (event.key === 'Enter' || event.key === 'Tab') { command(items[index]); return true }
        else return false
        draw()
        return true
      },
      onExit: () => el?.remove(),
    }
  },
}

export function Editor({ content, onSubmit, onCancel, submitLabel = t('common.save'), placeholder }: {
  content?: any; onSubmit: (doc: any) => void; onCancel?: () => void; submitLabel?: string; placeholder?: string
}) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false, protocols: ['http', 'https', 'mailto'] } }),
      Mention.configure({ HTMLAttributes: { class: 'mention' }, suggestion: mentionSuggestion as any }),
    ],
    content: content?.content?.length ? content : undefined,
    editorProps: { attributes: { class: 'editor', 'aria-label': placeholder ?? t('editor.content') } },
  })
  const submit = () => {
    if (!editor) return
    onSubmit(editor.getJSON())
  }
  return (
    <div className="editor-wrap" onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit() } }}>
      {editor && (
        <div className="toolbar" role="toolbar" aria-label={t('editor.toolbar')}>
          {([['B', 'bold', () => editor.chain().focus().toggleBold().run()], ['I', 'italic', () => editor.chain().focus().toggleItalic().run()],
            ['H', 'heading', () => editor.chain().focus().toggleHeading({ level: 3 }).run()], ['•', 'bulletList', () => editor.chain().focus().toggleBulletList().run()],
            ['1.', 'orderedList', () => editor.chain().focus().toggleOrderedList().run()], ['</>', 'codeBlock', () => editor.chain().focus().toggleCodeBlock().run()],
          ] as const).map(([label, name, run]) => (
            <button key={name} type="button" className={editor.isActive(name) ? 'on' : ''} onClick={run} aria-label={name}>{label}</button>
          ))}
        </div>
      )}
      <EditorContent editor={editor} />
      <div className="inline">
        <button type="button" className="primary" onClick={submit}>{submitLabel}</button>
        {onCancel && <button type="button" onClick={onCancel}>{t('common.cancel')}</button>}
        <span className="muted small">{t('editor.hint', { action: submitLabel })}</span>
      </div>
    </div>
  )
}

const safeHref = (h: unknown) => (typeof h === 'string' && /^(https?:|mailto:)/i.test(h) ? h : undefined)

function marks(text: ReactNode, list: any[] = []): ReactNode {
  return list.reduce((acc, m, i) => {
    switch (m.type) {
      case 'bold': return <strong key={i}>{acc}</strong>
      case 'italic': return <em key={i}>{acc}</em>
      case 'strike': return <s key={i}>{acc}</s>
      case 'underline': return <u key={i}>{acc}</u>
      case 'code': return <code key={i}>{acc}</code>
      case 'link': return <a key={i} href={safeHref(m.attrs?.href)} target="_blank" rel="noreferrer noopener">{acc}</a>
      default: return acc
    }
  }, text)
}

function node(n: any, key: number): ReactNode {
  const kids = (n.content ?? []).map(node)
  switch (n.type) {
    case 'text': return <span key={key}>{marks(n.text, n.marks)}</span>
    case 'paragraph': return <p key={key}>{kids}</p>
    case 'heading': return <h4 key={key} className="doc-h">{kids}</h4>
    case 'bulletList': return <ul key={key}>{kids}</ul>
    case 'orderedList': return <ol key={key}>{kids}</ol>
    case 'listItem': return <li key={key}>{kids}</li>
    case 'blockquote': return <blockquote key={key}>{kids}</blockquote>
    case 'codeBlock': return <pre key={key}><code>{kids}</code></pre>
    case 'hardBreak': return <br key={key} />
    case 'horizontalRule': return <hr key={key} />
    case 'mention': return <span key={key} className="mention">@{n.attrs?.label ?? ''}</span>
    default: return <span key={key}>{kids}</span>
  }
}

export function DocView({ doc, empty }: { doc: any; empty?: ReactNode }) {
  if (!doc?.content?.some((n: any) => n.content?.length || n.type !== 'paragraph')) return <>{empty}</>
  return <div className="doc">{doc.content.map(node)}</div>
}
