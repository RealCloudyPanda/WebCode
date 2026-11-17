export type Mode = 'editing' | 'viewing';

const LANGUAGES: Record<string, string> = {
  ts: 'TypeScript', tsx: 'TypeScript React', js: 'JavaScript', jsx: 'JavaScript React', mjs: 'JavaScript', cjs: 'JavaScript',
  json: 'JSON', css: 'CSS', scss: 'SCSS', html: 'HTML', md: 'Markdown', py: 'Python', yml: 'YAML', yaml: 'YAML', sh: 'Shell',
};

export function languageLabel(path: string | null): string {
  if (!path) return 'Plain Text';
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  return path.includes('.') ? (LANGUAGES[ext] ?? 'Plain Text') : 'Plain Text';
}

type Props = {
  path: string | null;
  /** False for viewers: the dropdown only offers "Viewing". */
  canEdit: boolean;
  mode: Mode;
  onMode: (m: Mode) => void;
  onUndo: () => void;
  onRedo: () => void;
  onFormat: () => void;
  onSearch: () => void;
  onRun?: () => void;
  onTest?: () => void;
  /** Why running is unavailable (shown as a tooltip), if it is. */
  runBlockedReason?: string | null;
  installing?: boolean;
};

export function Toolbar(p: Props) {
  const editing = p.canEdit && p.mode === 'editing';
  const blocked = p.runBlockedReason ?? undefined;
  return (
    <div className="toolbar" role="toolbar" aria-label="Editor tools">
      <button className="tb" disabled={!editing} onClick={p.onUndo} aria-label="Undo" title="Undo">↶</button>
      <button className="tb" disabled={!editing} onClick={p.onRedo} aria-label="Redo" title="Redo">↷</button>
      <span className="sep" />
      <button className="tb" disabled={!p.onRun || !!blocked} title={blocked} onClick={p.onRun}>▶ Run</button>
      <button className="tb" disabled={!p.onTest || !!blocked} title={blocked} onClick={p.onTest}>✓ Test</button>
      {p.installing && <span className="tb-note">Installing dependencies…</span>}
      <span className="sep" />
      <button className="tb" disabled={!editing} onClick={p.onFormat}>Format</button>
      <span className="tb-lang">{languageLabel(p.path)}</span>
      <span className="sep" />
      <button className="tb" onClick={p.onSearch} aria-label="Search" title="Find in files">⌕ Search</button>
      <select
        className="mode"
        aria-label="Mode"
        value={p.canEdit ? p.mode : 'viewing'}
        disabled={!p.canEdit}
        onChange={(e) => p.onMode(e.target.value as Mode)}
      >
        {p.canEdit && <option value="editing">Editing</option>}
        <option value="viewing">Viewing</option>
      </select>
    </div>
  );
}
