import { Link } from 'react-router';
import { TopBar } from '../components/TopBar';

export function NotFound() {
  return (
    <>
      <TopBar />
      <main className="centered">
        <h1>Page not found</h1>
        <p className="muted">That page doesn't exist.</p>
        <Link className="btn btn-primary" to="/">Back to Webcode</Link>
      </main>
    </>
  );
}
