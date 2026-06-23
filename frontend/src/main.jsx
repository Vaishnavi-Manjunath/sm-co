import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'

// Browser error reporting is loaded via the Sentry script tag in index.html.

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
