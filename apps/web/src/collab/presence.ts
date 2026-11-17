import { useEffect, useState } from 'react';
import type { Awareness } from 'y-protocols/awareness';

export type PeerUser = { id: string; name: string; color: string; kind: 'github' | 'guest' };

export type Peer = {
  clientId: number;
  user: PeerUser;
  file: string | null;
  cursor?: unknown;
  selection?: unknown;
};

export function setLocalUser(awareness: Awareness, user: PeerUser): void {
  awareness.setLocalStateField('user', user);
}

export function setLocalFile(awareness: Awareness, path: string | null): void {
  awareness.setLocalStateField('file', path);
}

/** Awareness states come from other browsers: accept only well-formed ones. */
function toPeer(clientId: number, state: Record<string, unknown>): Peer | null {
  const u = state.user as Record<string, unknown> | undefined;
  if (!u || typeof u !== 'object') return null;
  if (typeof u.id !== 'string' || typeof u.name !== 'string' || typeof u.color !== 'string') return null;
  if (u.kind !== 'github' && u.kind !== 'guest') return null;
  const peer: Peer = {
    clientId,
    user: { id: u.id, name: u.name, color: u.color, kind: u.kind },
    file: typeof state.file === 'string' ? state.file : null,
  };
  if ('cursor' in state) peer.cursor = state.cursor;
  if ('selection' in state) peer.selection = state.selection;
  return peer;
}

function readPeers(awareness: Awareness): Peer[] {
  const peers: Peer[] = [];
  awareness.getStates().forEach((state, clientId) => {
    if (clientId === awareness.clientID) return;
    const p = toPeer(clientId, state);
    if (p) peers.push(p);
  });
  return peers.sort((a, b) => a.clientId - b.clientId);
}

/** Everyone else connected to the project, kept up to date. */
export function usePeers(awareness: Awareness | null): Peer[] {
  const [peers, setPeers] = useState<Peer[]>(() => (awareness ? readPeers(awareness) : []));
  useEffect(() => {
    if (!awareness) {
      setPeers([]);
      return;
    }
    const update = () => setPeers(readPeers(awareness));
    update();
    awareness.on('change', update);
    return () => awareness.off('change', update);
  }, [awareness]);
  return peers;
}

const HEX = /^#([0-9a-f]{6})$/i;
const FALLBACK = '#8ab4f8';

function rgb(color: string): [number, number, number] {
  const hex = HEX.exec(color)?.[1] ?? FALLBACK.slice(1);
  const n = parseInt(hex, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** A CSS string literal: escapes quotes, backslashes and control characters. */
function cssString(s: string): string {
  return (
    '"' +
    s.replace(/["\\]|[\u0000-\u001f\u007f]/g, (c) =>
      c === '"' || c === '\\' ? '\\' + c : `\\${c.charCodeAt(0).toString(16)} `,
    ) +
    '"'
  );
}

/** Rules colouring y-monaco's remote selection and caret classes, with a name flag. */
export function remoteCursorCss(peers: Peer[]): string {
  return peers
    .filter((p) => Number.isInteger(p.clientId))
    .map((p) => {
      const id = p.clientId;
      const [r, g, b] = rgb(p.user.color);
      const color = `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
      return [
        `.yRemoteSelection-${id} { background-color: rgba(${r}, ${g}, ${b}, 0.25); }`,
        `.yRemoteSelectionHead-${id} { position: absolute; box-sizing: border-box; height: 100%; border-left: 2px solid; border-color: ${color}; }`,
        `.yRemoteSelectionHead-${id}::after { position: absolute; top: -1.4em; left: -2px; padding: 0 4px; border-radius: 3px 3px 3px 0; font-size: 11px; line-height: 1.4em; white-space: nowrap; pointer-events: none; color: #1b1b1d; background-color: ${color}; content: ${cssString(p.user.name)}; }`,
      ].join('\n');
    })
    .join('\n');
}
