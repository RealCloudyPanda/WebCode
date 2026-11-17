import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test } from 'vitest';
import * as Y from 'yjs';
import { getFiles, seedDoc } from '@webcode/shared';
import type { Peer } from '../collab/presence';
import { Explorer } from './Explorer';

const peer: Peer = { clientId: 7, user: { id: 'u2', name: 'Sam', color: '#f28b82', kind: 'github' }, file: 'src/a.ts' };

function setup(peers: Peer[] = []) {
  const doc = new Y.Doc();
  seedDoc(doc, { 'src/a.ts': 'x', 'package.json': '{}' }, 't');
  const opened: string[] = [];
  render(<Explorer doc={doc} peers={peers} activePath={null} readOnly={false} onOpen={(p) => opened.push(p)} />);
  return { doc, opened };
}

describe('Explorer', () => {
  test('renders the tree from the doc, folders first', () => {
    setup();
    const names = screen.getAllByRole('treeitem').map((n) => n.textContent);
    expect(names).toEqual(['▾src', 'a.ts', 'package.json']);
  });

  test('shows a dot in the peer colour next to the file they are in', () => {
    setup([peer]);
    const dot = screen.getByTestId('peer-dot');
    expect(dot.style.background).toBe('rgb(242, 139, 130)');
    expect(screen.getByText('a.ts').closest('[role=treeitem]')!.contains(dot)).toBe(true);
  });

  test('New file from a folder creates src/new.ts and opens it', async () => {
    const { doc, opened } = setup();
    fireEvent.contextMenu(screen.getByText('src'));
    await userEvent.click(screen.getByRole('menuitem', { name: 'New file' }));
    await userEvent.type(screen.getByLabelText('Name'), 'new.ts{Enter}');
    expect(getFiles(doc).has('src/new.ts')).toBe(true);
    expect(opened).toEqual(['src/new.ts']);
  });

  test('delete asks for confirmation first', async () => {
    const { doc } = setup();
    fireEvent.contextMenu(screen.getByText('package.json'));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    expect(getFiles(doc).has('package.json')).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(getFiles(doc).has('package.json')).toBe(false);
  });
});
