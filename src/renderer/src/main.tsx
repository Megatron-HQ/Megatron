import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'

// Read synchronously, before first paint, to avoid a flash of the wrong theme.
const initialTheme = window.api.getInitialTheme()
document.documentElement.classList.toggle(
  'dark',
  initialTheme === 'dark' ||
    (initialTheme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
)

const queryClient = new QueryClient()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>
)
