/**
 * Scene-id mention matching for visual-refine review notes.
 *
 * A single implementation shared by the Harness submission plugin (in-turn
 * synchronous check, no history access) and Main-side validation, so both
 * layers accept exactly the same spellings. Matching is intentionally
 * lenient: canonical `scene-01` plus case/diacritic-tolerant Vietnamese
 * forms (`Cảnh 01`, `canh 1`, `CẢNH THỨ 3`). Digit forms only — Vietnamese
 * number words are out of scope; rejections always quote the canonical ids
 * to copy. Numeric tokens are boundary-guarded so `scene-11` never satisfies
 * `scene-01`.
 */

/** Lowercase + strip diacritics so `Cảnh` and `canh` compare equal. */
export function normalizeMentionText(value: string): string {
  // Explicit combining-diacriticals range (U+0300–U+036F); never a literal range.
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function mentionPattern(sceneId: string): RegExp | null {
  const match = /^([a-z]+)-0*(\d+)$/i.exec(sceneId.trim());
  if (!match) return null;
  const digits = match[2]!;
  const alternatives = match[1]!.toLowerCase() === "scene"
    ? ["scene", "canh"]
    : [match[1]!.toLowerCase()];
  const names = alternatives.join("|");
  // `canh thu 3` (cảnh thứ 3) is accepted alongside `canh 3`.
  return new RegExp(`(?:${names})(?:[-\\s]?(?:thu\\s+)?0*${digits})(?!\\d)`);
}

/**
 * Return the scoped scene ids NOT mentioned in review notes.
 * Empty scope ⇒ []. Unparseable ids are treated as missing (fail closed).
 */
export function missingSceneMentions(notes: string, sceneIds: readonly string[]): string[] {
  if (sceneIds.length === 0) return [];
  const text = normalizeMentionText(notes);
  return sceneIds.filter((id) => {
    const pattern = mentionPattern(id);
    return !pattern || !pattern.test(text);
  });
}
