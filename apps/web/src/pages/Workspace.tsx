import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { docToFiles, getFiles, getMeta, pickColor, type Me, type ProjectDetail } from '@webcode/shared';
import { api, ApiFailure } from '../api';
import { setLocalFile, setLocalUser, usePeers, type Peer } from '../collab/presence';
import { useProject, type ProjectConnection, type ProjectRole } from '../collab/useProject';
import { ProcessManager } from '../runtime/processes';
import { SyncEngine } from '../runtime/syncEngine';
import { clearWorkdir, getWebContainer, RuntimeUnsupported, webcontainerFs } from '../runtime/webcontainer';
import { useToast } from '../components/Toast';
import { TopBar } from '../components/TopBar';
import type { EditorHandle } from '../editor/CodeEditor';
import { useMe } from '../session';
import { Banners } from '../workspace/Banners';
import { downloadZip } from '../workspace/downloadZip';
import { ShareDialog } from '../workspace/ShareDialog';
import { EditorTabs } from '../workspace/EditorTabs';
import { Explorer, type ExplorerHandle } from '../workspace/Explorer';
import { FindInFiles } from '../workspace/FindInFiles';
import { JoinDialog } from '../workspace/JoinDialog';
import { MenuBar } from '../workspace/MenuBar';
import { PreviewPanel } from '../workspace/PreviewPanel';
import { TerminalPanel, type TerminalHandle } from '../workspace/TerminalPanel';
import { TitleRow } from '../workspace/TitleRow';
import { Toolbar, type Mode } from '../workspace/Toolbar';
import { useDocTree } from '../workspace/useDocTree';

const CodeEditor = lazy(() => import('../editor/CodeEditor').then((m) => ({ default: m.CodeEditor })));

type Failure = 'no-access' | 'deleted' | 'error';

function NoAccess({ id }: { id: string }) {
  const switchAccount = async () => {
    await api.post('/auth/logout').catch(() => {});
    location.href = `/auth/github?next=${encodeURIComponent(`/p/${id}`)}`;
  };
  return (
    <>
      <TopBar />
      <main className="centered">
        <h1>You need access</h1>
        <p className="muted">Ask the owner to share this project with you.</p>
        <button className="btn" onClick={switchAccount}>Sign in with a different account</button>
      </main>
    </>
  );
}

function Message({ title, text }: { title: string; text?: string }) {
  return (
    <>
      <TopBar />
      <main className="centered">
        <h1>{title}</h1>
        {text && <p className="muted">{text}</p>}
        <Link className="btn" to="/">Go to Webcode home</Link>
      </main>
    </>
  );
}

export function Workspace() {
  const { id = '' } = useParams();
  const { me } = useMe();
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const identified = !!(me && (me.user || me.guest));

  useEffect(() => {
    setDetail(null);
    setFailure(null);
    if (!identified) return;
    let cancelled = false;
    api
      .get<ProjectDetail>(`/api/projects/${encodeURIComponent(id)}`)
      .then((d) => !cancelled && setDetail(d))
      .catch((e) => {
        if (cancelled) return;
        setFailure(e instanceof ApiFailure && e.status === 403 ? 'no-access' : e instanceof ApiFailure && e.status === 404 ? 'deleted' : 'error');
      });
    return () => {
      cancelled = true;
    };
  }, [id, identified]);

  if (!me) return null;
  if (!identified) {
    return (
      <div className="ws ws-blur" aria-hidden={false}>
        <JoinDialog onJoined={() => {}} />
      </div>
    );
  }
  if (failure === 'no-access') return <NoAccess id={id} />;
  if (failure === 'deleted') return <Message title="This project was deleted" />;
  if (failure === 'error') return <Message title="Something went wrong" text="Try again in a moment." />;
  if (!detail) return null;
  return <WorkspaceView key={id} detail={detail} me={me} onDetail={setDetail} />;
}

function useTitle(doc: ProjectConnection['doc'], fallback: string): string {
  const [title, setTitle] = useState(() => getMeta(doc).get('title') ?? fallback);
  useEffect(() => {
    const meta = getMeta(doc);
    const read = () => setTitle(meta.get('title') ?? fallback);
    read();
    meta.observe(read);
    return () => meta.unobserve(read);
  }, [doc, fallback]);
  return title;
}

const UNSUPPORTED_COPY = 'Running code needs a Chromium-based browser (Chrome, Edge, Arc, Brave) or Firefox';

// Container setups run one at a time, so a project switch finishes tearing down before the next starts.
let runtimeChain: Promise<unknown> = Promise.resolve();

const INITIAL_FILES = ['README.md', 'src/index.ts', 'src/index.tsx', 'src/index.js', 'index.js', 'index.html'];

type ViewProps = { detail: ProjectDetail; me: Me; onDetail: (d: ProjectDetail) => void };

function WorkspaceView({ detail, me, onDetail }: ViewProps) {
  const toast = useToast();
  const navigate = useNavigate();
  const conn = useProject(detail.id);
  const { doc, awareness, status, fatal, sizeLocked } = conn;
  const role: ProjectRole = conn.role ?? (detail.role === 'none' ? 'viewer' : detail.role);
  const peers = usePeers(awareness);
  const tree = useDocTree(doc);
  const title = useTitle(doc, detail.title);

  const editorRef = useRef<EditorHandle>(null);
  const explorerRef = useRef<ExplorerHandle>(null);
  const [tabs, setTabs] = useState<string[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('editing');
  const [explorerOpen, setExplorerOpen] = useState(true);
  const [cursors, setCursors] = useState(true);
  const [finding, setFinding] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [starred, setStarred] = useState(false);
  const openedInitial = useRef(false);
  const terminalRef = useRef<TerminalHandle>(null);
  const [manager, setManager] = useState<ProcessManager | null>(null);
  const [unsupported, setUnsupported] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(true);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  const revoked = fatal === 'revoked';
  const locked = conn.readOnly || revoked || (sizeLocked && role !== 'owner');
  const canEdit = !locked;
  const editorReadOnly = locked || mode === 'viewing';

  const canWriteRef = useRef(canEdit);
  canWriteRef.current = canEdit;
  const synced = status !== 'connecting';

  // Mount the project into the container once the document has synced, and keep the two in step.
  useEffect(() => {
    if (!synced) return;
    let cancelled = false;
    let engine: SyncEngine | null = null;
    let mgr: ProcessManager | null = null;
    let offServer: (() => void) | undefined;
    runtimeChain = runtimeChain.then(async () => {
      if (cancelled) return;
      try {
        const wc = await getWebContainer();
        const fs = webcontainerFs(wc);
        await clearWorkdir(fs);
        if (cancelled) return;
        engine = new SyncEngine({
          doc,
          fs,
          canWriteBack: () => canWriteRef.current,
          onSkipped: (path, reason) =>
            toast(reason === 'too-large' ? `${path} is over 1 MB and isn't shared` : `${path} is a binary file and isn't shared`),
        });
        await engine.start();
        if (cancelled) return;
        mgr = new ProcessManager(wc);
        offServer = wc.on('server-ready', (_port, url) => {
          setPreviewUrl(url);
          setPreviewOpen(true);
        });
        setManager(mgr);
        const sink = terminalRef.current?.sink('run', false);
        if (sink) {
          setInstalling(true);
          void mgr.install(sink).finally(() => setInstalling(false));
        }
      } catch (e) {
        if (!cancelled && e instanceof RuntimeUnsupported) setUnsupported(UNSUPPORTED_COPY);
        else if (!cancelled) console.warn('[runtime]', e);
      }
    });
    return () => {
      cancelled = true;
      offServer?.();
      mgr?.stop('run');
      mgr?.stop('test');
      engine?.stop();
      setManager(null);
      setPreviewUrl(null);
      setPreviewOpen(false);
    };
  }, [doc, synced, toast]);

  const showTerminal = () => setTerminalOpen(true);
  const runKind = (kind: 'run' | 'test') => {
    if (!manager) return;
    showTerminal();
    void manager.run(kind, terminalRef.current!.sink(kind, true));
  };
  const reinstall = () => {
    if (!manager) return;
    showTerminal();
    setInstalling(true);
    void manager.reinstall(terminalRef.current!.sink('run', true)).finally(() => setInstalling(false));
  };

  const open = useCallback((path: string) => {
    setTabs((t) => (t.includes(path) ? t : [...t, path]));
    setActive(path);
  }, []);

  // Identify ourselves to everyone else.
  const self = me.user ? { id: me.user.id, name: me.user.name ?? me.user.login, kind: 'github' as const } : me.guest ? { id: me.guest.guestId, name: me.guest.name, kind: 'guest' as const } : null;
  const selfId = self?.id;
  const selfName = self?.name;
  const selfKind = self?.kind;
  useEffect(() => {
    if (!awareness || !selfId || !selfName || !selfKind) return;
    setLocalUser(awareness, { id: selfId, name: selfName, kind: selfKind, color: pickColor(selfId) });
  }, [awareness, selfId, selfName, selfKind]);
  useEffect(() => {
    if (awareness) setLocalFile(awareness, active);
  }, [awareness, active]);

  // Open a sensible first file; close tabs of files that were deleted.
  useEffect(() => {
    const files = getFiles(doc);
    if (!openedInitial.current && files.size > 0) {
      openedInitial.current = true;
      open(INITIAL_FILES.find((p) => files.has(p)) ?? [...files.keys()].sort()[0]!);
    }
    setTabs((t) => {
      const kept = t.filter((p) => files.has(p));
      return kept.length === t.length ? t : kept;
    });
    setActive((a) => (a && !files.has(a) ? null : a));
  }, [tree, doc, open]);
  useEffect(() => {
    if (active === null && tabs.length > 0) setActive(tabs[tabs.length - 1]!);
  }, [active, tabs]);

  const closeTab = (path: string) => {
    setTabs((t) => t.filter((p) => p !== path));
    setActive((a) => {
      if (a !== path) return a;
      const i = tabs.indexOf(path);
      return tabs[i + 1] ?? tabs[i - 1] ?? null;
    });
  };

  const isOwner = role === 'owner';
  const canRename = isOwner || role === 'editor';
  const rename = (t: string) => {
    api
      .patch<ProjectDetail>(`/api/projects/${encodeURIComponent(detail.id)}`, { title: t })
      .then(onDetail)
      .catch((e) => toast(e instanceof Error ? e.message : 'Could not rename'));
  };
  const toggleStar = () => {
    const next = !starred;
    setStarred(next);
    api.patch(`/api/projects/${encodeURIComponent(detail.id)}`, { starred: next }).catch((e) => {
      setStarred(!next);
      toast(e instanceof Error ? e.message : 'Could not update star');
    });
  };
  const jumpToPeer = (p: Peer) => {
    if (p.file && getFiles(doc).has(p.file)) open(p.file);
  };

  const startOver = () => {
    api
      .post<{ id: string }>('/api/demo/start-over')
      .then(({ id }) => navigate(`/p/${id}`))
      .catch((e) => toast(e instanceof Error ? e.message : 'Could not start over'));
  };
  const makeCopy = () => {
    api
      .post<{ id: string }>(`/api/projects/${encodeURIComponent(detail.id)}/copy`)
      .then(({ id }) => navigate(`/p/${id}`))
      .catch((e) => toast(e instanceof Error ? e.message : 'Could not make a copy'));
  };

  const trigger = (id: string) => editorRef.current?.trigger(id);
  const menu = useMemo(
    () => ({
      newFile: () => explorerRef.current?.newFile(),
      newFolder: () => explorerRef.current?.newFolder(),
      rename: () => explorerRef.current?.rename(active),
      remove: () => explorerRef.current?.remove(active),
      makeCopy: me.user ? makeCopy : undefined,
      copyDisabledReason: 'Sign in to make a copy',
      downloadZip: () => downloadZip(docToFiles(doc), title),
      share: () => setSharing(true),
      undo: () => trigger('undo'),
      redo: () => trigger('redo'),
      find: () => trigger('actions.find'),
      replace: () => trigger('editor.action.startFindReplaceAction'),
      findInFiles: () => setFinding(true),
      toggleExplorer: () => setExplorerOpen((v) => !v),
      toggleTerminal: () => setTerminalOpen((v) => !v),
      togglePreview: () => setPreviewOpen((v) => !v),
      run: manager ? () => runKind('run') : undefined,
      test: manager ? () => runKind('test') : undefined,
      stop: manager ? () => (manager.stop('run'), manager.stop('test')) : undefined,
      reinstall: manager ? reinstall : undefined,
      newTerminal: manager ? () => (showTerminal(), terminalRef.current?.newShell()) : undefined,
      clearTerminal: manager ? () => terminalRef.current?.clear() : undefined,
      toggleCursors: () => setCursors((v) => !v),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [active, manager, me.user, title],
  );

  if (fatal === 'deleted') return <Message title="This project was deleted" />;
  if (fatal === 'no-access') return <NoAccess id={detail.id} />;
  if (fatal === 'need-guest') return <div className="ws ws-blur"><JoinDialog onJoined={() => location.reload()} /></div>;
  if (fatal === 'too-many') return <Message title="This project is full right now" text="Too many people are connected. Try again in a few minutes." />;

  return (
    <div className="ws">
      <TitleRow
        title={title}
        canEditTitle={canRename && !revoked}
        onRename={rename}
        starred={starred}
        canStar={!!me.user}
        onToggleStar={toggleStar}
        status={status}
        peers={peers}
        onPeerClick={jumpToPeer}
        onShare={() => setSharing(true)}
        me={me}
      />
      <MenuBar a={menu} readOnly={editorReadOnly} />
      <Toolbar
        path={active}
        canEdit={canEdit}
        mode={mode}
        onMode={setMode}
        onUndo={menu.undo}
        onRedo={menu.redo}
        onFormat={() => trigger('editor.action.formatDocument')}
        onSearch={() => setFinding(true)}
        onRun={menu.run}
        onTest={menu.test}
        runBlockedReason={unsupported}
        installing={installing}
      />
      <Banners detail={detail} me={me} role={role} sizeLocked={sizeLocked} revoked={revoked} onStartOver={startOver} />
      {sharing && <ShareDialog detail={detail} isOwner={isOwner} onChange={onDetail} onClose={() => setSharing(false)} />}
      <div className="ws-body">
        {explorerOpen && <Explorer ref={explorerRef} doc={doc} peers={peers} activePath={active} readOnly={editorReadOnly} onOpen={open} />}
        <div className="ws-main">
          <EditorTabs tabs={tabs} active={active} onSelect={setActive} onClose={closeTab} />
          {finding && <FindInFiles doc={doc} onOpen={(p) => open(p)} onClose={() => setFinding(false)} />}
          <Suspense fallback={<div className="editor-host" />}>
            <CodeEditor ref={editorRef} doc={doc} awareness={awareness} path={active} readOnly={editorReadOnly} hideCursors={!cursors} />
          </Suspense>
          <div style={{ display: terminalOpen ? 'contents' : 'none' }}>
            <TerminalPanel ref={terminalRef} manager={manager} unsupported={unsupported} />
          </div>
        </div>
        {previewUrl && previewOpen && <PreviewPanel url={previewUrl} onClose={() => setPreviewOpen(false)} />}
      </div>
    </div>
  );
}
