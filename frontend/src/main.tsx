import '@fontsource-variable/archivo/standard.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { SettingsProvider } from './lib/settings.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SettingsProvider>
      <App />
    </SettingsProvider>
  </StrictMode>,
)

// start fetching the 3D stadium straight away, in parallel with the match data
void import('./components/Miniature')
