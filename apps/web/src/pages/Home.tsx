import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import type { ProjectSummary, TemplateInfo } from '@webcode/shared';
import { api } from '../api';
import { Avatar } from '../components/Avatar';
import { Dialog } from '../components/Dialog';
import { useToast } from '../components/Toast';
import { TopBar } from '../components/TopBar';
import { ImportDialog } from '../home/ImportDialog';
import { ProjectGrid } from '../home/ProjectGrid';
import { TemplateRow } from '../home/TemplateRow';
import { useMe } from '../session';

type Filter = 'any' | 'mine' | 'shared';
type Sort = 'opened' | 'title';

export function Home() {
  const { me, refresh } = useMe();
  const navigate = useNavigate();
  const toast = useToast();
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [filter, setFilter] = useState<Filter>('any');
  const [sort, setSort] = useState<Sort>('opened');
  const [query, setQuery] = useState('');
  const [importing, setImporting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState<ProjectSummary | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      setProjects(await api.get<ProjectSummary[]>(`/api/projects?filter=${filter}&sort=${sort}`));
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not load projects');
      setProjects((p) => p ?? []);
    }
  }, [filter, sort, toast]);

  useEffect(() => {
    api.get<TemplateInfo[]>('/api/templates').then(setTemplates).catch(() => {});
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 30_000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen]);

  async function create(template: string) {
    setCreating(true);
    try {
      const { id } = await api.post<{ id: string }>('/api/projects', { template });
      navigate(`/p/${id}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not create the project');
      setCreating(false);
    }
  }

  async function rename(p: ProjectSummary, title: string) {
    try {
      await api.patch(`/api/projects/${p.id}`, { title });
      setProjects((list) => list?.map((x) => (x.id === p.id ? { ...x, title } : x)) ?? null);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not rename');
    }
  }

  async function remove(p: ProjectSummary) {
    setRemoving(null);
    try {
      await api.del(`/api/projects/${p.id}`);
      setProjects((list) => list?.filter((x) => x.id !== p.id) ?? null);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not remove');
    }
  }

  async function signOut() {
    await api.post('/auth/logout').catch(() => {});
    await refresh();
    navigate('/');
  }

  const q = query.trim().toLowerCase();
  const shown = (projects ?? []).filter((p) => p.title.toLowerCase().includes(q));
  const user = me?.user;

  return (
    <>
      <TopBar
        leading={<button className="icon-btn" aria-label="Main menu">☰</button>}
        center={
          <input
            className="pill-input home-search"
            type="search"
            placeholder="Search projects"
            aria-label="Search projects"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        }
        trailing={
          user && (
            <div ref={menuRef} style={{ position: 'relative' }}>
              <button className="icon-btn" aria-label="Account menu" onClick={() => setMenuOpen((o) => !o)}>
                <Avatar userId={user.id} name={user.name ?? user.login} />
              </button>
              {menuOpen && (
                <div className="menu" role="menu">
                  <div className="muted" style={{ padding: '8px 16px' }}>{user.login}</div>
                  <button role="menuitem" onClick={signOut}>Sign out</button>
                </div>
              )}
            </div>
          )
        }
      />
      <TemplateRow templates={templates} busy={creating} onPick={create} onImport={() => setImporting(true)} />
      <section className="inner projects" aria-label="Recent projects">
        <div className="row-h">
          <span>Recent projects</span>
          <span className="controls">
            <select className="select" aria-label="Filter" value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
              <option value="any">Owned by anyone</option>
              <option value="mine">Owned by me</option>
              <option value="shared">Shared with me</option>
            </select>
            <button
              className="btn"
              aria-label="Sort order"
              onClick={() => setSort((s) => (s === 'opened' ? 'title' : 'opened'))}
            >
              {sort === 'opened' ? 'Last opened' : 'Title'}
            </button>
          </span>
        </div>
        {projects && shown.length === 0 ? (
          <p className="empty">
            {projects.length === 0 ? 'No projects yet. Start one above.' : 'No projects match your search.'}
          </p>
        ) : (
          <ProjectGrid
            projects={shown}
            onRename={rename}
            onRemove={(p) => (p.isOwner ? setRemoving(p) : void remove(p))}
          />
        )}
      </section>
      {importing && <ImportDialog onClose={() => setImporting(false)} />}
      {removing && (
        <Dialog title="Delete project" onClose={() => setRemoving(null)}>
          <p>Delete "{removing.title}"? This can't be undone.</p>
          <div className="row-end">
            <button className="btn" onClick={() => setRemoving(null)}>Cancel</button>
            <button className="btn btn-danger" onClick={() => void remove(removing)}>Delete</button>
          </div>
        </Dialog>
      )}
    </>
  );
}
