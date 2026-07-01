import './styles/main.css';
import { App } from './app/App.js';
import { log } from './core/log/Logger.js';

// Funnel any uncaught client error into the shared log file via the server.
window.addEventListener('error', (e) => log.scope('window').error('uncaught error', { message: e.message, source: e.filename, line: e.lineno, stack: e.error?.stack }));
window.addEventListener('unhandledrejection', (e) => log.scope('window').error('unhandled rejection', { reason: e.reason?.message || String(e.reason), stack: e.reason?.stack }));

/** Bootstraps the app once the DOM is ready. */
function boot() {
  const mount = document.getElementById('app');
  if (!mount) throw new Error('AZ Tank: #app mount point not found');
  log.scope('app').info('boot', { ua: navigator.userAgent, url: location.href });
  // eslint-disable-next-line no-new
  window.__azTank = new App(mount);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

// Register the PWA service worker in production only. In Vite dev (port 5173) a
// SW would cache stale modules and fight HMR, so it's skipped there.
if ('serviceWorker' in navigator && location.port !== '5173') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => log.scope('pwa').warn('sw register failed', { message: err?.message }));
  });
}
