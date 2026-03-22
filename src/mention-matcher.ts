/**
 * Case-insensitive word-boundary matching for mention identifiers.
 * Identifiers shorter than 3 characters are rejected.
 */
export function matchesMention(text: string, identifiers: string[]): boolean {
  if (!text || identifiers.length === 0) return false;

  const lowerText = text.toLowerCase();

  for (const id of identifiers) {
    if (id.length < 3) continue;

    const lowerIdent = id.toLowerCase();
    const escaped = lowerIdent.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`(?:^|[^a-zA-Z0-9])${escaped}(?:$|[^a-zA-Z0-9])`);
    if (pattern.test(lowerText)) return true;
  }

  return false;
}

/**
 * Extract a short excerpt around the first mention match.
 */
export function extractExcerpt(text: string, identifiers: string[]): string {
  if (!text) return "";

  for (const id of identifiers) {
    if (id.length < 3) continue;

    const escaped = id.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`(?:^|[^a-zA-Z0-9])${escaped}(?:$|[^a-zA-Z0-9])`, "i");
    const match = pattern.exec(text);
    if (!match) continue;

    const idx = match[0].startsWith(id.charAt(0).toLowerCase()) || match[0].startsWith(id.charAt(0).toUpperCase())
      ? match.index
      : match.index + 1;

    const start = Math.max(0, idx - 50);
    const end = Math.min(text.length, idx + id.length + 50);
    let excerpt = text.slice(start, end);

    if (start > 0) {
      const spaceIdx = excerpt.indexOf(" ");
      if (spaceIdx !== -1 && spaceIdx < 10) {
        excerpt = excerpt.slice(spaceIdx + 1);
      }
    }
    if (end < text.length) {
      const lastSpace = excerpt.lastIndexOf(" ");
      if (lastSpace !== -1 && lastSpace > excerpt.length - 10) {
        excerpt = excerpt.slice(0, lastSpace);
      }
    }

    return excerpt;
  }

  return text.slice(0, 100);
}
