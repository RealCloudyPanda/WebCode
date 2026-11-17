import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'

export interface CollabHub {
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void
  liveCount(projectId: string): number
  liveGuests(projectId: string): number
  reevaluateAccess(projectId: string): Promise<void>
  closeAll(projectId: string, reason: 'deleted'): void
  setTitle(projectId: string, title: string): Promise<void>
  snapshotFiles(projectId: string): Promise<Record<string, string>>
  destroy(): Promise<void>
}

export function createNoopCollab(): CollabHub {
  return {
    handleUpgrade: (_req, socket) => { socket.destroy() },
    liveCount: () => 0,
    liveGuests: () => 0,
    reevaluateAccess: async () => {},
    closeAll: () => {},
    setTitle: async () => {},
    snapshotFiles: async () => ({}),
    destroy: async () => {},
  }
}
