import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initTheme, watchSystemTheme } from './store/theme';
import { installTooltips } from './ui/tooltip';
import './index.css';

initTheme();
watchSystemTheme();

const container = document.getElementById('root');
if (!container) throw new Error('#root missing from index.html');
installTooltips(container);

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
