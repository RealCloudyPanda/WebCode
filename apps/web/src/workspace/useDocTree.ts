import { useEffect, useMemo, useState } from 'react';
import type * as Y from 'yjs';
import { getDirs, getFiles } from '@webcode/shared';
import { listTree, type TreeNode } from '../collab/fileOps';

/** The project's folder tree, re-read whenever files or folders change. */
export function useDocTree(doc: Y.Doc): TreeNode[] {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    const files = getFiles(doc);
    const dirs = getDirs(doc);
    files.observe(bump);
    dirs.observe(bump);
    return () => {
      files.unobserve(bump);
      dirs.unobserve(bump);
    };
  }, [doc]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => listTree(doc), [doc, version]);
}
