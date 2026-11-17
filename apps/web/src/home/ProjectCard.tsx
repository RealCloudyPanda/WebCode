import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import type { ProjectSummary } from '@webcode/shared';

function formatOpened(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return `Opened ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}

type Props = {
  project: ProjectSummary;
  onRename: (title: string) => void;
  onRemove: () => void;
};

export function ProjectCard({ project, onRename, onRemove }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(project.title);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen]);

  function commitRename() {
    const t = draft.trim();
    setRenaming(false);
    if (t && t !== project.title) onRename(t);
  }

  return (
    <div className="card" ref={ref}>
      <Link to={`/p/${project.id}`} className="card-link" tabIndex={renaming ? -1 : 0}>
        <div className="prev">{project.previewText}</div>
        <div className="meta">
          {renaming ? null : (
            <div className="t">
              {project.starred && <span className="star" aria-label="Starred">★ </span>}
              {project.title}
            </div>
          )}
          {renaming && <div className="t">&nbsp;</div>}
          <div className="s">
            {project.liveCount > 0 ? (
              <span className="live"><span className="dot" />{project.liveCount} here now</span>
            ) : (
              <span>{formatOpened(project.lastOpenedAt)}</span>
            )}
            {!project.isOwner && <span>Shared</span>}
          </div>
        </div>
      </Link>
      {renaming && (
        <input
          className="input rename-input"
          style={{ position: 'absolute', left: 12, top: 130 }}
          aria-label="Project name"
          value={draft}
          autoFocus
          maxLength={100}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitRename();
            if (e.key === 'Escape') setRenaming(false);
          }}
        />
      )}
      <button className="icon-btn more" aria-label="More actions" aria-haspopup="menu" onClick={() => setMenuOpen((o) => !o)}>
        ⋮
      </button>
      {menuOpen && (
        <div className="menu" role="menu">
          <button
            role="menuitem"
            onClick={() => {
              setMenuOpen(false);
              setDraft(project.title);
              setRenaming(true);
            }}
          >
            Rename
          </button>
          <button
            role="menuitem"
            onClick={() => {
              setMenuOpen(false);
              onRemove();
            }}
          >
            Remove
          </button>
          <a role="menuitem" href={`/p/${project.id}`} target="_blank" rel="noreferrer" onClick={() => setMenuOpen(false)}>
            Open in new tab
          </a>
        </div>
      )}
    </div>
  );
}
