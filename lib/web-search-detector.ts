/**
 * Adaptive Web Search Intent Detector & Query Cleaner
 * Determines whether a user query requires real-time / live web search,
 * keeping search optional even when the "Browse" capability toggle is ON.
 */

export function isRealTimeSearchNeeded(text: string): boolean {
  if (!text || typeof text !== 'string') return false;
  const t = text.trim().toLowerCase();
  if (t.length < 3) return false;

  // Technical or algorithmic concepts with "search" that should NOT trigger internet browsing
  const isAlgorithmConcept =
    /\b(binary|linear|depth\s*first|breadth\s*first|tree|graph|heuristic|grid|interpolation|exponential|a\*|dijkstra|fibonacci)\s*search\b/i.test(t) ||
    /\bsearch\s*(algorithm|complexity|tree|pattern|implementation|code|space|method)\b/i.test(t);

  // Explicit user requests to search or browse the web
  const hasExplicitWebSearch =
    /\b(search\s+(the\s+)?(web|internet|net|online)|browse\s+(the\s+)?(web|internet|net)|check\s*online|web\s*search|google\s+this|google\s+it|look\s*up\s+online)\b/i.test(t) ||
    (!isAlgorithmConcept && /^(please\s+)?(search|look\s*up|browse|google)\b/i.test(t));
  if (hasExplicitWebSearch) return true;

  // Science / Physics exceptions for the word "current" (electric current, alternating current, etc.)
  const isPhysicsCurrent =
    /\b(alternating|direct|electric|ocean|eddy|displacement|water|loop)\s+current\b/i.test(t) ||
    /\bcurrent\s+(divider|flow|density|source|carrier|rating|sensor)\b/i.test(t) ||
    /\bcurrent\s+(in\s+physics|electricity|circuit)\b/i.test(t);

  // News, headlines, breaking events
  if (/\b(news|headline|headlines|breaking|what\s+happened|whats\s+happening|developing\s+story)\b/i.test(t)) {
    return true;
  }

  // Updates and latest info requests
  if (/\b(update|updates|updated|recent\s*update|latest\s*update|up\s*to\s*date|latest\s*news|latest\s*development)\b/i.test(t)) {
    return true;
  }

  // Temporal references to current / recent events
  if (!isPhysicsCurrent && /\b(today|yesterday|tomorrow|tonight|this\s+(week|weekend|month|year)|latest|current|currently|recent|recently|right\s+now|nowadays|at\s+the\s+moment|present\s+day)\b/i.test(t)) {
    return true;
  }

  // Live or fluctuating data
  if (/\b(weather|forecast|temperature|humidity)\b/i.test(t)) return true;
  if (/\b(stock|stocks|share\s*price|crypto|bitcoin|btc|eth|ethereum|solana|exchange\s*rate|dollar\s*rate|naira\s*rate|forex)\b/i.test(t)) return true;
  if (/\b(match\s*score|game\s*score|standings|premier\s*league|champions\s*league|world\s*cup|ballon\s*d'or|nba|nfl)\b/i.test(t)) return true;
  if (/\b(election|poll\s*numbers|voting\s*results|who\s+won|who\s+is\s+the\s+current|current\s+president|current\s+prime\s+minister|who\s+is\s+the\s+new)\b/i.test(t)) return true;
  if (/\b(release\s*date|air\s*date|box\s*office|in\s+cinemas|movie\s+schedule)\b/i.test(t)) return true;

  // Explicit mention of recent / upcoming years (2025-2030)
  if (/\b(2025|2026|2027|2028|2029|2030)\b/.test(t)) return true;

  return false;
}

export function cleanSearchQuery(text: string): string {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(/^(can\s+you\s+)?(please\s+)?(search\s+(the\s+)?(web|internet|net|online)\s+(for\s+)?|browse\s+(the\s+)?(web|internet|net)\s+(for\s+)?|look\s*up\s+|google\s+)/i, '')
    .trim() || text;
}
