import { HocuspocusProvider } from '@hocuspocus/provider';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';
import type { Role } from '@webcode/shared';

export type SyncStatus = 'connecting' | 'saving' | 'saved' | 'offline';
export type Fatal = 'revoked' | 'deleted' | 'too-many' | 'no-access' | 'need-guest';
export type ProjectRole = Exclude<Role, 'none'>;

/** Sync status copy, verbatim from the spec. */
export const STATUS_COPY = {
  saving: 'Saving…',
  saved: 'Saved',
  offline: 'Offline – changes will sync when you reconnect',
} as const satisfies Partial<Record<SyncStatus, string>>;

export type ProjectConnection = {
  doc: Y.Doc;
  provider: HocuspocusProvider | null;
  awareness: Awareness | null;
  status: SyncStatus;
  fatal: Fatal | null;
  sizeLocked: boolean;
  /** From the server's role message; null until it arrives. */
  role: ProjectRole | null;
  /** True until the server says otherwise, so nobody edits before their role is known. */
  readOnly: boolean;
};

type State = Omit<ProjectConnection, 'doc'>;
type Keyed = { projectId: string; state: State };

const INITIAL: State = {
  provider: null,
  awareness: null,
  status: 'connecting',
  fatal: null,
  sizeLocked: false,
  role: null,
  readOnly: true,
};

const AUTH_FATAL: Record<string, Fatal> = {
  'no-access': 'no-access',
  'need-guest': 'need-guest',
  'too-many': 'too-many',
  'not-found': 'deleted',
};
const CLOSE_FATAL: Record<number, Fatal> = { 4403: 'revoked', 4404: 'deleted' };
const ROLES = new Set<string>(['owner', 'editor', 'viewer']);

type Stateless =
  | { type: 'role'; role: ProjectRole; readOnly: boolean }
  | { type: 'size-locked' }
  | { type: 'size-unlocked' };

function parseStateless(payload: string): Stateless | null {
  let m: unknown;
  try {
    m = JSON.parse(payload);
  } catch {
    return null;
  }
  if (!m || typeof m !== 'object') return null;
  const msg = m as Record<string, unknown>;
  if (msg.type === 'size-locked' || msg.type === 'size-unlocked') return { type: msg.type };
  if (msg.type === 'role' && typeof msg.role === 'string' && ROLES.has(msg.role) && typeof msg.readOnly === 'boolean') {
    return { type: 'role', role: msg.role as ProjectRole, readOnly: msg.readOnly };
  }
  return null;
}

function collabUrl(): string {
  return `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/collab`;
}

/** Opens the project's shared Yjs document over Hocuspocus and tracks its connection state. */
export function useProject(projectId: string): ProjectConnection {
  const doc = useMemo(() => new Y.Doc(), [projectId]);
  const [keyed, setKeyed] = useState<Keyed>({ projectId, state: INITIAL });
  // State belongs to one project; until the new project's effect runs, show a fresh connecting state.
  const state = keyed.projectId === projectId ? keyed.state : INITIAL;
  const setState = (update: (s: State) => State) =>
    setKeyed((k) => (k.projectId === projectId ? { projectId, state: update(k.state) } : k));

  // Free the previous project's document once a new one has taken over.
  const lastDoc = useRef(doc);
  useEffect(() => {
    if (lastDoc.current !== doc) lastDoc.current.destroy();
    lastDoc.current = doc;
  }, [doc]);

  useEffect(() => {
    setKeyed({ projectId, state: INITIAL });
    let stopped = false;
    let everSynced = false;
    let live = false;
    let unsynced = 0;
    let provider: HocuspocusProvider | null = null;

    const status = (): SyncStatus =>
      !everSynced ? 'connecting' : !live ? 'offline' : unsynced > 0 ? 'saving' : 'saved';
    const refresh = () => {
      if (!stopped) setState((s) => ({ ...s, status: status() }));
    };
    const fail = (fatal: Fatal) => {
      if (stopped) return;
      stopped = true;
      setState((s) => ({ ...s, fatal, provider: null, awareness: null }));
      // Destroy after the provider finishes emitting, so it neither reconnects nor trips over itself.
      const p = provider;
      queueMicrotask(() => p?.destroy());
    };

    provider = new HocuspocusProvider({
      url: collabUrl(),
      name: projectId,
      document: doc,
      onStatus: ({ status: s }) => {
        if (s !== 'connected') live = false;
        refresh();
      },
      onSynced: () => {
        everSynced = true;
        live = true;
        refresh();
      },
      onUnsyncedChanges: ({ number }) => {
        unsynced = number;
        refresh();
      },
      onAuthenticationFailed: ({ reason }) => fail(AUTH_FATAL[reason] ?? 'no-access'),
      onClose: ({ event }) => {
        const fatal = CLOSE_FATAL[event.code];
        if (fatal) fail(fatal);
      },
      onStateless: ({ payload }) => {
        const msg = parseStateless(payload);
        if (!msg || stopped) return;
        if (msg.type === 'role') setState((s) => ({ ...s, role: msg.role, readOnly: msg.readOnly }));
        else setState((s) => ({ ...s, sizeLocked: msg.type === 'size-locked' }));
      },
    });
    const created = provider;
    setState((s) => ({ ...s, provider: created, awareness: created.awareness }));

    return () => {
      const alreadyFailed = stopped;
      stopped = true;
      if (!alreadyFailed) created.destroy();
    };
  }, [doc, projectId]);

  return { doc, ...state };
}
