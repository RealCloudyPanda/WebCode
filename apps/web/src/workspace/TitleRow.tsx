import { useEffect, useState } from 'react';
import type { Me } from '@webcode/shared';
import { STATUS_COPY, type SyncStatus } from '../collab/useProject';
import type { Peer } from '../collab/presence';
import { Avatar } from '../components/Avatar';
import { TopBar } from '../components/TopBar';

type Props = {
  title: string;
  canEditTitle: boolean;
  onRename: (title: string) => void;
  starred: boolean;
  /** Only signed-in users can star. */
  canStar: boolean;
  onToggleStar: () => void;
  status: SyncStatus;
  peers: Peer[];
  onPeerClick: (peer: Peer) => void;
  onShare: () => void;
  me: Me | undefined;
};

export function statusText(status: SyncStatus): string {
  return status === 'connecting' ? 'Connecting…' : STATUS_COPY[status];
}

export function TitleRow({ title, canEditTitle, onRename, starred, canStar, onToggleStar, status, peers, onPeerClick, onShare, me }: Props) {
  const [draft, setDraft] = useState(title);
  useEffect(() => setDraft(title), [title]);
  const commit = () => {
    const t = draft.trim();
    if (!t) setDraft(title);
    else if (t !== title) onRename(t);
  };
  const next = encodeURIComponent(location.pathname + location.search);

  return (
    <TopBar
      center={
        <div className="title-block">
          {canEditTitle ? (
            <input
              className="title-input"
              aria-label="Project title"
              value={draft}
              maxLength={100}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
                if (e.key === 'Escape') {
                  setDraft(title);
                  e.currentTarget.blur();
                }
              }}
            />
          ) : (
            <span className="title-text">{title}</span>
          )}
          {canStar && (
            <button className="icon-btn sm" aria-label={starred ? 'Remove star' : 'Star project'} aria-pressed={starred} onClick={onToggleStar}>
              <span className={starred ? 'star' : ''}>{starred ? '★' : '☆'}</span>
            </button>
          )}
          <span className="sync-status" role="status">{statusText(status)}</span>
        </div>
      }
      trailing={
        <>
          <div className="peers">
            {peers.map((p) => (
              <button
                key={p.clientId}
                className="peer"
                title={p.user.name}
                aria-label={p.user.name}
                style={{ borderColor: p.user.color }}
                onClick={() => onPeerClick(p)}
              >
                <Avatar userId={p.user.kind === 'github' ? p.user.id : null} name={p.user.name} size={26} />
              </button>
            ))}
          </div>
          <button className="btn btn-primary" onClick={onShare}>Share</button>
          {me?.user ? (
            <Avatar userId={me.user.id} name={me.user.name ?? me.user.login} />
          ) : me?.guest ? (
            <Avatar name={me.guest.name} />
          ) : (
            <a className="btn" href={`/auth/github?next=${next}`}>Sign in</a>
          )}
        </>
      }
    />
  );
}
