/**
 * Deno-compatible twin of ../../../lib/textModel.ts for Supabase Edge Functions.
 * Keep both files in sync — this is the only text model allowed in Avelut.
 * `qwen/qwen3.7-flash` is a legacy alias and is always normalized here.
 */
export const AVELUT_TEXT_MODEL = "qwen3.7-flash";

export const LEGACY_TEXT_MODEL_ALIAS = "qwen/qwen3.7-flash";

/** Caller-supplied models are accepted for compatibility but ignored. */
export function normalizeTextModel(_model?: string | null): string {
  return AVELUT_TEXT_MODEL;
}

export function isLegacyTextModelAlias(model?: string | null): boolean {
  return typeof model === "string" && model.trim().toLowerCase() === LEGACY_TEXT_MODEL_ALIAS;
}
