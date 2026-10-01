import { StrictMode, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

const Spotlight = lazy(() => import('./Spotlight.jsx'));
const isSpotlight = location.hash.startsWith('#/spotlight');

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {isSpotlight ? (
      <Suspense fallback={null}>
        <Spotlight />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
);
