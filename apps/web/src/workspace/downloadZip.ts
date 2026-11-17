import { zipSync, strToU8 } from 'fflate';

/** A zip of the files, every entry under `rootName/`. */
export function buildZip(files: Record<string, string>, rootName: string): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const [path, content] of Object.entries(files)) entries[`${rootName}/${path}`] = strToU8(content);
  return zipSync(entries);
}

const safeName = (title: string) => title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim() || 'project';

/** Saves the project as `<title>.zip` through the browser's download. */
export function downloadZip(files: Record<string, string>, title: string): void {
  const name = safeName(title);
  const bytes = buildZip(files, name);
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/zip' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name}.zip`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
