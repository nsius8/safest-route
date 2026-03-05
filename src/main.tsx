import React from 'react'
import ReactDOM from 'react-dom/client'
import L from 'leaflet'
import App from './App'
import { ErrorBoundary } from './ErrorBoundary'
import './index.css'

// Fix Leaflet default icon 404 in some bundler setups
delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

// Avoid "Uncaught (in promise) undefined" from unhandled rejections (e.g. in iframe/extension contexts)
window.addEventListener('unhandledrejection', (event) => {
  if (event.reason === undefined || (typeof event.reason === 'string' && event.reason === 'undefined')) {
    event.preventDefault()
    console.warn('[Safest Route] Suppressed unhandled promise rejection (undefined). This can happen in embedded/iframe contexts.')
  }
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)
