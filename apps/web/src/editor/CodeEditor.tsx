import { useEffect, useImperativeHandle, useRef, type Ref } from 'react';
import type { Awareness } from 'y-protocols/awareness';
import type * as Y from 'yjs';
import { MonacoBinding } from 'y-monaco';
import { getFiles, LIMITS } from '@webcode/shared';
import { usePeers, remoteCursorCss } from '../collab/presence';
import { useToast } from '../components/Toast';
import { monaco } from './monacoSetup';

export type EditorHandle = {
  /** Runs a Monaco action such as `actions.find` or `editor.action.formatDocument`. */
  trigger(actionId: string): void;
  focus(): void;
};

type Props = {
  doc: Y.Doc;
  awareness: Awareness | null;
  path: string | null;
  readOnly: boolean;
  hideCursors?: boolean;
  ref?: Ref<EditorHandle>;
};

const utf8 = new TextEncoder();

export function CodeEditor({ doc, awareness, path, readOnly, hideCursors, ref }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const models = useRef(new Set<monaco.editor.ITextModel>());
  const toast = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const peers = usePeers(awareness);

  useImperativeHandle(ref, () => ({
    trigger: (id) => {
      const e = editorRef.current;
      if (!e) return;
      e.focus();
      const action = e.getAction(id);
      if (action) void action.run();
      else e.trigger('webcode', id, null);
    },
    focus: () => editorRef.current?.focus(),
  }));

  useEffect(() => {
    const editor = monaco.editor.create(host.current!, {
      model: null,
      theme: 'webcode-dark',
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: 13,
      fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
      scrollBeyondLastLine: false,
      readOnly: true,
    });
    editorRef.current = editor;
    const attempt = editor.onDidAttemptReadOnlyEdit(() => toastRef.current('You have view access'));
    const modelSet = models.current;
    return () => {
      attempt.dispose();
      editor.dispose();
      editorRef.current = null;
      modelSet.forEach((m) => m.dispose());
      modelSet.clear();
    };
  }, []);

  useEffect(() => {
    editorRef.current?.updateOptions({ readOnly });
  }, [readOnly]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const ytext = path ? getFiles(doc).get(path) : undefined;
    if (!path || !ytext) {
      editor.setModel(null);
      return;
    }
    const uri = monaco.Uri.file(path);
    const model = monaco.editor.getModel(uri) ?? monaco.editor.createModel('', undefined, uri);
    models.current.add(model);
    editor.setModel(model);
    const binding = new MonacoBinding(ytext, model, new Set([editor]), awareness ?? undefined);
    // Changes applied from other peers (y -> model) must never be undone locally; only guard local edits.
    let remote = false;
    const onBefore = (tr: Y.Transaction) => { remote = tr.origin !== binding; };
    const onAfter = () => { remote = false; };
    doc.on('beforeTransaction', onBefore);
    doc.on('afterTransaction', onAfter);
    const sizeGuard = model.onDidChangeContent((e) => {
      if (remote || e.isUndoing || model.getValueLength() * 3 <= LIMITS.maxFileBytes) return;
      if (utf8.encode(model.getValue()).length > LIMITS.maxFileBytes) {
        editor.trigger('webcode', 'undo', null);
        toastRef.current("Files can't be larger than 1 MB");
      }
    });
    return () => {
      sizeGuard.dispose();
      doc.off('beforeTransaction', onBefore);
      doc.off('afterTransaction', onAfter);
      binding.destroy();
      if (!getFiles(doc).has(path)) {
        model.dispose();
        models.current.delete(model);
      }
    };
  }, [doc, awareness, path]);

  return (
    <div className={`editor-host${hideCursors ? ' hide-cursors' : ''}`}>
      <style>{remoteCursorCss(peers)}</style>
      <div ref={host} className="editor-surface" />
      {!path && <div className="editor-empty">Open a file from the explorer</div>}
    </div>
  );
}
