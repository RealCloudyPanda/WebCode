import { useCallback, useEffect, useSyncExternalStore } from 'react';
import type { Me } from '@webcode/shared';
import { api } from './api';

const LAST_NAME_KEY = 'wc_last_name';

let current: Me | undefined;
let inflight: Promise<void> | undefined;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function load(): Promise<void> {
  inflight ??= api
    .get<Me>('/api/me')
    .then((me) => {
      current = me;
    })
    .catch(() => {
      current = { user: null, guest: null };
    })
    .finally(() => {
      inflight = undefined;
      emit();
    });
  return inflight;
}

/** Test helper: forget the cached session. */
export function resetSession() {
  current = undefined;
  inflight = undefined;
  emit();
}

export function useMe(): { me: Me | undefined; refresh(): Promise<void> } {
  const me = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
  useEffect(() => {
    if (current === undefined) void load();
  }, []);
  const refresh = useCallback(() => load(), []);
  return { me, refresh };
}

export function lastGuestName(): string {
  try {
    return localStorage.getItem(LAST_NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export async function joinAsGuest(name: string): Promise<void> {
  const trimmed = name.trim();
  await api.post('/api/guest', { name: trimmed });
  try {
    localStorage.setItem(LAST_NAME_KEY, trimmed);
  } catch {
    /* storage unavailable */
  }
  await load();
}
