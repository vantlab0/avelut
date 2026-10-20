/**
 * supabaseStorageService.ts — Centralized Supabase Storage Service
 *
 * Handles storage for:
 * - Profile Avatars (bucket: 'profile_avatars')
 * - Course Materials & Textbooks (bucket: 'materials')
 * - Visual Solver Solution Shares & Images (bucket: 'solution_shares')
 */

import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';

export interface UploadResult {
  url: string | null;
  path: string | null;
  error?: string | null;
  errorCode?: string | null;
  errorStatus?: number | null;
}

class SupabaseStorageService {
  /**
   * Upload a profile avatar or cover image.
   *
   * Paths are scoped to the authenticated user's id (`<uid>/...`), which is the
   * exact predicate enforced by the `profile_avatars` RLS policies. A unique
   * object name avoids overwriting the previous image before the profile row is
   * updated successfully.
   */
  public async uploadProfileImage(
    userId: string,
    file: Blob | File,
    kind: 'avatar' | 'cover' = 'avatar'
  ): Promise<UploadResult> {
    if (!isSupabaseConfigured || !userId) {
      return {
        url: null,
        path: null,
        error: 'Supabase or user is not initialized.',
        errorCode: 'STORAGE_NOT_CONFIGURED',
      };
    }

    if (!file || !file.size) {
      return { url: null, path: null, error: 'The selected image is empty.', errorCode: 'EMPTY_FILE' };
    }

    try {
      const mimeType = file.type || 'image/jpeg';
      const extensionFromName = (file as File).name?.split('.').pop()?.toLowerCase();
      const extensionFromMime = mimeType.split('/')[1]?.toLowerCase();
      const rawExtension = extensionFromName || extensionFromMime || 'jpg';
      const extension = ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(rawExtension)
        ? (rawExtension === 'jpeg' ? 'jpg' : rawExtension)
        : 'jpg';
      const filePath = `${userId}/${kind}_${Date.now()}.${extension}`;

      const { data, error } = await supabase.storage
        .from('profile_avatars')
        .upload(filePath, file, {
          upsert: false,
          contentType: mimeType === 'image/jpg' ? 'image/jpeg' : mimeType,
          cacheControl: '31536000',
        });

      if (error) {
        const numericStatus = error.statusCode ? Number.parseInt(String(error.statusCode), 10) : NaN;
        const errorStatus = Number.isFinite(numericStatus) ? numericStatus : null;
        // Safe diagnostics: no tokens, no signed URLs, no full object paths.
        console.error('[storage] profile image upload failed', {
          kind,
          statusCode: errorStatus,
          errorName: error.name,
          message: String(error.message || '').slice(0, 200),
        });
        return {
          url: null,
          path: null,
          error: error.message,
          errorCode: error.name || (errorStatus ? String(errorStatus) : 'STORAGE_ERROR'),
          errorStatus,
        };
      }

      const { data: publicUrlData } = supabase.storage
        .from('profile_avatars')
        .getPublicUrl(data.path);

      if (!publicUrlData?.publicUrl) {
        console.error('[storage] profile image uploaded but public URL is missing', { kind });
        return {
          url: null,
          path: data.path,
          error: 'Storage returned no public URL for the uploaded image.',
          errorCode: 'MISSING_PUBLIC_URL',
        };
      }

      return {
        url: publicUrlData.publicUrl,
        path: data.path,
        error: null,
      };
    } catch (err: any) {
      console.error('[storage] profile image upload threw', {
        kind,
        name: err?.name,
        message: String(err?.message || err).slice(0, 200),
      });
      return {
        url: null,
        path: null,
        error: err?.message || 'Image upload failed.',
        errorCode: err?.name || 'STORAGE_EXCEPTION',
      };
    }
  }

  /**
   * Backwards-compatible avatar upload used by older callers.
   */
  public async uploadAvatar(userId: string, file: Blob | File): Promise<UploadResult> {
    return this.uploadProfileImage(userId, file, 'avatar');
  }

  /**
   * Upload Course Material / Textbook PDF
   */
  public async uploadMaterial(
    userId: string,
    file: File | Blob,
    filename: string,
    onProgress?: (progress: number) => void
  ): Promise<UploadResult> {
    if (!isSupabaseConfigured) {
      return { url: null, path: null, error: 'Supabase is not configured' };
    }

    try {
      const sanitizedFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
      const filePath = `${userId || 'shared'}/${Date.now()}_${sanitizedFilename}`;

      const { data, error } = await supabase.storage
        .from('materials')
        .upload(filePath, file, {
          upsert: true,
          contentType: file.type || 'application/pdf',
        });

      if (error) {
        return { url: null, path: null, error: error.message };
      }

      const { data: publicUrlData } = supabase.storage
        .from('materials')
        .getPublicUrl(data.path);

      onProgress?.(100);

      return {
        url: publicUrlData.publicUrl,
        path: data.path,
        error: null,
      };
    } catch (err: any) {
      return { url: null, path: null, error: err.message || 'Material upload failed' };
    }
  }

  /**
   * Upload Visual Solver Scan Image
   */
  public async uploadVisualScan(userId: string, imageBlob: Blob): Promise<UploadResult> {
    if (!isSupabaseConfigured) {
      return { url: null, path: null, error: 'Supabase is not configured' };
    }

    try {
      const filePath = `${userId || 'guest'}/scan_${Date.now()}.jpg`;

      const { data, error } = await supabase.storage
        .from('solution_shares')
        .upload(filePath, imageBlob, {
          upsert: true,
          contentType: 'image/jpeg',
        });

      if (error) {
        return { url: null, path: null, error: error.message };
      }

      const { data: publicUrlData } = supabase.storage
        .from('solution_shares')
        .getPublicUrl(data.path);

      return {
        url: publicUrlData.publicUrl,
        path: data.path,
        error: null,
      };
    } catch (err: any) {
      return { url: null, path: null, error: err.message || 'Scan upload failed' };
    }
  }

  /**
   * Delete Object from Bucket
   */
  public async deleteFile(bucket: string, path: string): Promise<boolean> {
    if (!isSupabaseConfigured || !path) return false;
    try {
      const { error } = await supabase.storage.from(bucket).remove([path]);
      return !error;
    } catch {
      return false;
    }
  }
}

export const supabaseStorageService = new SupabaseStorageService();
export default supabaseStorageService;
