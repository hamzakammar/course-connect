import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { AppProvider } from './context/AppDataContext.tsx'
import { AuthProvider } from './context/AuthContext.tsx'
import { Analytics } from '@vercel/analytics/react'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider>
      <AppProvider>
        <App />
        <Analytics />
      </AppProvider>
    </AuthProvider>
  </React.StrictMode>,
)
