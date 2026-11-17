import type { WebContainer, WebContainerProcess } from '@webcontainer/api';

/** Where a process's output goes (and, for shells, where keystrokes come from). */
export type TermSink = {
  write(data: string): void;
  cols: number;
  rows: number;
  onInput?(listener: (data: string) => void): () => void;
};

export type ProcessKind = 'run' | 'test';

function scripts(pkgJson: string): Record<string, unknown> | null {
  try {
    const s = (JSON.parse(pkgJson) as { scripts?: unknown } | null)?.scripts;
    return s && typeof s === 'object' ? (s as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const has = (s: Record<string, unknown> | null, name: string) => typeof s?.[name] === 'string';

export function chooseRunCommand(pkgJson: string): string[] | null {
  const s = scripts(pkgJson);
  if (has(s, 'dev')) return ['npm', 'run', 'dev'];
  if (has(s, 'start')) return ['npm', 'start'];
  return null;
}

export function chooseTestCommand(pkgJson: string): string[] | null {
  return has(scripts(pkgJson), 'test') ? ['npm', 'test'] : null;
}

const MISSING: Record<ProcessKind, string> = {
  run: 'No "dev" or "start" script in package.json',
  test: 'No "test" script in package.json',
};

async function pump(proc: WebContainerProcess, term: TermSink): Promise<void> {
  const reader = proc.output.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      term.write(value);
    }
  } finally {
    reader.releaseLock();
  }
}

/** Runs install, dev/test commands and shells inside the WebContainer. */
export class ProcessManager {
  private installing: Promise<number> | null = null;
  private readonly procs = new Map<ProcessKind, WebContainerProcess>();
  private readonly shells = new Set<WebContainerProcess>();

  constructor(private readonly wc: WebContainer) {}

  private async spawn(cmd: string[], term: TermSink): Promise<WebContainerProcess> {
    return this.wc.spawn(cmd[0]!, cmd.slice(1), { terminal: { cols: term.cols, rows: term.rows } });
  }

  private async packageJson(): Promise<string | null> {
    try {
      return await this.wc.fs.readFile('package.json', 'utf-8');
    } catch {
      return null;
    }
  }

  /** Installs dependencies once; concurrent and later callers share the result until it fails or is reset. */
  install(term: TermSink): Promise<number> {
    if (!this.installing) {
      const attempt = this.doInstall(term);
      this.installing = attempt;
      void attempt.then(
        (code) => code !== 0 && this.installing === attempt && (this.installing = null),
        () => this.installing === attempt && (this.installing = null),
      );
    }
    return this.installing;
  }

  private async doInstall(term: TermSink): Promise<number> {
    if ((await this.packageJson()) === null) return 0;
    term.write('$ npm install\r\n');
    const proc = await this.spawn(['npm', 'install'], term);
    const [code] = await Promise.all([proc.exit, pump(proc, term)]);
    return code;
  }

  /** `rm -rf node_modules`, then install again. */
  async reinstall(term: TermSink): Promise<number> {
    this.installing = null;
    await this.wc.fs.rm('node_modules', { recursive: true, force: true }).catch(() => {});
    return this.install(term);
  }

  async run(kind: ProcessKind, term: TermSink): Promise<number> {
    this.stop(kind);
    const pkg = await this.packageJson();
    const cmd = pkg === null ? null : kind === 'run' ? chooseRunCommand(pkg) : chooseTestCommand(pkg);
    if (!cmd) {
      term.write(`${MISSING[kind]}\r\n`);
      return 1;
    }
    await this.install(term);
    term.write(`$ ${cmd.join(' ')}\r\n`);
    const proc = await this.spawn(cmd, term);
    this.procs.set(kind, proc);
    try {
      const [code] = await Promise.all([proc.exit, pump(proc, term)]);
      return code;
    } finally {
      if (this.procs.get(kind) === proc) this.procs.delete(kind);
    }
  }

  stop(kind: ProcessKind): void {
    this.procs.get(kind)?.kill();
    this.procs.delete(kind);
  }

  async shell(term: TermSink): Promise<void> {
    const proc = await this.wc.spawn('jsh', { terminal: { cols: term.cols, rows: term.rows } });
    this.shells.add(proc);
    const writer = proc.input.getWriter();
    const off = term.onInput?.((d) => void writer.write(d).catch(() => {}));
    try {
      await Promise.all([proc.exit, pump(proc, term)]);
    } finally {
      off?.();
      writer.releaseLock();
      this.shells.delete(proc);
    }
  }

  /** Kills every interactive shell started by `shell()`. */
  killShells(): void {
    for (const p of this.shells) p.kill();
    this.shells.clear();
  }
}
