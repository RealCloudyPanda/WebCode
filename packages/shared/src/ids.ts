function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function newToken(bytes = 32): string {
  return toBase64Url(globalThis.crypto.getRandomValues(new Uint8Array(bytes)));
}

/** 16 random bytes (128 bits) as 22 base64url chars. */
export function newProjectId(): string {
  return newToken(16);
}
