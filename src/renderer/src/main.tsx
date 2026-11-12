import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster } from 'sonner';
import App from './App';
import { loadFonts } from './fonts';
import './styles.css';

loadFonts();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <Toaster
      theme="dark"
      position="bottom-right"
      toastOptions={{
        style: {
          background: 'var(--surface-2)',
          color: 'var(--text)',
        },
      }}
    />
  </StrictMode>,
);
