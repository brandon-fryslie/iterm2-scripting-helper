import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { StoreProvider } from './stores/context';
import { RootStore } from './stores/RootStore';
import './styles/globals.css';

const rootStore = new RootStore();
const container = document.getElementById('root');
if (!container) throw new Error('#root element missing from index.html');

ReactDOM.createRoot(container).render(
  <React.StrictMode>
    <StoreProvider value={rootStore}>
      <App />
    </StoreProvider>
  </React.StrictMode>,
);
