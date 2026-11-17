import { render, screen } from '@testing-library/react';
import type { Me } from '@webcode/shared';
import { MemoryRouter } from 'react-router';
import { describe, expect, test, vi } from 'vitest';
import type { SyncStatus } from '../collab/useProject';
import { Toolbar } from './Toolbar';
import { TitleRow } from './TitleRow';

const base = {
  title: 'My project',
  canEditTitle: true,
  onRename: vi.fn(),
  starred: false,
  canStar: true,
  onToggleStar: vi.fn(),
  status: 'saved' as SyncStatus,
  peers: [],
  onPeerClick: vi.fn(),
  onShare: vi.fn(),
  me: { user: { id: 'u1', login: 'me', name: 'Me', avatarUrl: '' }, guest: null } as Me,
};

const show = (props: Partial<typeof base> = {}) =>
  render(
    <MemoryRouter>
      <TitleRow {...base} {...props} />
    </MemoryRouter>,
  );

describe('TitleRow', () => {
  test.each([
    ['saved', 'Saved'],
    ['saving', 'Saving…'],
    ['offline', 'Offline – changes will sync when you reconnect'],
  ] as const)('shows %s status', (status, text) => {
    show({ status });
    expect(screen.getByRole('status').textContent).toBe(text);
  });

  test('editors can edit the title; viewers cannot', () => {
    const { unmount } = show();
    expect((screen.getByRole('textbox', { name: 'Project title' }) as HTMLInputElement).value).toBe('My project');
    unmount();
    show({ canEditTitle: false });
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByText('My project')).toBeTruthy();
  });

  test('guests see Sign in instead of an avatar', () => {
    show({ me: { user: null, guest: null } });
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeTruthy();
  });
});

describe('Toolbar mode', () => {
  const props = { path: 'a.ts', mode: 'editing' as const, onMode: vi.fn(), onUndo: vi.fn(), onRedo: vi.fn(), onFormat: vi.fn(), onSearch: vi.fn() };

  test('viewers only get "Viewing"', () => {
    render(<Toolbar {...props} canEdit={false} />);
    const select = screen.getByLabelText('Mode') as HTMLSelectElement;
    expect([...select.options].map((o) => o.text)).toEqual(['Viewing']);
    expect(select.disabled).toBe(true);
  });

  test('editors can switch between Editing and Viewing', () => {
    render(<Toolbar {...props} canEdit />);
    expect([...(screen.getByLabelText('Mode') as HTMLSelectElement).options].map((o) => o.text)).toEqual(['Editing', 'Viewing']);
  });
});
