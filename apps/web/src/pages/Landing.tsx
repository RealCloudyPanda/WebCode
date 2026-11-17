import { useState } from 'react';
import { useNavigate } from 'react-router';
import { api, ApiFailure } from '../api';
import { TopBar } from '../components/TopBar';
import { useToast } from '../components/Toast';
import { useMe } from '../session';
import { JoinDialog } from '../workspace/JoinDialog';

export function Landing() {
  const { me } = useMe();
  const navigate = useNavigate();
  const toast = useToast();
  const [joining, setJoining] = useState(false);
  const [busy, setBusy] = useState(false);

  async function startDemo() {
    setBusy(true);
    try {
      const { id } = await api.post<{ id: string }>('/api/demo');
      navigate(`/p/${id}`);
    } catch (e) {
      if (e instanceof ApiFailure && e.status === 401) setJoining(true);
      else toast(e instanceof Error ? e.message : 'Could not start the demo');
    } finally {
      setBusy(false);
    }
  }

  function onTry() {
    if (!me?.guest) setJoining(true);
    else void startDemo();
  }

  return (
    <>
      <TopBar trailing={<a className="btn" href="/auth/github">Sign in with GitHub</a>} />
      <main className="landing">
        <h1>Google Docs for coding: open a project, share a link, edit and run it together</h1>
        <div className="landing-actions">
          <button className="btn btn-primary btn-lg" onClick={onTry} disabled={busy}>Try the demo</button>
          <a className="btn btn-lg" href="/auth/github">Sign in with GitHub</a>
        </div>
        <img
          className="landing-demo"
          src="/landing-demo.webp"
          alt="Two people editing and running a project together"
          onError={(e) => {
            e.currentTarget.style.display = 'none';
          }}
        />
      </main>
      <footer className="landing-footer">
        <a href="https://github.com/RealCloudyPanda/WebCode" target="_blank" rel="noreferrer">
          Webcode on GitHub
        </a>
      </footer>
      {joining && (
        <JoinDialog
          onClose={() => setJoining(false)}
          onJoined={() => {
            setJoining(false);
            void startDemo();
          }}
        />
      )}
    </>
  );
}
