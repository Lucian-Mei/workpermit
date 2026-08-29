import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './context/AuthContext';
import { ThemeProvider } from './theme/ThemeProvider';
import { ErrorBoundary } from './components/ErrorBoundary';
import './index.css';
import './theme/extras.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <ThemeProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </ThemeProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>,
);

// S17 修订：不再注册 Service Worker（其缓存独立于 HTTP、强刷清不掉，会导致改版后看不到新版本）。
// 改为主动注销历史注册的任何 SW，并清理其缓存，让页面完全走 HTTP 缓存策略（index.html no-cache）。
if ('serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.getRegistrations().then((rs) =>
      rs.forEach((r) => r.unregister().catch(() => {})),
    );
  });
}
