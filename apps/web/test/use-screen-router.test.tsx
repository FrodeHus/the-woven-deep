import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useScreenRouter } from '../src/ui/hooks/useScreenRouter.js';

describe('useScreenRouter', () => {
  it('boots onto title with a zero fade token when not a quickstart', () => {
    const { result } = renderHook(() => useScreenRouter(false));
    expect(result.current.screen).toEqual({ screen: 'title' });
    expect(result.current.fadeToken).toBe(0);
  });

  it('boots straight onto play with a zero fade token under quickstart (the initial screen never fades)', () => {
    const { result } = renderHook(() => useScreenRouter(true));
    expect(result.current.screen).toEqual({ screen: 'play' });
    expect(result.current.fadeToken).toBe(0);
  });

  it('bumps the fade token only on the transitions to play and conclusion', () => {
    const { result } = renderHook(() => useScreenRouter(false));

    // No fade for title/signin/chargen/hall transitions.
    act(() => { result.current.toSignin(); });
    expect(result.current.screen).toEqual({ screen: 'signin' });
    expect(result.current.fadeToken).toBe(0);

    act(() => { result.current.toChargen(); });
    expect(result.current.fadeToken).toBe(0);

    // Confirm/Continue -> play fades.
    act(() => { result.current.toPlay(); });
    expect(result.current.screen).toEqual({ screen: 'play' });
    expect(result.current.fadeToken).toBe(1);

    // Death -> conclusion fades.
    act(() => { result.current.toConclusion(); });
    expect(result.current.screen).toEqual({ screen: 'conclusion' });
    expect(result.current.fadeToken).toBe(2);

    // Opening the hall from the conclusion does not fade.
    act(() => { result.current.toHall('conclusion'); });
    expect(result.current.screen).toEqual({ screen: 'hall', returnTo: 'conclusion' });
    expect(result.current.fadeToken).toBe(2);

    // Returning out of the hall onto the conclusion must NOT bump the fade token.
    act(() => { result.current.returnFromHall('conclusion'); });
    expect(result.current.screen).toEqual({ screen: 'conclusion' });
    expect(result.current.fadeToken).toBe(2);
  });

  it('returns from the hall onto the title screen without a fade', () => {
    const { result } = renderHook(() => useScreenRouter(false));
    act(() => { result.current.toHall('title'); });
    act(() => { result.current.returnFromHall('title'); });
    expect(result.current.screen).toEqual({ screen: 'title' });
    expect(result.current.fadeToken).toBe(0);
  });
});
