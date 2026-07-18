import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './ui/theme/tokens.css';
import { App } from './App.js';
import { LandingPage } from './landing/LandingPage.js';
import { PLAY_ROUTE } from './landing/copy.js';

/**
 * No router dependency: a single path check decides between the marketing landing page (every
 * other path, including `/`) and the guest game (`/play`, and only `/play` — query strings like
 * `/play?seed=...` still match, since routing only inspects `pathname`). CTAs on the landing page
 * are plain `<a href="/play">` links, so entering the game is a normal browser navigation, not a
 * client-side route change.
 */
function Root() {
  const isPlayRoute = window.location.pathname === PLAY_ROUTE;
  return isPlayRoute ? <App /> : <LandingPage />;
}

createRoot(document.getElementById('root')!).render(<StrictMode><Root /></StrictMode>);
