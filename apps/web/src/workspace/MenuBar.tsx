import { useEffect, useRef, useState } from 'react';
import { Dialog } from '../components/Dialog';

export type MenuActions = {
  newFile: () => void;
  newFolder: () => void;
  rename: () => void;
  remove: () => void;
  /** Undefined disables the item; `copyDisabledReason` explains why. */
  makeCopy?: () => void;
  copyDisabledReason?: string;
  downloadZip: () => void;
  share: () => void;
  undo: () => void;
  redo: () => void;
  find: () => void;
  replace: () => void;
  findInFiles: () => void;
  toggleExplorer: () => void;
  toggleTerminal: () => void;
  togglePreview: () => void;
  toggleCursors: () => void;
  run?: () => void;
  test?: () => void;
  stop?: () => void;
  reinstall?: () => void;
  newTerminal?: () => void;
  clearTerminal?: () => void;
};

type Item = { label: string; onClick?: () => void; title?: string };
type Menu = { label: string; items: Item[] };

const REPO_URL = 'https://github.com/RealCloudyPanda/WebCode';

export function MenuBar({ a, readOnly }: { a: MenuActions; readOnly: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  const [help, setHelp] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(null);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const edit = (fn: () => void) => (readOnly ? undefined : fn);
  const menus: Menu[] = [
    {
      label: 'File',
      items: [
        { label: 'New file', onClick: edit(a.newFile) },
        { label: 'New folder', onClick: edit(a.newFolder) },
        { label: 'Rename', onClick: edit(a.rename) },
        { label: 'Delete', onClick: edit(a.remove) },
        { label: 'Make a copy', onClick: a.makeCopy, title: a.makeCopy ? undefined : a.copyDisabledReason },
        { label: 'Download as .zip', onClick: a.downloadZip },
        { label: 'Share', onClick: a.share },
      ],
    },
    {
      label: 'Edit',
      items: [
        { label: 'Undo', onClick: edit(a.undo) },
        { label: 'Redo', onClick: edit(a.redo) },
        { label: 'Find', onClick: a.find },
        { label: 'Replace', onClick: edit(a.replace) },
        { label: 'Find in files', onClick: a.findInFiles },
      ],
    },
    {
      label: 'View',
      items: [
        { label: 'Toggle file explorer', onClick: a.toggleExplorer },
        { label: 'Toggle terminal', onClick: a.toggleTerminal },
        { label: 'Toggle preview', onClick: a.togglePreview },
        { label: "Show/hide others' cursors", onClick: a.toggleCursors },
      ],
    },
    {
      label: 'Run',
      items: [
        { label: 'Run app', onClick: a.run },
        { label: 'Run tests', onClick: a.test },
        { label: 'Stop', onClick: a.stop },
        { label: 'Reinstall dependencies', onClick: a.reinstall },
      ],
    },
    {
      label: 'Terminal',
      items: [
        { label: 'New terminal', onClick: a.newTerminal },
        { label: 'Clear', onClick: a.clearTerminal },
      ],
    },
    {
      label: 'Help',
      items: [
        { label: 'Keyboard shortcuts', onClick: () => setHelp(true) },
        { label: 'About Webcode', onClick: () => window.open(REPO_URL, '_blank', 'noopener') },
      ],
    },
  ];

  return (
    <nav className="menubar" ref={ref} aria-label="Menu">
      {menus.map((m) => (
        <div key={m.label} className="menubar-item">
          <button
            className={`menubar-btn${open === m.label ? ' on' : ''}`}
            aria-haspopup="menu"
            aria-expanded={open === m.label}
            onClick={() => setOpen(open === m.label ? null : m.label)}
            onMouseEnter={() => open && setOpen(m.label)}
          >
            {m.label}
          </button>
          {open === m.label && (
            <div className="menu menu-left" role="menu">
              {m.items.map((it) => (
                <button
                  key={it.label}
                  role="menuitem"
                  disabled={!it.onClick}
                  title={it.title}
                  onClick={() => {
                    setOpen(null);
                    it.onClick?.();
                  }}
                >
                  {it.label}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
      {help && (
        <Dialog title="Keyboard shortcuts" onClose={() => setHelp(false)}>
          <dl className="shortcuts">
            <dt>Find</dt><dd>Ctrl/Cmd + F</dd>
            <dt>Replace</dt><dd>Ctrl/Cmd + H</dd>
            <dt>Undo / Redo</dt><dd>Ctrl/Cmd + Z / Shift + Z</dd>
            <dt>Command palette</dt><dd>F1</dd>
            <dt>Format document</dt><dd>Shift + Alt + F</dd>
          </dl>
          <div className="row-end"><button className="btn btn-primary" onClick={() => setHelp(false)}>Done</button></div>
        </Dialog>
      )}
    </nav>
  );
}
