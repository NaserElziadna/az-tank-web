import './styles/main.css';
import { App } from './app/App.js';

/** Bootstraps the app once the DOM is ready. */
function boot() {
  const mount = document.getElementById('app');
  if (!mount) throw new Error('AZ Tank: #app mount point not found');
  // eslint-disable-next-line no-new
  window.__azTank = new App(mount);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
