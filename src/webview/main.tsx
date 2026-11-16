import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { ErrorBoundary, RuntimeErrors } from './errors.js';
import './styles.css';

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <>
      <RuntimeErrors />
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </>,
  );
}
