import { useReducer } from 'react';

/**
 * The client-side screen state machine: title (the landing menu) -> chargen (the wizard) -> play
 * (the live run) -> conclusion -> hall (the Hall of Records, reachable from either title or
 * conclusion, hence `returnTo`).
 */
export type ScreenState =
  | { readonly screen: 'title' }
  | { readonly screen: 'signin' }
  | { readonly screen: 'chargen' }
  | { readonly screen: 'play' }
  | { readonly screen: 'conclusion' }
  | { readonly screen: 'hall'; readonly returnTo: 'title' | 'conclusion' };

interface ScreenRouterState {
  readonly screen: ScreenState;
  /** Bumped exactly at the three screen-level transitions the design calls out for a fade-through-
   * dark (title->play via Continue, chargen->play via Confirm, play->conclusion on death) --
   * `ScreenFade` fades whenever this changes. Every OTHER screen switch (title->chargen, hall in
   * and out of either direction, conclusion->title/chargen for a new hero) leaves it untouched, so
   * it stays the instant conditional return it always was. */
  readonly fadeToken: number;
}

/** Named screen transitions. Transitions to `play` and `conclusion` bump the fade token; every
 * other transition — including returning out of the hall back onto the conclusion screen — leaves
 * it untouched. */
type ScreenRouterAction =
  | { readonly type: 'title' }
  | { readonly type: 'signin' }
  | { readonly type: 'chargen' }
  | { readonly type: 'play' }
  | { readonly type: 'conclusion' }
  | { readonly type: 'hall'; readonly returnTo: 'title' | 'conclusion' }
  | { readonly type: 'return-from-hall'; readonly returnTo: 'title' | 'conclusion' };

function screenRouterReducer(
  state: ScreenRouterState,
  action: ScreenRouterAction,
): ScreenRouterState {
  switch (action.type) {
    case 'title':
      return { screen: { screen: 'title' }, fadeToken: state.fadeToken };
    case 'signin':
      return { screen: { screen: 'signin' }, fadeToken: state.fadeToken };
    case 'chargen':
      return { screen: { screen: 'chargen' }, fadeToken: state.fadeToken };
    case 'hall':
      return { screen: { screen: 'hall', returnTo: action.returnTo }, fadeToken: state.fadeToken };
    case 'return-from-hall':
      return { screen: { screen: action.returnTo }, fadeToken: state.fadeToken };
    case 'play':
      return { screen: { screen: 'play' }, fadeToken: state.fadeToken + 1 };
    case 'conclusion':
      return { screen: { screen: 'conclusion' }, fadeToken: state.fadeToken + 1 };
  }
}

export interface ScreenRouter {
  readonly screen: ScreenState;
  readonly fadeToken: number;
  readonly toTitle: () => void;
  readonly toSignin: () => void;
  readonly toChargen: () => void;
  readonly toHall: (returnTo: 'title' | 'conclusion') => void;
  /** Leave the hall back onto whichever screen opened it, without a fade. */
  readonly returnFromHall: (returnTo: 'title' | 'conclusion') => void;
  readonly toPlay: () => void;
  readonly toConclusion: () => void;
}

/**
 * Owns `ScreenState` and the fade token together, exposing one named transition per screen switch.
 * `quickstart` boots straight onto play (the `?quickstart=1` shortcut); every other boot starts on
 * the title menu. The initial screen never fades — the fade token starts at 0 and `ScreenFade`
 * renders nothing on first mount.
 */
export function useScreenRouter(quickstart: boolean): ScreenRouter {
  const [state, dispatch] = useReducer(
    screenRouterReducer,
    quickstart,
    (qs): ScreenRouterState => ({
      screen: qs ? { screen: 'play' } : { screen: 'title' },
      fadeToken: 0,
    }),
  );

  return {
    screen: state.screen,
    fadeToken: state.fadeToken,
    toTitle: () => dispatch({ type: 'title' }),
    toSignin: () => dispatch({ type: 'signin' }),
    toChargen: () => dispatch({ type: 'chargen' }),
    toHall: (returnTo) => dispatch({ type: 'hall', returnTo }),
    returnFromHall: (returnTo) => dispatch({ type: 'return-from-hall', returnTo }),
    toPlay: () => dispatch({ type: 'play' }),
    toConclusion: () => dispatch({ type: 'conclusion' }),
  };
}
