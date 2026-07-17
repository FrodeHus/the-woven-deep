import type { AuthConfig } from '../config.js';

export interface MailTransport {
  sendLoginLink(input: Readonly<{ email: string; link: string }>): Promise<void>;
  // dev transport only:
  lastLinkFor?(email: string): string | undefined;
}

const MAILGUN_SUBJECT = 'Your Woven Deep sign-in link';

// NOTE: Task 5 owns the canonical `normalizeEmail` (apps/server/src/auth/email.ts, not yet
// landed). Until it exists, the dev transport keys its map by this local trim+lowercase+NFC
// normalization, which mirrors the rule described in the plan. Thread in the real
// `normalizeEmail` here once Task 5 lands.
function normalizeEmailLocally(email: string): string {
  return email.trim().toLowerCase().normalize('NFC');
}

function createDevMailTransport(): MailTransport {
  const links = new Map<string, string>();

  return {
    async sendLoginLink({ email, link }) {
      links.set(normalizeEmailLocally(email), link);
    },
    lastLinkFor(email: string): string | undefined {
      return links.get(normalizeEmailLocally(email));
    },
  };
}

function createMailgunTransport(
  mailgun: Readonly<{ apiKey: string; domain: string; sender: string }>,
  fetchImpl: typeof fetch,
): MailTransport {
  return {
    async sendLoginLink({ email, link }) {
      const auth = Buffer.from(`api:${mailgun.apiKey}`).toString('base64');
      const body = new URLSearchParams({
        from: mailgun.sender,
        to: email,
        subject: MAILGUN_SUBJECT,
        text: `Sign in to Woven Deep using this link: ${link}\n\nThis link expires in 15 minutes and can only be used once.`,
      });

      const response = await fetchImpl(`https://api.mailgun.net/v3/${mailgun.domain}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      });

      if (!response.ok) {
        throw new Error(`Mailgun send failed with status ${response.status}`);
      }
    },
  };
}

export function createMailTransport(config: AuthConfig, fetchImpl: typeof fetch = fetch): MailTransport {
  if (config.mailgun === null) {
    return createDevMailTransport();
  }

  return createMailgunTransport(config.mailgun, fetchImpl);
}
