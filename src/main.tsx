import { StrictMode } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

if ('scrollRestoration' in window.history) {
  window.history.scrollRestoration = 'manual';
}

const resetInitialScrollPosition = () => {
  window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;
};

resetInitialScrollPosition();
window.addEventListener('load', resetInitialScrollPosition, { once: true });
window.addEventListener('pageshow', resetInitialScrollPosition);

const rootElement = document.getElementById('root');
const app = (
  <StrictMode>
    <App />
  </StrictMode>
);

if (rootElement) {
  if (rootElement.hasChildNodes()) {
    hydrateRoot(rootElement, app);
  } else {
    createRoot(rootElement).render(app);
  }
}
