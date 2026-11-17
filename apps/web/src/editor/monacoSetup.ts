import './monacoCore';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
import { javascriptDefaults, typescriptDefaults } from 'monaco-editor/esm/vs/languages/features/typescript/register.js';
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

// Monaco is bundled with the app (no CDN); each language service runs in its own worker.
self.MonacoEnvironment = {
  getWorker(_id: string, label: string) {
    if (label === 'typescript' || label === 'javascript') return new TsWorker();
    if (label === 'json') return new JsonWorker();
    if (label === 'css' || label === 'scss' || label === 'less') return new CssWorker();
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new HtmlWorker();
    return new EditorWorker();
  },
};

monaco.editor.defineTheme('webcode-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#26272a',
    'editorGutter.background': '#26272a',
    'editorLineNumber.foreground': '#5f6368',
    'editorLineNumber.activeForeground': '#a6a8ab',
    'editor.selectionBackground': '#8ab4f833',
    'editor.inactiveSelectionBackground': '#8ab4f81f',
    'editor.lineHighlightBackground': '#2f3034',
    'editorCursor.foreground': '#8ab4f8',
  },
});

// Imports of packages that are not in the editor's virtual file system would all be flagged.
for (const defaults of [typescriptDefaults, javascriptDefaults]) {
  defaults.setDiagnosticsOptions({ noSemanticValidation: true });
}

export { monaco };
