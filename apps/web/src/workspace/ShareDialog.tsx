import { useState } from 'react';
import type { LinkAccess, ProjectDetail } from '@webcode/shared';
import { api } from '../api';
import { Avatar } from '../components/Avatar';
import { Dialog } from '../components/Dialog';
import { useToast } from '../components/Toast';

type Props = {
  detail: ProjectDetail;
  isOwner: boolean;
  onChange: (detail: ProjectDetail) => void;
  onClose: () => void;
};

export function ShareDialog({ detail, isOwner, onChange, onClose }: Props) {
  const toast = useToast();
  const restricted = detail.linkAccess === 'restricted';
  // Remembers the role while the link is restricted, so switching back restores it.
  const [linkRole, setLinkRole] = useState<'viewer' | 'editor'>(detail.linkAccess === 'editor' ? 'editor' : 'viewer');
  const [busy, setBusy] = useState(false);

  async function save(linkAccess: LinkAccess) {
    setBusy(true);
    try {
      onChange(await api.patch<ProjectDetail>(`/api/projects/${encodeURIComponent(detail.id)}`, { linkAccess }));
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not change sharing');
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(`${location.origin}/p/${detail.id}`);
      toast('Link copied');
    } catch {
      toast('Could not copy the link');
    }
  }

  const people = [...detail.people].sort((a, b) => Number(b.role === 'owner') - Number(a.role === 'owner'));

  return (
    <Dialog title={`Share "${detail.title}"`} onClose={onClose}>
      <div className="stack">
        <section className="stack" aria-label="Link access">
          <div className="share-access">
            <select
              className="select"
              aria-label="General access"
              disabled={!isOwner || busy}
              value={restricted ? 'restricted' : 'anyone'}
              onChange={(e) => void save(e.target.value === 'restricted' ? 'restricted' : linkRole)}
            >
              <option value="restricted">Restricted</option>
              <option value="anyone">Anyone with the link</option>
            </select>
            <select
              className="select"
              aria-label="Link role"
              disabled={!isOwner || busy || restricted}
              value={linkRole}
              onChange={(e) => {
                const role = e.target.value as 'viewer' | 'editor';
                setLinkRole(role);
                void save(role);
              }}
            >
              <option value="viewer">Viewer</option>
              <option value="editor">Editor</option>
            </select>
          </div>
          <p className="muted share-help">
            {restricted ? 'Only you can open this link' : `Anyone with the link can ${linkRole === 'editor' ? 'edit' : 'view'}`}
          </p>
        </section>

        <section aria-label="People with access">
          <h3 className="share-h">People with access</h3>
          <ul className="share-people">
            {people.map((p) => (
              <li key={p.userId}>
                <Avatar userId={p.userId} name={p.name ?? p.login} size={28} />
                <span className="share-name">{p.name ?? p.login}</span>
                <span className="role-badge">{p.role === 'owner' ? 'Owner' : p.role === 'editor' ? 'Editor' : 'Viewer'}</span>
              </li>
            ))}
          </ul>
          {detail.guestCount > 0 && (
            <p className="muted">and {detail.guestCount} {detail.guestCount === 1 ? 'guest' : 'guests'}</p>
          )}
        </section>

        <div className="row-end">
          <button className="btn" onClick={() => void copy()}>Copy link</button>
          <button className="btn btn-primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </Dialog>
  );
}
