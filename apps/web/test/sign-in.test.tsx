import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { SignInScreen } from '../src/ui/screens/SignInScreen.js';

const CONFIRMATION = /if that email can sign in, a link is on its way/i;

describe('SignInScreen', () => {
  it('focuses the email input on mount', () => {
    render(<SignInScreen onBack={vi.fn()} />);

    expect(screen.getByLabelText(/email/i)).toHaveFocus();
  });

  it('calls requestLogin with the typed email, then shows the uniform confirmation, on success', async () => {
    const user = userEvent.setup();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    render(<SignInScreen fetcher={fetcher as unknown as typeof fetch} onBack={vi.fn()} />);

    await user.type(screen.getByLabelText(/email/i), 'player@example.com');
    await user.click(screen.getByRole('button', { name: /send sign-in link/i }));

    expect(await screen.findByText(CONFIRMATION)).toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledWith(
      '/api/auth/login',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ email: 'player@example.com' }),
      }),
    );
  });

  it('shows the SAME uniform confirmation even when the request rejects outright -- no existence/error leak', async () => {
    const user = userEvent.setup();
    const fetcher = vi.fn().mockRejectedValueOnce(new Error('network down'));

    render(<SignInScreen fetcher={fetcher as unknown as typeof fetch} onBack={vi.fn()} />);

    await user.type(screen.getByLabelText(/email/i), 'nope@example.com');
    await user.click(screen.getByRole('button', { name: /send sign-in link/i }));

    expect(await screen.findByText(CONFIRMATION)).toBeInTheDocument();
    expect(screen.queryByText(/error|fail|down/i)).not.toBeInTheDocument();
  });

  it('Escape returns to title via onBack', () => {
    const onBack = vi.fn();
    render(<SignInScreen onBack={onBack} />);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('the Back button returns to title via onBack', async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    render(<SignInScreen onBack={onBack} />);

    await user.click(screen.getByRole('button', { name: /^back$/i }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('after the confirmation panel, "Back to title" still returns to title via onBack', async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    render(<SignInScreen fetcher={fetcher as unknown as typeof fetch} onBack={onBack} />);
    await user.type(screen.getByLabelText(/email/i), 'player@example.com');
    await user.click(screen.getByRole('button', { name: /send sign-in link/i }));

    await user.click(await screen.findByRole('button', { name: /back to title/i }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
