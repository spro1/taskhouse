// Every language defines every key (the Dict type checks that at build time); here: the same {placeholders} in each,
// so a translation can't silently drop or misspell one and show "{name}" on screen.
import { test } from 'node:test'
import assert from 'node:assert/strict'

;(globalThis as any).localStorage = { getItem: () => null, setItem: () => {} }
;(globalThis as any).document = { documentElement: {} }
const { LANGS, t, lang } = await import('./i18n.ts')

const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()

test('all languages have the same keys and placeholders', () => {
  const base = LANGS.ko.dict as Record<string, string>
  for (const [code, { dict }] of Object.entries(LANGS)) {
    assert.deepEqual(Object.keys(dict).sort(), Object.keys(base).sort(), code)
    for (const [k, v] of Object.entries(dict as Record<string, string>)) assert.deepEqual(vars(v), vars(base[k]), `${code} ${k}`)
  }
})

test('Korean by default, placeholders filled', () => {
  assert.equal(lang, 'ko')
  assert.equal(t('home.mine', { name: '밥' }), '밥님의 미완료 이슈')
})
