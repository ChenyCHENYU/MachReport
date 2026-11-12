const CJK = /[\u3000-\u9fff\uff00-\uffef]/;
/** Expand inter-word spaces, or CJK boundaries when no spaces exist; never stretch a Latin word. */
export function justificationChunks(text: string): string[] {
  const characters = Array.from(text), interiorSpace = /\S\s+\S/.test(text), chunks: string[] = [];
  let current = "";
  const finalContent = text.trimEnd().length;
  let offset = 0;
  for (let index = 0; index < characters.length; index++) {
    const character = characters[index]!, next = characters[index + 1];
    current += character; offset += character.length;
    const gap = interiorSpace ? character === " " && offset < finalContent && /\S/.test(current) : next !== undefined && (CJK.test(character) || CJK.test(next));
    if (gap) { chunks.push(current); current = ""; }
  }
  if (current) chunks.push(current);
  return chunks;
}
