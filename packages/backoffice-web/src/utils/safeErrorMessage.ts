/**
 * Safely extract error message from API response.
 * Handles: string, string[], object with message, etc.
 * Prevents React crash #310 (object rendered as child).
 */
export function safeErrorMessage(err: any, fallback = 'Erreur inattendue'): string {
  const msg = err?.response?.data?.message ?? err?.message;
  if (typeof msg === 'string') return msg;
  if (Array.isArray(msg)) return msg.map(String).join(', ');
  if (msg && typeof msg === 'object') return JSON.stringify(msg);
  return fallback;
}
