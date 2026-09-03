import React from 'react';
import ReactDOM from 'react-dom/client';
// Set default theme on document root
if (typeof document !== 'undefined') {
  document.documentElement.setAttribute('data-theme', 'cyan');
}

import App from './App';
import './index.css';

// NOTE: StrictMode intentionally REMOVED — it causes useEffect double-mount
// in development which creates duplicate terminal sessions (double PowerShell
// prompt). StrictMode is a development-only tool; production builds are
// unaffected. If StrictMode is needed for other components, wrap them
// individually instead of the entire app.
ReactDOM.createRoot(document.getElementById('root')!).render(
  <App />
);
