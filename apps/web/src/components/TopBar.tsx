import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Logo } from './Logo';

type Props = { leading?: ReactNode; center?: ReactNode; trailing?: ReactNode };

export function TopBar({ leading, center, trailing }: Props) {
  return (
    <header className="topbar">
      {leading}
      <Link to="/" className="topbar-logo" aria-label="Webcode home">
        <Logo />
      </Link>
      <div className="topbar-center">{center}</div>
      <div className="topbar-trailing">{trailing}</div>
    </header>
  );
}
