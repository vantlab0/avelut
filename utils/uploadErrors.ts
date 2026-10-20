/**
 * Upload validation and error classification.
 *
 * Storage failures have very different remedies (expired session, RLS policy,
 * file too large, offline). The UI must not collapse all of them into
 * "check your connection".
 */

export const MAX_PROFILE_IMAGE_BYTES = 5 * 1024 * 1024;
export const SUPPORTED_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
] as const;

export type UploadFailureKind =
  | 'invalid_type'
  | 'too_large'
  | 'empty'
  | 'auth'
  | 'permission'
  | 'network'
  | 'quota'
  | 'configuration'
  | 'decode'
  | 'storage'
  | 'profile_update'
  | 'unknown';

export class UploadError extends Error {
  readonly kind: UploadFailureKind;
  readonly causeCode?: string;

  constructor(kind: UploadFailureKind, message: string, causeCode?: string) {
    super(message);
    this.name = 'UploadError';
    this.kind = kind;
    this.causeCode = causeCode;
  }
}

export interface UploadFileLike {
  name?: string;
  type?: string;
  size?: number;
}

const extensionMime: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
};

/** Infer a MIME type from the file extension when the browser reports none. */
export function resolveImageMimeType(file: UploadFileLike): string {
  const declared = (file.type || '').toLowerCase();
  if (declared.startsWith('image/')) return declared;
  const ext = file.name?.split('.').pop()?.toLowerCase() || '';
  return extensionMime[ext] || declared;
}

export function validateProfileImage(file: UploadFileLike): void {
  if (!file || !file.size) {
    throw new UploadError('empty', 'That file is empty. Please choose another image.');
  }
  const mime = resolveImageMimeType(file);
  if (!(SUPPORTED_IMAGE_MIME_TYPES as readonly string[]).includes(mime)) {
    const extension = file.name?.split('.').pop()?.toUpperCase();
    if (extension === 'HEIC' || extension === 'HEIF' || mime === 'image/heic' || mime === 'image/heif') {
      throw new UploadError(
        'invalid_type',
        'HEIC/HEIF photos are not supported by the browser uploader. Export the photo as JPG or PNG and try again.'
      );
    }
    throw new UploadError('invalid_type', 'Please choose a JPG, PNG, WebP, or GIF image.');
  }
  if (file.size > MAX_PROFILE_IMAGE_BYTES) {
    throw new UploadError('too_large', 'That image is larger than 5 MB. Choose a smaller image and try again.');
  }
}

interface StorageErrorLike {
  message?: string;
  error?: string;
  status?: number;
  statusCode?: number | string;
  name?: string;
  code?: string;
}

/** Classify a Supabase storage / network error without leaking raw internals. */
export function classifyUploadError(error: unknown): UploadError {
  if (error instanceof UploadError) return error;

  const raw = error as StorageErrorLike | null | undefined;
  const message = String(raw?.message || raw?.error || (error instanceof Error ? error.message : '') || '');
  const lower = message.toLowerCase();
  const status = Number(raw?.statusCode ?? raw?.status ?? 0);
  const name = String(raw?.name || '');
  const code = String(raw?.code || '');

  if (
    status === 401 ||
    lower.includes('jwt') ||
    lower.includes('session') ||
    lower.includes('not authenticated') ||
    lower.includes('invalid claim')
  ) {
    return new UploadError('auth', 'Your session has expired. Sign in again and retry the upload.', code || undefined);
  }

  if (
    status === 403 ||
    lower.includes('row-level security') ||
    lower.includes('row level security') ||
    lower.includes('violates') ||
    lower.includes('unauthorized') ||
    lower.includes('permission denied')
  ) {
    return new UploadError(
      'permission',
      'Storage permissions blocked this upload. Confirm you are signed in, then contact support if it continues.',
      code || undefined
    );
  }

  if (
    lower.includes('bucket not found') ||
    lower.includes('bucket does not exist') ||
    lower.includes('supabase is not configured') ||
    lower.includes('not initialized')
  ) {
    return new UploadError('configuration', 'Image storage is not configured on this deployment.', code || undefined);
  }

  if (
    status === 413 ||
    lower.includes('payload too large') ||
    lower.includes('too large') ||
    lower.includes('exceeded') ||
    lower.includes('quota')
  ) {
    return new UploadError('quota', 'The server rejected the image size. Try a smaller image.', code || undefined);
  }

  if (
    name === 'TypeError' ||
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('network error') ||
    lower.includes('load failed') ||
    lower.includes('offline') ||
    lower.includes('timeout')
  ) {
    return new UploadError('network', "Couldn't reach image storage. Check your connection and try again.", code || undefined);
  }

  return new UploadError('storage', 'The image could not be uploaded. Please try again.', code || undefined);
}

export function describeUploadFailure(error: unknown, type: 'avatar' | 'cover'): string {
  const classified = classifyUploadError(error);
  const label = type === 'avatar' ? 'profile picture' : 'cover photo';
  switch (classified.kind) {
    case 'invalid_type':
    case 'too_large':
    case 'empty':
    case 'auth':
    case 'permission':
    case 'network':
    case 'quota':
    case 'configuration':
      return classified.message;
    case 'decode':
      return `That image could not be processed. Choose a different JPG, PNG, WebP, or GIF for your ${label}.`;
    case 'profile_update':
      return `The image uploaded, but your ${label} could not be saved to your profile. Please try again.`;
    default:
      return `Could not update your ${label}. Please try again.`;
  }
}
