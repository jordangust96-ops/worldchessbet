import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/index.css'
import { analytics } from '@heycatch/sdk'

analytics.init({
  projectKey: 'hck_pk_Q3LEgDjnK_AjVkiSmzmd6bQl0SEtDlNr',
  install: {
    framework: 'vite-react',
    frameworkVersion: '6',
    agent: 'codex',
  },
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
)
