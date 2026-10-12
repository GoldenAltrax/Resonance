import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { registerServiceWorker } from './utils/pwa';
import '@fontsource-variable/inter/wght.css';
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>
);

registerServiceWorker();
