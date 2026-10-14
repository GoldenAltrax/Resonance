import { describe, it, expect } from 'vitest';
import { classifyUploadUrl } from './uploadPaths.js';

describe('classifyUploadUrl', () => {
  it('serves images and ignores non-upload URLs', () => {
    expect(classifyUploadUrl('/uploads/images/cover-1.jpg')).toBe('public');
    expect(classifyUploadUrl('/uploads/images/cover-1.jpg?v=2')).toBe('public');
    expect(classifyUploadUrl('/api/tracks')).toBeNull();
  });

  it('blocks audio, including traversal and encoding tricks', () => {
    for (const url of [
      '/uploads/audio/x.mp3',
      '/UPLOADS/audio/x.mp3',
      '/uploads/images/../audio/x.mp3',
      '/uploads/images/%2e%2e/audio/x.mp3',
      '/uploads/images/..%2faudio/x.mp3',
      '/uploads/images/..%5caudio/x.mp3',
      '/uploads',
    ]) {
      expect(classifyUploadUrl(url), url).toBe('blocked');
    }
  });

  it('rejects malformed escapes', () => {
    expect(classifyUploadUrl('/uploads/images/%zz')).toBe('bad');
  });
});
