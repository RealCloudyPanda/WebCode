import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import type { ProjectSummary } from '@webcode/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../components/Toast';
import { Home } from '../pages/Home';
import { resetSession } from '../session';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const TEMPLATES = [
  { name: 'blank', label: 'Blank', sub: '' },
  { name: 'react-app', label: 'React app', sub: 'Vite + TypeScript' },
  { name: 'node-api', label: 'Node API', sub: 'Express' },
  { name: 'ts-library', label: 'TS library', sub: 'with tests' },
];

const project = (over: Partial<ProjectSummary>): ProjectSummary => ({
  id: 'p1',
  title: 'todo-api',
  isOwner: true,
  ownerLogin: 'me',
  starred: false,
  lastOpenedAt: '2026-11-12T10:00:00Z',
  previewText: 'const a = 1',
  liveCount: 0,
  ...over,
});

let projects: ProjectSummary[];
let fetchMock: ReturnType<typeof vi.fn>;

function setup() {
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/me')
      return json({ user: { id: 'u1', login: 'me', name: 'Me', avatarUrl: '/api/avatar/u1' }, guest: null });
    if (url === '/api/templates') return json(TEMPLATES);
    if (url.startsWith('/api/projects') && (!init || init.method === 'GET')) return json(projects);
    if (init?.method === 'DELETE') return new Response(null, { status: 204 });
    if (init?.method === 'POST') return json({ id: 'new1' });
    return json({});
  });
  vi.stubGlobal('fetch', fetchMock);
  render(
    <MemoryRouter>
      <ToastProvider>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/p/:id" element={<div>workspace</div>} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  );
}

const calls = (method: string) => fetchMock.mock.calls.filter((c) => (c[1]?.method ?? 'GET') === method);

beforeEach(() => {
  resetSession();
  projects = [
    project({ id: 'p1', title: 'todo-api', liveCount: 2 }),
    project({ id: 'p2', title: 'slugify', starred: true }),
    project({ id: 'p3', title: 'weather-cli', isOwner: false }),
  ];
});
afterEach(() => vi.unstubAllGlobals());

describe('Home', () => {
  it('renders five tiles in order', async () => {
    setup();
    await screen.findByText('todo-api');
    const band = screen.getByRole('region', { name: 'Start a new project' });
    const names = within(band).getAllByRole('button').map((b) => b.getAttribute('aria-label'));
    expect(names).toEqual(['Blank', 'React app', 'Node API', 'TS library', 'Import']);
  });

  it('creates from a template and navigates', async () => {
    setup();
    await screen.findByText('todo-api');
    await userEvent.click(screen.getByRole('button', { name: /React app/ }));
    await screen.findByText('workspace');
    expect(JSON.parse(calls('POST')[0]![1].body)).toEqual({ template: 'react-app' });
  });

  it('search hides non-matching cards', async () => {
    setup();
    await screen.findByText('todo-api');
    await userEvent.type(screen.getByPlaceholderText('Search projects'), 'slug');
    expect(screen.queryByText('todo-api')).toBeNull();
    expect(screen.getByText('slugify')).toBeTruthy();
  });

  it('shows live count, star and shared marker', async () => {
    setup();
    await screen.findByText('2 here now');
    expect(screen.getByLabelText('Starred')).toBeTruthy();
    expect(screen.getByText('Shared')).toBeTruthy();
  });

  it('asks for confirmation before deleting an owned project', async () => {
    setup();
    const card = (await screen.findByText('todo-api')).closest('.card') as HTMLElement;
    await userEvent.click(within(card).getByRole('button', { name: 'More actions' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Remove' }));
    expect(screen.getByText('Delete "todo-api"? This can\'t be undone.')).toBeTruthy();
    expect(calls('DELETE')).toHaveLength(0);
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(calls('DELETE')).toHaveLength(1));
    expect(calls('DELETE')[0]![0]).toBe('/api/projects/p1');
    await waitFor(() => expect(screen.queryByText('todo-api')).toBeNull());
  });

  it('refetches with filter=shared when the filter changes', async () => {
    setup();
    await screen.findByText('todo-api');
    await userEvent.selectOptions(screen.getByLabelText('Filter'), 'shared');
    await waitFor(() =>
      expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('filter=shared'))).toBe(true),
    );
  });

  it('shows the empty state', async () => {
    projects = [];
    setup();
    expect(await screen.findByText('No projects yet. Start one above.')).toBeTruthy();
  });

  it('shows server import errors verbatim', async () => {
    setup();
    await screen.findByText('todo-api');
    fetchMock.mockImplementationOnce(async () => json({ error: 'invalid', message: 'Repo not found' }, 400));
    await userEvent.click(screen.getByRole('button', { name: /Import/ }));
    await userEvent.type(screen.getByLabelText('owner/repo or GitHub URL'), 'a/b');
    await userEvent.click(screen.getByRole('button', { name: 'Import project' }));
    expect(await screen.findByText('Repo not found')).toBeTruthy();
  });

  it('ignores a stale list response after the filter changes', async () => {
    setup();
    await screen.findByText('todo-api');
    const base = fetchMock.getMockImplementation()!;
    let releaseSlow!: () => void;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes('filter=mine')) {
        await new Promise<void>((r) => (releaseSlow = r));
        return json([project({ id: 'old', title: 'stale-one' })]);
      }
      if (url.includes('filter=shared')) return json([project({ id: 'n', title: 'fresh-one' })]);
      return base(url, init);
    });
    await userEvent.selectOptions(screen.getByLabelText('Filter'), 'mine');
    await userEvent.selectOptions(screen.getByLabelText('Filter'), 'shared');
    await screen.findByText('fresh-one');
    releaseSlow();
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText('stale-one')).toBeNull();
    expect(screen.getByText('fresh-one')).toBeTruthy();
  });

  it('clears the list and toasts when a filter change fails', async () => {
    setup();
    await screen.findByText('todo-api');
    const base = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) =>
      url.includes('filter=mine') ? json({ error: 'boom' }, 500) : base(url, init),
    );
    await userEvent.selectOptions(screen.getByLabelText('Filter'), 'mine');
    expect((await screen.findByRole('status')).textContent).toBe('Something went wrong, try again');
    expect(screen.queryByText('todo-api')).toBeNull();
  });

  it('toasts when templates fail to load', async () => {
    setup();
    const base = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) =>
      url === '/api/templates' ? json({ error: 'x' }, 500) : base(url, init),
    );
    cleanup();
    resetSession();
    render(
      <MemoryRouter>
        <ToastProvider>
          <Home />
        </ToastProvider>
      </MemoryRouter>,
    );
    expect((await screen.findByRole('status')).textContent).toBe('Something went wrong, try again');
  });

  it('Escape cancels a rename without committing on blur', async () => {
    setup();
    const card = (await screen.findByText('todo-api')).closest('.card') as HTMLElement;
    await userEvent.click(within(card).getByRole('button', { name: 'More actions' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    const input = screen.getByLabelText('Project name');
    await userEvent.clear(input);
    await userEvent.type(input, 'renamed{Escape}');
    await userEvent.click(document.body);
    expect(fetchMock.mock.calls.filter((c) => c[1]?.method === 'PATCH')).toHaveLength(0);
  });
});
