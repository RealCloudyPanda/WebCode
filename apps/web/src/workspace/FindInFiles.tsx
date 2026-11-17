import { useMemo, useState } from 'react';
import type * as Y from 'yjs';
import { docToFiles } from '@webcode/shared';

type Hit = { path: string; line: number; text: string };
const MAX_HITS = 200;

export function searchFiles(files: Record<string, string>, query: string): Hit[] {
  const q = query.toLowerCase();
  const hits: Hit[] = [];
  if (!q) return hits;
  for (const [path, content] of Object.entries(files).sort(([a], [b]) => (a < b ? -1 : 1))) {
    const lines = content.split('\n');
    for (let i = 0; i < lines.length && hits.length < MAX_HITS; i++) {
      if (lines[i]!.toLowerCase().includes(q)) hits.push({ path, line: i + 1, text: lines[i]!.trim().slice(0, 120) });
    }
  }
  return hits;
}

export function FindInFiles({ doc, onOpen, onClose }: { doc: Y.Doc; onOpen: (path: string) => void; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const hits = useMemo(() => searchFiles(docToFiles(doc), query), [doc, query]);
  return (
    <section className="find-panel" aria-label="Find in files">
      <div className="find-head">
        <input className="input" autoFocus placeholder="Find in files" aria-label="Find in files" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button className="icon-btn sm" aria-label="Close search" onClick={onClose}>×</button>
      </div>
      <ul className="find-hits">
        {hits.map((h) => (
          <li key={`${h.path}:${h.line}`}>
            <button onClick={() => onOpen(h.path)}>
              <span className="find-loc">{h.path}:{h.line}</span> <span className="muted">{h.text}</span>
            </button>
          </li>
        ))}
        {query && hits.length === 0 && <li className="muted find-none">No matches</li>}
      </ul>
    </section>
  );
}
