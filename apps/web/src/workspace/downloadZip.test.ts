import { unzipSync, strFromU8 } from 'fflate';
import { describe, expect, test } from 'vitest';
import { buildZip } from './downloadZip';

describe('buildZip', () => {
  test('puts every entry under the root folder', () => {
    const out = unzipSync(buildZip({ 'src/a.ts': 'x', 'README.md': '# hi' }, 'demo'));
    expect(Object.fromEntries(Object.entries(out).map(([k, v]) => [k, strFromU8(v)]))).toEqual({
      'demo/src/a.ts': 'x',
      'demo/README.md': '# hi',
    });
  });
});
