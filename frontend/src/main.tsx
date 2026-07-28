import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App, loadAppServices } from '@/app'
import './index.css'

async function bootstrap(): Promise<void> {
  const services = await loadAppServices()
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App services={services} />
    </StrictMode>,
  )
}

void bootstrap()
