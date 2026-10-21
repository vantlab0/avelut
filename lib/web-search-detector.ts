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
    /\b(binary|linear|depth\s*first|breadth\s*first|tree|graph|heuristic|grid|interpolation|exponential|a\*|dijkstra)\s*search\b/i.test(t) ||
    /\bsearch\s*(algorithm|complexity|tree|pattern|implementation|code)\b/i.test(t);

  // Explicit user requests to search or browse the web
  const hasExplicitWebSearch =
    /\b(search\s+(the\s+)?(web|internet|net|online)|browse\s+(the\s+)?(web|internet|net)|check\s*online|web\s*search|google\s+this|google\s+it)\b/i.test(t) ||
    (!isAlgorithmConcept && /^(please\s+)?(search|look\s*up|browse|google)\b/i.test(t));
  if (hasExplicitWebSearch) return true;

  // News, headlines, breaking events
  if (/\b(news|headline|headlines|breaking|what\s+happened|whats\s+happening|developing\s+story)\b/i.test(t)) {
    return true;
  }

  // Temporal references to current / recent events
  if (/\b(today|yesterday|tomorrow|tonight|this\s+(week|weekend|month|year)|latest|current|currently|recent|recently|right\s+now|nowadays|at\s+the\s+moment)\b/i.test(t)) {
    return true;
  }

  // Live or fluctuating data
  if (/\b(weather|forecast|temperature|humidity)\b/i.test(t)) return true;
  if (/\b(stock|stocks|share\s*price|crypto|bitcoin|btc|eth|ethereum|solana|exchange\s*rate|dollar\s*rate|naira\s*rate|forex)\b/i.test(t)) return true;
  if (/\b(match\s*score|game\s*score|standings|premier\s*league|champions\s*league|world\s*cup|ballon\s*d'or|nba|nfl)\b/i.test(t)) return true;
  if (/\b(election|poll\s*numbers|voting\s*results|who\s+won|who\s+is\s+the\s+current)\b/i.test(t)) return true;
  if (/\b(release\s*date|air\s*date|box\s*office|in\s+cinemas)\b/i.test(t)) return true;

  // Explicit mention of recent / upcoming years (2024-2030)
  if (/\b(2025|2026|2027|2028|2029|2030)\b/.test(t)) return true;

  return false;
}

export function cleanSearchQuery(text: string): string {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(/^(can\s+you\s+)?(please\s+)?(search\s+(the\s+)?(web|internet|net|online)\s+(for\s+)?|browse\s+(the\s+)?(web|internet|net)\s+(for\s+)?|look\s*up\s+|google\s+)/i, '')
    .trim() || text;
}
