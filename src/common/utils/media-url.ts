/** Normaliza URLs de mídia para caminho relativo (/storage/...) no banco e nas respostas da API */
export function normalizeMediaUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('/storage/')) return trimmed;

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      if (parsed.pathname.startsWith('/storage/')) {
        return parsed.pathname;
      }
    } catch {
      return trimmed;
    }
  }

  if (trimmed.startsWith('storage/')) return `/${trimmed}`;
  return trimmed;
}
