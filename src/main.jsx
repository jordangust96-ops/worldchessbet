import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/index.css'
import { scheduleDeferredAnalytics } from '@/lib/deferredAnalytics'

scheduleDeferredAnalytics();

ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
)