import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { applyTheme } from './ui/prefs';
import './styles/index.css';

// الوضع المحفوظ يُطبَّق قبل أول رسم — وإلا ومض التطبيق فاتحاً ثم انقلب داكناً.
applyTheme();

createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App /></React.StrictMode>,
);
