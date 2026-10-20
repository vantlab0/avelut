import { describe, expect, it } from 'vitest';
import {
  MAX_PROFILE_IMAGE_BYTES,
  UploadError,
  classifyUploadError,
  describeUploadFailure,
  resolveImageMimeType,
  validateProfileImage,
} from '../utils/uploadErrors';

const imageFile = (name: string, type: string, size = 1024) => {
  const file = new File([new Uint8Array(Math.max(size, 1))], name, { type });
  if (file.size !== size) {
    Object.defineProperty(file, 'size', { value: size });
  }
  return file;
};

describe('validateProfileImage', () => {
  it('accepts supported raster image types', () => {
    expect(() => validateProfileImage(imageFile('avatar.jpg', 'image/jpeg'))).not.toThrow();
    expect(() => validateProfileImage(imageFile('avatar.png', 'image/png'))).not.toThrow();
    expect(() => validateProfileImage(imageFile('avatar.webp', 'image/webp'))).not.toThrow();
    expect(() => validateProfileImage(imageFile('avatar.gif', 'image/gif'))).not.toThrow();
  });

  it('rejects empty files and unsupported types with actionable errors', () => {
    expect(() => validateProfileImage(imageFile('empty.jpg', 'image/jpeg', 0))).toThrow(
      /empty/i
    );
    expect(() => validateProfileImage(imageFile('avatar.svg', 'image/svg+xml'))).toThrow(
      /JPG, PNG, WebP, or GIF/
    );
    expect(() => validateProfileImage(imageFile('avatar.pdf', 'application/pdf'))).toThrow(
      /JPG, PNG, WebP, or GIF/
    );
  });

  it('explains HEIC/HEIF browser incompatibility', () => {
    expect(() => validateProfileImage(imageFile('photo.heic', 'image/heic'))).toThrow(
      /HEIC\/HEIF/
    );
    expect(() => validateProfileImage(imageFile('photo.heif', ''))).toThrow(/HEIC\/HEIF/);
  });

  it('rejects files over the 5 MB limit', () => {
    expect(() =>
      validateProfileImage(imageFile('huge.jpg', 'image/jpeg', MAX_PROFILE_IMAGE_BYTES + 1))
    ).toThrow(/5 MB/);
  });

  it('infers missing MIME types from the extension only when needed', () => {
    expect(resolveImageMimeType({ name: 'photo.PNG', type: '' })).toBe('image/png');
    expect(resolveImageMimeType({ name: 'photo.bin', type: 'image/webp' })).toBe('image/webp');
    expect(resolveImageMimeType({ name: 'photo.unknown', type: '' })).toBe('');
  });
});

describe('classifyUploadError', () => {
  it('maps expired sessions to auth errors', () => {
    expect(classifyUploadError({ message: 'JWT expired', statusCode: 401 }).kind).toBe('auth');
    expect(classifyUploadError({ message: 'not authenticated' }).kind).toBe('auth');
  });

  it('maps RLS / permission failures separately from auth', () => {
    const error = classifyUploadError({
      message: 'new row violates row-level security policy',
      statusCode: 403,
    });
    expect(error.kind).toBe('permission');
    expect(error.message).toMatch(/permissions/i);
  });

  it('maps missing buckets and configuration problems', () => {
    expect(classifyUploadError({ message: 'Bucket not found' }).kind).toBe('configuration');
    expect(classifyUploadError({ message: 'Supabase is not configured' }).kind).toBe('configuration');
  });

  it('maps quota / payload errors and network failures', () => {
    expect(classifyUploadError({ message: 'Payload too large', statusCode: 413 }).kind).toBe('quota');
    expect(classifyUploadError({ message: 'exceeded storage quota' }).kind).toBe('quota');
    expect(classifyUploadError({ name: 'TypeError', message: 'Failed to fetch' }).kind).toBe('network');
    expect(classifyUploadError({ message: 'NetworkError when attempting to fetch resource.' }).kind).toBe(
      'network'
    );
  });

  it('preserves an already classified error', () => {
    const original = new UploadError('decode', 'bad image');
    expect(classifyUploadError(original)).toBe(original);
  });

  it('falls back to a generic storage error', () => {
    expect(classifyUploadError({ message: 'something unusual' }).kind).toBe('storage');
  });
});

describe('describeUploadFailure', () => {
  it('returns the underlying message for actionable categories', () => {
    const message = describeUploadFailure(
      new UploadError('invalid_type', 'Please choose a JPG, PNG, WebP, or GIF image.'),
      'avatar'
    );
    expect(message).toBe('Please choose a JPG, PNG, WebP, or GIF image.');
  });

  it('explains partial success when the profile update fails after upload', () => {
    const message = describeUploadFailure(new UploadError('profile_update', 'db failed'), 'cover');
    expect(message).toMatch(/image uploaded/i);
    expect(message).toMatch(/cover photo/i);
  });

  it('uses a safe generic message for unknown failures', () => {
    const message = describeUploadFailure(new UploadError('storage', 'raw internals'), 'avatar');
    expect(message).toBe('Could not update your profile picture. Please try again.');
  });
});
