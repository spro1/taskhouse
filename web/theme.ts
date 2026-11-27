// Light, dark, or follow the device, as in Pagehouse. Applied before the first paint (imported by main.tsx), kept per browser.
export type Theme = 'system' | 'light' | 'dark'
export const THEMES: Theme[] = ['system', 'light', 'dark']

function stored(): Theme {
  try {
    const t = localStorage.getItem('th:theme') as Theme | null
    if (t && THEMES.includes(t)) return t
  } catch {}
  return 'system'
}

export let theme: Theme = stored()

export function applyTheme(t: Theme) {
  theme = t
  if (t === 'system') delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = t
  try {
    localStorage.setItem('th:theme', t)
  } catch {}
  dispatchEvent(new CustomEvent('th:theme', { detail: t }))
}

applyTheme(theme)
