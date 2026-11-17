export const LIMITS = {
  maxFiles: 2000,
  maxFileBytes: 1_000_000,
  maxProjectBytes: 10_000_000,
  maxProjectsPerUser: 20,
  maxCreatesPerHour: 10,
  siteCapBytes: 400_000_000,
  maxConnections: 20,
  maxDemoPerIpPerHour: 5,
  maxLiveDemos: 300,
  demoIdleMs: 86_400_000,
} as const;
