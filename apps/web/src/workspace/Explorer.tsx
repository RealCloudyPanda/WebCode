import { useImperativeHandle, useState, type FormEvent, type Ref } from 'react';
import type * as Y from 'yjs';
import { createDir, createFile, deleteEntry, FileOpError, renameEntry, type FileOpErrorCode, type TreeNode } from '../collab/fileOps';
import type { Peer } from '../collab/presence';
import { Dialog } from '../components/Dialog';
import { useToast } from '../components/Toast';
import { useDocTree } from './useDocTree';

export type ExplorerHandle = {
  newFile(): void;
  newFolder(): void;
  rename(path: string | null): void;
  remove(path: string | null): void;
};

type Props = {
  ref?: Ref<ExplorerHandle>;
  doc: Y.Doc;
  peers: Peer[];
  activePath: string | null;
  readOnly: boolean;
  onOpen: (path: string) => void;
};

type Action =
  | { kind: 'file' | 'folder'; parent: string }
  | { kind: 'rename' | 'delete'; node: TreeNode };

const ERRORS: Record<FileOpErrorCode, string> = {
  'invalid-path': "That name isn't allowed",
  ignored: "Files in that folder aren't synced",
  exists: 'That name is already taken',
  'not-found': 'That file no longer exists',
  'too-large': "Files can't be larger than 1 MB",
  'too-many': 'Projects can have up to 2,000 files',
};

const parentOf = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf('/')));
const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);

export function Explorer({ ref, doc, peers, activePath, readOnly, onOpen }: Props) {
  const tree = useDocTree(doc);
  const toast = useToast();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<{ x: number; y: number; node: TreeNode | null } | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const [name, setName] = useState('');

  const fail = (e: unknown) => toast(e instanceof FileOpError ? ERRORS[e.code] : 'Something went wrong');

  const start = (a: Action) => {
    setMenu(null);
    setName('node' in a ? a.node.name : '');
    setAction(a);
  };

  const find = (nodes: TreeNode[], path: string): TreeNode | null => {
    for (const n of nodes) {
      if (n.path === path) return n;
      const hit = n.children && find(n.children, path);
      if (hit) return hit;
    }
    return null;
  };
  useImperativeHandle(ref, () => ({
    newFile: () => start({ kind: 'file', parent: '' }),
    newFolder: () => start({ kind: 'folder', parent: '' }),
    rename: (path) => {
      const node = path && find(tree, path);
      if (node) start({ kind: 'rename', node });
    },
    remove: (path) => {
      const node = path && find(tree, path);
      if (node) start({ kind: 'delete', node });
    },
  }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!action) return;
    const value = name.trim();
    try {
      if (action.kind === 'delete') {
        deleteEntry(doc, action.node.path);
      } else if (value && 'node' in action) {
        renameEntry(doc, action.node.path, join(parentOf(action.node.path), value));
      } else if (value && 'parent' in action) {
        const path = join(action.parent, value);
        if (action.kind === 'file') {
          createFile(doc, path);
          onOpen(path);
        } else createDir(doc, path);
      }
      setAction(null);
    } catch (err) {
      fail(err);
    }
  };

  const toggle = (path: string) =>
    setCollapsed((s) => {
      const next = new Set(s);
      if (!next.delete(path)) next.add(path);
      return next;
    });

  const renderNodes = (nodes: TreeNode[], depth: number) =>
    nodes.map((n) => {
      const pad = { paddingLeft: 8 + depth * 14 };
      if (n.kind === 'dir') {
        const open = !collapsed.has(n.path);
        return (
          <div key={n.path}>
            <div
              className="tree-row"
              style={pad}
              role="treeitem"
              aria-expanded={open}
              tabIndex={0}
              onClick={() => toggle(n.path)}
              onKeyDown={(e) => e.key === 'Enter' && toggle(n.path)}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (!readOnly) setMenu({ x: e.clientX, y: e.clientY, node: n });
              }}
            >
              <span className="tree-caret">{open ? '▾' : '▸'}</span>
              {n.name}
            </div>
            {open && renderNodes(n.children ?? [], depth + 1)}
          </div>
        );
      }
      const here = peers.filter((p) => p.file === n.path);
      return (
        <div
          key={n.path}
          className={`tree-row${n.path === activePath ? ' on' : ''}`}
          style={pad}
          role="treeitem"
          tabIndex={0}
          onClick={() => onOpen(n.path)}
          onKeyDown={(e) => e.key === 'Enter' && onOpen(n.path)}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!readOnly) setMenu({ x: e.clientX, y: e.clientY, node: n });
          }}
        >
          <span className="tree-name">{n.name}</span>
          {here.map((p) => (
            <span key={p.clientId} className="who" data-testid="peer-dot" title={p.user.name} style={{ background: p.user.color }} />
          ))}
        </div>
      );
    });

  const parentFor = (node: TreeNode | null) => (!node ? '' : node.kind === 'dir' ? node.path : parentOf(node.path));
  const title =
    action?.kind === 'file' ? 'New file' : action?.kind === 'folder' ? 'New folder' : action?.kind === 'rename' ? 'Rename' : 'Delete';

  return (
    <aside
      className="explorer"
      aria-label="Files"
      onContextMenu={(e) => {
        e.preventDefault();
        if (!readOnly) setMenu({ x: e.clientX, y: e.clientY, node: null });
      }}
    >
      <div className="explorer-head">
        <span>Files</span>
        {!readOnly && (
          <span className="explorer-actions">
            <button className="icon-btn sm" aria-label="New file" title="New file" onClick={() => start({ kind: 'file', parent: '' })}>
              +
            </button>
            <button className="icon-btn sm" aria-label="New folder" title="New folder" onClick={() => start({ kind: 'folder', parent: '' })}>
              ▢
            </button>
          </span>
        )}
      </div>
      <div role="tree">{renderNodes(tree, 0)}</div>

      {menu && (
        <>
          <div className="menu-scrim" onMouseDown={() => setMenu(null)} />
          <div className="menu ctx" role="menu" style={{ left: menu.x, top: menu.y }}>
            <button role="menuitem" onClick={() => start({ kind: 'file', parent: parentFor(menu.node) })}>New file</button>
            <button role="menuitem" onClick={() => start({ kind: 'folder', parent: parentFor(menu.node) })}>New folder</button>
            {menu.node && (
              <>
                <button role="menuitem" onClick={() => start({ kind: 'rename', node: menu.node! })}>Rename</button>
                <button role="menuitem" onClick={() => start({ kind: 'delete', node: menu.node! })}>Delete</button>
              </>
            )}
          </div>
        </>
      )}

      {action && (
        <Dialog title={title} onClose={() => setAction(null)}>
          <form className="stack" onSubmit={submit}>
            {action.kind === 'delete' ? (
              <p>
                Delete <strong>{action.node.name}</strong>
                {action.node.kind === 'dir' ? ' and everything in it' : ''}? This can't be undone.
              </p>
            ) : (
              <label className="field">
                <span>{'parent' in action ? `Name${action.parent ? ` (in ${action.parent})` : ''}` : 'New name'}</span>
                <input className="input" aria-label="Name" value={name} autoFocus onChange={(e) => setName(e.target.value)} />
              </label>
            )}
            <div className="row-end">
              <button type="button" className="btn" onClick={() => setAction(null)}>Cancel</button>
              <button type="submit" className={`btn ${action.kind === 'delete' ? 'btn-danger' : 'btn-primary'}`}>
                {action.kind === 'delete' ? 'Delete' : action.kind === 'rename' ? 'Rename' : 'Create'}
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </aside>
  );
}
