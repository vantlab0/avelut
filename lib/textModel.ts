/**
 * Canonical text AI model for every non-voice Avelut AI call.
 *
 * This is the single source of truth for text inference. `qwen/qwen3.7-flash`
 * is accepted only as a legacy alias and is always normalized back to the
 * canonical identifier. Voice/TTS/realtime models are configured separately
 * and must not use this constant.
 */
export const AVELUT_TEXT_MODEL = 'qwen3.7-flash' as const;

export const LEGACY_TEXT_MODEL_ALIAS = 'qwen/qwen3.7-flash' as const;

/**
 * Normalizes any caller-supplied model identifier to the one allowed text
 * model. The `model` argument is intentionally accepted (but ignored) so that
 * existing callers do not need to change their signatures.
 */
export function normalizeTextModel(_model?: string | null): typeof AVELUT_TEXT_MODEL {
  return AVELUT_TEXT_MODEL;
}

export function isLegacyTextModelAlias(model?: string | null): boolean {
  return typeof model === 'string' && model.trim().toLowerCase() === LEGACY_TEXT_MODEL_ALIAS;
}
