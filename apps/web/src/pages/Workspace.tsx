import { useParams } from 'react-router';
import { TopBar } from '../components/TopBar';

// Placeholder; the real workspace is built in a later task.
export function Workspace() {
  const { id } = useParams();
  return (
    <>
      <TopBar />
      <main className="centered">
        <p className="muted">Project {id}</p>
      </main>
    </>
  );
}
