import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { AppProvider } from './store.jsx';
import App from './App.jsx';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </React.StrictMode>,
);
