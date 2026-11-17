import type { LinkAccess, Role } from './access';

export type Me = {
  user: { id: string; login: string; name: string | null; avatarUrl: string } | null;
  guest: { guestId: string; name: string } | null;
};
export type ProjectSummary = {
  id: string;
  title: string;
  isOwner: boolean;
  ownerLogin: string | null;
  starred: boolean;
  lastOpenedAt: string;
  previewText: string;
  liveCount: number;
};
export type ProjectDetail = {
  id: string;
  title: string;
  role: Role;
  linkAccess: LinkAccess;
  isDemoCopy: boolean;
  expiresAt: string | null;
  people: { userId: string; login: string; name: string | null; role: Role }[];
  guestCount: number;
  /** Whether the signed-in viewer starred this project; false for guests and non-members. */
  starred: boolean;
};
export type TemplateInfo = { name: string; label: string; sub: string };
export type ApiError = { error: string; message?: string };
