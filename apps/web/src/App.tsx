import { Route, Routes } from 'react-router';
import { ToastProvider } from './components/Toast';
import { Home } from './pages/Home';
import { Landing } from './pages/Landing';
import { NotFound } from './pages/NotFound';
import { Workspace } from './pages/Workspace';
import { useMe } from './session';

function Root() {
  const { me } = useMe();
  if (!me) return null;
  return me.user ? <Home /> : <Landing />;
}

export function App() {
  return (
    <ToastProvider>
      <Routes>
        <Route path="/" element={<Root />} />
        <Route path="/p/:id" element={<Workspace />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </ToastProvider>
  );
}
