import { useEffect, useState } from 'react';
import { loadContentSummary, type ContentSummary } from './api.js';
import './styles.css';

export function App({ fetcher = fetch }: { fetcher?: typeof fetch }) {
  const [summary, setSummary] = useState<ContentSummary>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    void loadContentSummary(fetcher).then(setSummary, (reason: unknown) => {
      setError(reason instanceof Error ? reason.message : 'The content service is unavailable.');
    });
  }, [fetcher]);

  return <main className="shell">
    <p className="eyebrow">The Woven Deep · foundation diagnostic</p>
    <h1>The archive is listening.</h1>
    {error && <p role="alert">{error}</p>}
    {!summary && !error && <p role="status">Binding the current content pack…</p>}
    {summary && <section className="tapestry" aria-label="Compiled content summary">
      <strong>{summary.entries} entries bound</strong>
      <span>{summary.counts.monster} monster</span>
      <span>{summary.counts.item} item</span>
      <code>{summary.hash}</code>
    </section>}
  </main>;
}
