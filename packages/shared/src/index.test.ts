import { describe, expect, it } from 'vitest';
import * as shared from './index';

describe('shared', () => {
  it('exports a VERSION string', () => {
    expect(typeof shared.VERSION).toBe('string');
  });
});
