import { useEffect, useState, type FormEvent, type JSX } from 'react';
import { requestLogin } from '../../api.js';
import { Button } from '../components/button.js';
import { Input } from '../components/input.js';
import { Label } from '../components/label.js';

export interface SignInScreenProps {
  /** Same test seam as `App`'s own `fetcher` prop -- threaded straight through to `requestLogin`,
   * defaulting to the real global `fetch`. */
  readonly fetcher?: typeof fetch;
  readonly onBack: () => void;
}

/**
 * The uniform confirmation shown after a sign-in request, regardless of whether the email exists,
 * the request succeeded, or it failed outright -- the security requirement (spec: "uniform login
 * responses regardless of email existence") extends to the client: this copy must never change
 * based on what `requestLogin` did, or the UI itself becomes an oracle for email existence.
 */
const CONFIRMATION_MESSAGE = 'If that email can sign in, a link is on its way. Check your mail.';

/**
 * The title menu's "Sign in with email" destination: a single email field + submit. On submit,
 * `requestLogin` is fired and its outcome -- resolved OR rejected -- is deliberately discarded in
 * favor of the same confirmation panel every time (see `CONFIRMATION_MESSAGE`'s doc comment).
 * Esc (document-level, mirroring `HallScreen`) or the Back button return to the title screen.
 */
export function SignInScreen({ fetcher = fetch, onBack }: SignInScreenProps): JSX.Element {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);

  // A document-level listener (rather than an onKeyDown on the section) so Escape returns to
  // title even before the input has taken focus -- same convention as `HallScreen`.
  useEffect(() => {
    function handleDocumentKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') onBack();
    }
    document.addEventListener('keydown', handleDocumentKeyDown);
    return () => document.removeEventListener('keydown', handleDocumentKeyDown);
  }, [onBack]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    try {
      await requestLogin(email, fetcher);
    } catch {
      // Deliberately swallowed -- see `CONFIRMATION_MESSAGE`'s doc comment. Neither a network
      // failure nor a non-existent email may produce a different outcome here.
    }
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <section aria-label="Sign in" className="mx-auto flex max-w-md flex-col gap-3 p-6">
        <p role="status" className="text-sm text-fg">{CONFIRMATION_MESSAGE}</p>
        <Button type="button" variant="outline" className="self-start" onClick={onBack}>Back to title</Button>
      </section>
    );
  }

  return (
    <section aria-label="Sign in" className="mx-auto flex max-w-md flex-col gap-3 p-6">
      <h1 className="font-serif text-2xl text-accent-strong">Sign in with email</h1>
      <form className="flex flex-col gap-3" onSubmit={(event) => { void handleSubmit(event); }}>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="signin-email">Email</Label>
          <Input
            id="signin-email"
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoFocus
          />
        </div>
        <Button type="submit" className="self-start">Send sign-in link</Button>
      </form>
      <Button type="button" variant="outline" className="self-start" onClick={onBack}>Back</Button>
    </section>
  );
}
