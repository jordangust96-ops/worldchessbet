import { analytics } from '@heycatch/sdk';
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/index.css'

analytics.init({
  projectKey: 'hck_pk_Q3LEgDjnK_AjVkiSmzmd6bQl0SEtDlNr',
  install: {
    framework: 'vite-react',
    agent: 'other',
  },
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
)