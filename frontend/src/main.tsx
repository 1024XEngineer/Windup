import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from '@/app'
import { userApis } from '@/entities'
import { AuthSessionProvider } from '@/features/auth-session'
import '@fontsource-variable/noto-serif-sc/wght.css'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthSessionProvider apis={userApis}>
      <App />
    </AuthSessionProvider>
  </StrictMode>,
)
