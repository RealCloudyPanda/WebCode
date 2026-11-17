import { useState } from 'react';

export function PreviewPanel({ url, onClose }: { url: string; onClose: () => void }) {
  const [reloads, setReloads] = useState(0);
  return (
    <aside className="preview" aria-label="Preview">
      <div className="preview-bar">
        <input className="input" readOnly aria-label="Preview address" value={url} />
        <button className="icon-btn sm" aria-label="Reload preview" title="Reload" onClick={() => setReloads((n) => n + 1)}>↻</button>
        <a className="icon-btn sm" aria-label="Open in new tab" title="Open in new tab" href={url} target="_blank" rel="noopener noreferrer">↗</a>
        <button className="icon-btn sm" aria-label="Close preview" title="Close" onClick={onClose}>×</button>
      </div>
      <iframe key={reloads} className="preview-frame" title="App preview" src={url} allow="cross-origin-isolated" />
    </aside>
  );
}
