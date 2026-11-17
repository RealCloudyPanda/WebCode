import type { TemplateInfo } from '@webcode/shared';

const THUMBS: Record<string, string> = {
  'react-app': "import React\nexport default\n App()\n// vite",
  'node-api': "app.get('/',\n (req, res)\n => ...)",
  'ts-library': 'export function\n slugify()\n// vitest',
};

type Props = {
  templates: TemplateInfo[];
  busy: boolean;
  onPick: (name: string) => void;
  onImport: () => void;
};

export function TemplateRow({ templates, busy, onPick, onImport }: Props) {
  return (
    <section className="band" aria-label="Start a new project">
      <div className="inner">
        <div className="row-h"><span>Start a new project</span></div>
        <div className="tpls">
          {templates.map((t) => (
            <button key={t.name} className="tpl" aria-label={t.label} disabled={busy} onClick={() => onPick(t.name)}>
              {t.name === 'blank' ? (
                <div className="thumb big" aria-hidden="true">+</div>
              ) : (
                <div className="thumb" aria-hidden="true">{THUMBS[t.name] ?? ''}</div>
              )}
              <div className="nm">{t.label}</div>
              <div className="sub">{t.sub}</div>
            </button>
          ))}
          <button className="tpl" aria-label="Import" onClick={onImport}>
            <div className="thumb big" aria-hidden="true">⤓</div>
            <div className="nm">Import</div>
            <div className="sub">from GitHub</div>
          </button>
        </div>
      </div>
    </section>
  );
}
