export type Role = 'owner' | 'editor' | 'viewer' | 'none';
export type LinkAccess = 'restricted' | 'viewer' | 'editor';
export type Viewer =
  | { kind: 'user'; userId: string }
  | { kind: 'guest'; guestId: string }
  | { kind: 'anonymous' };

export function resolveAccess(
  p: { ownerId: string | null; ownerGuestId: string | null; linkAccess: LinkAccess },
  v: Viewer,
): Role {
  if (v.kind === 'user' && p.ownerId !== null && p.ownerId === v.userId) return 'owner';
  if (v.kind === 'guest' && p.ownerGuestId !== null && p.ownerGuestId === v.guestId) return 'owner';
  if (p.linkAccess === 'editor') return 'editor';
  if (p.linkAccess === 'viewer') return 'viewer';
  return 'none';
}
