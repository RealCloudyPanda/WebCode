import { render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import type { Me, ProjectDetail } from '@webcode/shared';
import { Banners } from './Banners';

const detail = (over: Partial<ProjectDetail> = {}): ProjectDetail => ({
  id: 'p1', title: 'Demo', role: 'owner', linkAccess: 'restricted', isDemoCopy: true, expiresAt: null, people: [], guestCount: 0, starred: false, ...over,
});
const guest: Me = { user: null, guest: { guestId: 'g', name: 'Sam' } };
const user: Me = { user: { id: 'u', login: 'me', name: 'Me', avatarUrl: '' }, guest: null };

const show = (over: Partial<Parameters<typeof Banners>[0]> = {}) =>
  render(<Banners detail={detail()} me={guest} role="owner" sizeLocked={false} revoked={false} onStartOver={vi.fn()} {...over} />);

describe('Banners', () => {
  test('demo copy banner for the guest who owns it', () => {
    show();
    expect(screen.getByText("This is your demo copy. It's deleted after 24 hours of inactivity.")).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Sign in with GitHub to keep it' }).getAttribute('href')).toBe('/auth/github?next=%2Fp%2Fp1');
    expect(screen.getByRole('button', { name: 'Start over' })).toBeTruthy();
  });

  test('no demo banner for a signed-in owner', () => {
    show({ me: user });
    expect(screen.queryByText(/demo copy/)).toBeNull();
  });

  test('size lock copy depends on who is looking', () => {
    const { unmount } = show({ detail: detail({ isDemoCopy: false }), sizeLocked: true });
    expect(screen.getByText('This project is over its size limit. Delete files to keep editing.')).toBeTruthy();
    unmount();
    show({ detail: detail({ isDemoCopy: false }), sizeLocked: true, role: 'editor' });
    expect(screen.getByText('This project is over its size limit. The owner needs to delete files.')).toBeTruthy();
  });

  test('viewer and revoked banners', () => {
    show({ detail: detail({ isDemoCopy: false }), role: 'viewer', revoked: true });
    expect(screen.getByText('You have view access. Changes from the terminal stay in your browser.')).toBeTruthy();
    expect(screen.getByText('You no longer have access')).toBeTruthy();
  });
});
