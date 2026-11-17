import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../components/Toast';
import { resetSession } from '../session';
import { Landing } from './Landing';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function setup(handler: (url: string, init?: RequestInit) => Response) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => handler(url, init));
  vi.stubGlobal('fetch', fetchMock);
  render(
    <MemoryRouter>
      <ToastProvider>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/p/:id" element={<div>workspace</div>} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  );
  return fetchMock;
}

beforeEach(() => resetSession());
afterEach(() => vi.unstubAllGlobals());

describe('Landing', () => {
  it('renders the hero line and both buttons', () => {
    setup(() => json({ user: null, guest: null }));
    expect(
      screen.getByRole('heading', {
        name: 'Google Docs for coding: open a project, share a link, edit and run it together',
      }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try the demo' })).toBeTruthy();
    expect(screen.getAllByRole('link', { name: 'Sign in with GitHub' }).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: /Webcode on GitHub/ }).getAttribute('href')).toBe(
      'https://github.com/RealCloudyPanda/WebCode',
    );
  });

  it('Try the demo with an existing guest posts /api/demo and navigates', async () => {
    const fetchMock = setup((url) =>
      url === '/api/demo' ? json({ id: 'abc' }) : json({ user: null, guest: { guestId: 'g', name: 'Sam' } }),
    );
    const btn = screen.getByRole('button', { name: 'Try the demo' });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/me', expect.anything()));
    await waitFor(() => expect(btn).toBeTruthy());
    await new Promise((r) => setTimeout(r, 0));
    await userEvent.click(btn);
    await screen.findByText('workspace');
    const call = fetchMock.mock.calls.find((c) => c[0] === '/api/demo')!;
    expect(call[1]!.method).toBe('POST');
  });

  it('shows the server message in a toast on 503', async () => {
    setup((url) =>
      url === '/api/demo'
        ? json({ error: 'busy', message: 'The demo is busy, try again in a few minutes' }, 503)
        : json({ user: null, guest: { guestId: 'g', name: 'Sam' } }),
    );
    await new Promise((r) => setTimeout(r, 10));
    await userEvent.click(screen.getByRole('button', { name: 'Try the demo' }));
    expect((await screen.findByRole('status')).textContent).toBe('The demo is busy, try again in a few minutes');
  });

  it('asks for a name when there is no guest', async () => {
    setup(() => json({ user: null, guest: null }));
    await new Promise((r) => setTimeout(r, 10));
    await userEvent.click(screen.getByRole('button', { name: 'Try the demo' }));
    expect(await screen.findByRole('button', { name: 'Join as guest' })).toBeTruthy();
  });
});
