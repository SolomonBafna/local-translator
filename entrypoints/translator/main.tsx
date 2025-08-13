import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import TranslatorApp from './TranslatorApp';
import './style.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TranslatorApp />
  </StrictMode>
);