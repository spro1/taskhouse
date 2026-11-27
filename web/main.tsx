import { createRoot } from 'react-dom/client'
import './theme.ts'
import { App } from './App.tsx'
import './style.css'

createRoot(document.getElementById('root')!).render(<App />)
