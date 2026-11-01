// Registry text arrives as escaped Markdown ("HbA1c \>7.5%"). Unescape it once,
// so bullets, sourceText checks and the editor all see the same characters.
export function unescapeRegistry(text: string): string {
  return text.replace(/\\([<>*_\[\]#~`|-])/g, "$1").replace(/\r\n?/g, "\n");
}

// Collapse whitespace and unify quotes/dashes. Used for substring checks so a
// re-wrapped line or a curly quote doesn't fail traceability.
export function normalizeForMatch(text: string): string {
  return unescapeRegistry(text)
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}
