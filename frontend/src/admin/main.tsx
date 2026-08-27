import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'

import '@fontsource-variable/noto-serif-sc/wght.css'
import { adminApis } from './api'
import { AdminAppRoutes } from './app'
import './style.css'
import { AdminSessionProvider } from './session'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AdminSessionProvider apis={adminApis}>
      <BrowserRouter>
        <AdminAppRoutes />
      </BrowserRouter>
    </AdminSessionProvider>
  </StrictMode>,
)
