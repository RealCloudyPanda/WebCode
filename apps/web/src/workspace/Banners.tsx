import type { Me, ProjectDetail } from '@webcode/shared';
import type { ProjectRole } from '../collab/useProject';

type Props = {
  detail: ProjectDetail;
  me: Me;
  role: ProjectRole;
  sizeLocked: boolean;
  revoked: boolean;
  onStartOver: () => void;
};

export function Banners({ detail, me, role, sizeLocked, revoked, onStartOver }: Props) {
  const isOwner = role === 'owner';
  const demoCopy = detail.isDemoCopy && isOwner && !me.user && !!me.guest;
  const projectId = detail.id;
  return (
    <>
      {demoCopy && (
        <div className="banner" role="status">
          <span>This is your demo copy. It's deleted after 24 hours of inactivity.</span>
          <a className="banner-link" href={`/auth/github?next=${encodeURIComponent(`/p/${projectId}`)}`}>
            <strong>Sign in with GitHub to keep it</strong>
          </a>
          <button className="btn" onClick={onStartOver}>Start over</button>
        </div>
      )}
      {sizeLocked && (
        <div className="banner banner-warn" role="alert">
          {isOwner
            ? 'This project is over its size limit. Delete files to keep editing.'
            : 'This project is over its size limit. The owner needs to delete files.'}
        </div>
      )}
      {role === 'viewer' && (
        <div className="banner" role="status">
          You have view access. Changes from the terminal stay in your browser.
        </div>
      )}
      {revoked && (
        <div className="banner banner-warn" role="alert">
          You no longer have access
        </div>
      )}
    </>
  );
}
