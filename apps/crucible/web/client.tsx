import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'

console.log('[Crucible] Client script started')

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('Failed to find root element')
}

console.log('[Crucible] Root element found, creating React root')

try {
  const root = createRoot(rootElement)
  console.log('[Crucible] React root created, rendering App')
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
  console.log('[Crucible] App rendered successfully')
} catch (error) {
  console.error('[Crucible] Error rendering app:', error)
  throw error
}
