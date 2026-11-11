import '@fontsource-variable/inter';
import './ui/theme.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { App } from './app/App';
import { RuntimeProvider } from './app/runtime';
import { ToastHost } from './ui/kit';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <ToastHost>
        <RuntimeProvider>
          <App />
        </RuntimeProvider>
      </ToastHost>
    </HashRouter>
  </StrictMode>,
);
