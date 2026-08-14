import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import './styles/tokens.css';

// الوضع المحفوظ يُطبَّق قبل أول رسم — وإلا ومض التطبيق أبيض ثم انقلب ليلياً.
// Applied before first paint; otherwise the app flashes light then flips to dark.
try {
  const saved = localStorage.getItem('egco-theme');
  if (saved === 'dark' || saved === 'light') document.documentElement.dataset.theme = saved;
} catch { /* الوصول للتخزين قد يكون ممنوعاً */ }

createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App /></React.StrictMode>,
);
