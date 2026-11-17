import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import type { ProcessManager, ProcessKind, TermSink } from '../runtime/processes';

/** A terminal's output channel that works before (and after) its xterm view exists. */
export class BufferedSink implements TermSink {
  cols = 80;
  rows = 24;
  private term: Terminal | null = null;
  private pending: string[] = [];
  private listeners = new Set<(d: string) => void>();

  write(data: string): void {
    if (this.term) this.term.write(data);
    else this.pending.push(data);
  }
  clear(): void {
    this.pending = [];
    this.term?.clear();
  }
  onInput(listener: (d: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  attach(term: Terminal): void {
    this.term = term;
    this.cols = term.cols;
    this.rows = term.rows;
    this.pending.splice(0).forEach((d) => term.write(d));
  }
  detach(): void {
    this.term = null;
  }
  emitInput(d: string): void {
    this.listeners.forEach((l) => l(d));
  }
}

type Tab = { id: string; kind: 'shell' | ProcessKind; label: string };

export type TerminalHandle = {
  /** The Run or Test tab's sink; `show` also brings the tab to the front. */
  sink(kind: ProcessKind, show: boolean): TermSink;
  newShell(): void;
  clear(): void;
};

function TermView({ sink, active }: { sink: BufferedSink; active: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const fitRef = useRef<FitAddon | null>(null);
  useEffect(() => {
    const term = new Terminal({
      fontSize: 12,
      fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
      convertEol: false,
      theme: { background: '#0d1411', foreground: '#e3e3e3', cursor: '#7dd3a0', selectionBackground: '#7dd3a04d' },
    });
    const fit = new FitAddon();
    fitRef.current = fit;
    term.loadAddon(fit);
    term.open(host.current!);
    try {
      fit.fit();
    } catch {
      /* hidden panel has no size yet */
    }
    sink.attach(term);
    const input = term.onData((d) => sink.emitInput(d));
    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
        sink.cols = term.cols;
        sink.rows = term.rows;
      } catch {
        /* not visible */
      }
    });
    ro.observe(host.current!);
    return () => {
      ro.disconnect();
      input.dispose();
      sink.detach();
      term.dispose();
    };
  }, [sink]);
  return <div ref={host} className="term-view" style={{ display: active ? 'block' : 'none' }} />;
}

type Props = {
  ref?: Ref<TerminalHandle>;
  manager: ProcessManager | null;
  /** Set when running code is not possible here. */
  unsupported: string | null;
};

export function TerminalPanel({ ref, manager, unsupported }: Props) {
  const sinks = useRef(new Map<string, BufferedSink>());
  const shells = useRef(0);
  const started = useRef(new Set<string>());
  const [tabs, setTabs] = useState<Tab[]>([{ id: 'shell-1', kind: 'shell', label: 'Shell' }]);
  const [active, setActive] = useState('shell-1');
  const activeRef = useRef(active);
  activeRef.current = active;

  const sinkFor = (id: string) => {
    let s = sinks.current.get(id);
    if (!s) sinks.current.set(id, (s = new BufferedSink()));
    return s;
  };

  useImperativeHandle(ref, () => ({
    sink(kind, show) {
      const id = kind;
      setTabs((t) => (t.some((x) => x.id === id) ? t : [...t, { id, kind, label: kind === 'run' ? 'Run' : 'Test' }]));
      if (show) setActive(id);
      return sinkFor(id);
    },
    newShell() {
      const n = ++shells.current + 1;
      const id = `shell-${n}`;
      setTabs((t) => [...t, { id, kind: 'shell', label: `Shell ${n}` }]);
      setActive(id);
    },
    clear: () => sinks.current.get(activeRef.current)?.clear(),
  }));

  useEffect(() => {
    if (!manager) return;
    for (const t of tabs) {
      if (t.kind !== 'shell' || started.current.has(t.id)) continue;
      started.current.add(t.id);
      const sink = sinkFor(t.id);
      manager.shell(sink).catch((e) => sink.write(`\r\nShell failed: ${e instanceof Error ? e.message : e}\r\n`));
    }
  }, [manager, tabs]);

  // Kill the jsh processes when the manager goes away (unmount or project switch); a new manager starts fresh shells.
  useEffect(() => {
    if (!manager) return;
    const set = started.current;
    return () => {
      manager.killShells();
      set.clear();
    };
  }, [manager]);

  return (
    <section className="terminal" aria-label="Terminal">
      <div className="terminal-head">
        <div className="term-tabs" role="tablist">
          {tabs.map((t) => (
            <button key={t.id} role="tab" aria-selected={t.id === active} className={`term-tab${t.id === active ? ' on' : ''}`} onClick={() => setActive(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
        <span className="term-label">Terminal · runs in your browser</span>
      </div>
      {unsupported ? (
        <p className="term-unsupported">{unsupported}</p>
      ) : (
        <div className="term-body">
          {tabs.map((t) => (
            <TermView key={t.id} sink={sinkFor(t.id)} active={t.id === active} />
          ))}
        </div>
      )}
    </section>
  );
}
