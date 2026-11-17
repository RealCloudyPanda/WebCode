import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { ProjectDetail } from '@webcode/shared';
import { ToastProvider } from '../components/Toast';
import { ShareDialog } from './ShareDialog';

const detail = (over: Partial<ProjectDetail> = {}): ProjectDetail => ({
  id: 'p1',
  title: 'My app',
  role: 'owner',
  linkAccess: 'restricted',
  isDemoCopy: false,
  expiresAt: null,
  people: [
    { userId: 'u2', login: 'sam', name: 'Sam', role: 'editor' },
    { userId: 'u1', login: 'me', name: 'Me', role: 'owner' },
  ],
  guestCount: 0,
  ...over,
});

function setup(d: ProjectDetail, isOwner: boolean) {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
    new Response(JSON.stringify({ ...d, ...(init?.body ? JSON.parse(String(init.body)) : {}) }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
  );
  vi.stubGlobal('fetch', fetchMock);
  const onChange = vi.fn();
  function Harness() {
    const [current, setCurrent] = useState(d);
    return (
      <ToastProvider>
        <ShareDialog detail={current} isOwner={isOwner} onChange={(n) => (onChange(n), setCurrent(n))} onClose={vi.fn()} />
      </ToastProvider>
    );
  }
  render(<Harness />);
  return { fetchMock, onChange };
}

afterEach(() => vi.unstubAllGlobals());

describe('ShareDialog', () => {
  test('shows the title, helper text and people with owner first', () => {
    setup(detail({ guestCount: 3 }), true);
    expect(screen.getByRole('dialog', { name: 'Share "My app"' })).toBeTruthy();
    expect(screen.getByText('Only you can open this link')).toBeTruthy();
    const names = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(names[0]).toContain('Me');
    expect(names[1]).toContain('Sam');
    expect(screen.getByText('and 3 guests')).toBeTruthy();
  });

  test('owner choosing Anyone with the link, then Editor, sends linkAccess editor', async () => {
    const { fetchMock, onChange } = setup(detail(), true);
    await userEvent.selectOptions(screen.getByLabelText('General access'), 'anyone');
    await userEvent.selectOptions(screen.getByLabelText('Link role'), 'editor');
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(2));
    const bodies = fetchMock.mock.calls.map(([url, init]) => [url, init?.method, init?.body]);
    expect(bodies).toEqual([
      ['/api/projects/p1', 'PATCH', JSON.stringify({ linkAccess: 'viewer' })],
      ['/api/projects/p1', 'PATCH', JSON.stringify({ linkAccess: 'editor' })],
    ]);
  });

  test('non-owners see disabled selects', () => {
    setup(detail({ linkAccess: 'viewer' }), false);
    expect((screen.getByLabelText('General access') as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByLabelText('Link role') as HTMLSelectElement).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeTruthy();
  });

  test('Copy link copies the project URL and confirms', async () => {
    setup(detail(), true);
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await userEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(writeText).toHaveBeenCalledWith(`${location.origin}/p/p1`);
    expect(await screen.findByText('Link copied')).toBeTruthy();
  });
});
