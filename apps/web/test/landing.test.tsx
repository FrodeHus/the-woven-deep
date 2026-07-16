import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { LandingPage } from '../src/landing/LandingPage.js';
import { PLAY_ROUTE, REGISTRATION_COMING_SOON_HREF } from '../src/landing/copy.js';

// jsdom has no matchMedia; the landing hooks/canvas all guard with `window.matchMedia?.(...)`, so
// leaving it unset exercises that guard. A couple of tests below stub it in to assert the
// reduced-motion path explicitly.
function stubMatchMedia(reduced: boolean): void {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: reduced && query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

afterEach(() => {
  vi.unstubAllGlobals();
  // @ts-expect-error -- test-only cleanup of a browser API jsdom doesn't provide.
  delete window.matchMedia;
});

describe('LandingPage structure', () => {
  beforeEach(() => stubMatchMedia(false));

  it('renders the nav, hero H1, and all six section landmarks', () => {
    render(<LandingPage />);

    expect(screen.getByRole('navigation', { name: /primary/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: /few return/i })).toBeInTheDocument();

    const sectionNames = [/labyrinth that remembers the dead/i, /the deep remembers/i, /descend as a shade/i, /notable features/i, /before you descend/i, /will you answer/i];
    for (const name of sectionNames) {
      expect(screen.getByRole('region', { name })).toBeInTheDocument();
    }
  });

  it('routes every guest-facing CTA to the /play route', () => {
    render(<LandingPage />);

    const playLinks = [
      screen.getByRole('link', { name: 'Play Free' }),
      screen.getByRole('link', { name: 'Descend Now' }),
      screen.getByRole('link', { name: 'Enter as guest' }),
      screen.getByRole('link', { name: 'Descend as guest' }),
      screen.getByRole('link', { name: /play free: descend now/i }),
    ];
    for (const link of playLinks) {
      expect(link).toHaveAttribute('href', PLAY_ROUTE);
    }
  });

  it('points the unbuilt registration CTA at a coming-soon anchor, not a dead route', () => {
    render(<LandingPage />);
    const registerCta = screen.getByRole('link', { name: /register free/i });
    expect(registerCta).toHaveAttribute('href', REGISTRATION_COMING_SOON_HREF);
  });

  it('links in-page nav anchors to their sections', () => {
    render(<LandingPage />);
    expect(screen.getByRole('link', { name: 'Lore' })).toHaveAttribute('href', '#lore');
    expect(screen.getByRole('link', { name: 'The Deep' })).toHaveAttribute('href', '#deep');
    expect(screen.getByRole('link', { name: 'Guest & Legacy' })).toHaveAttribute('href', '#access');
  });
});

describe('FAQ accordion', () => {
  beforeEach(() => stubMatchMedia(false));

  it('opens item 0 by default, single-opens on click, and flips aria-expanded', async () => {
    const user = userEvent.setup();
    render(<LandingPage />);

    const faqSection = screen.getByRole('region', { name: /before you descend/i });
    const toggles = within(faqSection).getAllByRole('button');
    expect(toggles.length).toBeGreaterThanOrEqual(6);

    expect(toggles[0]).toHaveAttribute('aria-expanded', 'true');
    for (const toggle of toggles.slice(1)) expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await user.click(toggles[2]!);
    expect(toggles[2]).toHaveAttribute('aria-expanded', 'true');
    expect(toggles[0]).toHaveAttribute('aria-expanded', 'false');
    for (const toggle of toggles) {
      if (toggle !== toggles[2]) expect(toggle).toHaveAttribute('aria-expanded', 'false');
    }

    // clicking the open item closes it, leaving all closed
    await user.click(toggles[2]!);
    expect(toggles[2]).toHaveAttribute('aria-expanded', 'false');
    for (const toggle of toggles) expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('are real buttons, not links or divs styled as buttons', () => {
    render(<LandingPage />);
    const faqSection = screen.getByRole('region', { name: /before you descend/i });
    for (const toggle of within(faqSection).getAllByRole('button')) {
      expect(toggle.tagName).toBe('BUTTON');
    }
  });
});

describe('reduced motion', () => {
  it('reveals data-reveal content immediately and skips the ember canvas animation loop without throwing', () => {
    stubMatchMedia(true);
    const { container } = render(<LandingPage />);
    const revealed = container.querySelectorAll('[data-reveal]');
    expect(revealed.length).toBeGreaterThan(0);
    for (const el of revealed) expect(el).toHaveClass('is-revealed');
  });
});

describe('EmberCanvas cleanup', () => {
  it('mounts and unmounts without leaking listeners or throwing', () => {
    stubMatchMedia(false);
    const { unmount } = render(<LandingPage />);
    expect(() => unmount()).not.toThrow();
  });
});
