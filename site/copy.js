// Copy buttons on command blocks. Works on plain http too (falls back to a hidden textarea).
for (const pre of document.querySelectorAll('pre.cmd')) {
  const b = document.createElement('button')
  const label = document.documentElement.lang === 'ko' ? ['복사', '복사됨'] : ['Copy', 'Copied']
  b.type = 'button'
  b.textContent = label[0]
  b.addEventListener('click', async () => {
    const text = pre.querySelector('code').innerText
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const t = Object.assign(document.createElement('textarea'), { value: text })
      document.body.append(t)
      t.select()
      document.execCommand('copy')
      t.remove()
    }
    b.textContent = label[1]
    setTimeout(() => (b.textContent = label[0]), 1500)
  })
  pre.append(b)
}
