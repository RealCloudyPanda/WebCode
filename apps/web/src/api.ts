export class ApiFailure extends Error {
  constructor(
    public status: number,
    public error: string,
    message?: string,
  ) {
    super(message ?? error);
    this.name = 'ApiFailure';
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: 'same-origin' };
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  const res = await fetch(path, init);
  let data: unknown = undefined;
  if (res.status !== 204) {
    try {
      data = await res.json();
    } catch {
      data = undefined;
    }
  }
  if (!res.ok) {
    const d = (data ?? {}) as { error?: string; message?: string };
    throw new ApiFailure(res.status, d.error ?? 'error', d.message);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  del: <T = void>(path: string) => request<T>('DELETE', path),
};
