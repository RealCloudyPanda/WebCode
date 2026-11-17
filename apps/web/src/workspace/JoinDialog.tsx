import { useState } from 'react';
import { Dialog } from '../components/Dialog';
import { joinAsGuest, lastGuestName } from '../session';

export function JoinDialog({ onJoined, onClose }: { onJoined: () => void; onClose?: () => void }) {
  const [name, setName] = useState(lastGuestName());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const next = encodeURIComponent(window.location.pathname + window.location.search);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError('');
    try {
      await joinAsGuest(name);
      onJoined();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not join, try again');
      setBusy(false);
    }
  }

  return (
    <Dialog title="Join Webcode" onClose={onClose ?? (() => {})}>
      <form onSubmit={submit} className="stack">
        <p className="muted">Join this project as a guest, or sign in to keep your work.</p>
        <label className="field">
          <span>Your name</span>
          <input className="input" aria-label="Your name" value={name} maxLength={40} autoFocus onChange={(e) => setName(e.target.value)} />
        </label>
        {error && <p className="error-text">{error}</p>}
        <div className="row-end">
          <a className="btn" href={`/auth/github?next=${next}`}>Sign in with GitHub</a>
          <button className="btn btn-primary" type="submit" disabled={busy || !name.trim()}>
            Join as guest
          </button>
        </div>
      </form>
    </Dialog>
  );
}
