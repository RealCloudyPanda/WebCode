import { useState } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../api';
import { Dialog } from '../components/Dialog';

export function ImportDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!value.trim()) return;
    setBusy(true);
    setError('');
    try {
      const { id } = await api.post<{ id: string }>('/api/projects', { importUrl: value.trim() });
      navigate(`/p/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
      setBusy(false);
    }
  }

  return (
    <Dialog title="Import from GitHub" onClose={onClose}>
      <form onSubmit={submit} className="stack">
        <label className="field">
          <span>owner/repo or GitHub URL</span>
          <input className="input" value={value} autoFocus onChange={(e) => setValue(e.target.value)} />
        </label>
        {error && <p className="error-text">{error}</p>}
        <div className="row-end">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy || !value.trim()}>
            Import project
          </button>
        </div>
      </form>
    </Dialog>
  );
}
