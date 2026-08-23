import React from 'react';
import ReactDOM from 'react-dom/client';
// Set default theme on document root
if (typeof document !== 'undefined') {
  document.documentElement.setAttribute('data-theme', 'cyan');
}

import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
