export type ElevenLabsAlignment = {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
};

export function alignmentToSrt(alignment: ElevenLabsAlignment): string {
  const { characters, character_start_times_seconds: starts, character_end_times_seconds: ends } = alignment;
  const size = Math.min(characters.length, starts.length, ends.length);
  const words: Array<{ text: string; start: number; end: number }> = [];
  let text = "";
  let start = 0;
  let end = 0;
  const flush = () => {
    if (text) words.push({ text, start, end });
    text = "";
  };
  for (let i = 0; i < size; i += 1) {
    const char = characters[i]!;
    if (/\s/u.test(char)) {
      flush();
      continue;
    }
    if (!text) start = Math.max(0, starts[i]!);
    text += char;
    end = Math.max(start, ends[i]!);
  }
  flush();
  return words
    .map((word, i) => `${i + 1}\n${srtTimestamp(word.start)} --> ${srtTimestamp(word.end)}\n${word.text}\n`)
    .join("\n");
}

function srtTimestamp(seconds: number): string {
  const totalMs = Math.max(0, Math.round(seconds * 1000));
  const ms = totalMs % 1000;
  const totalSeconds = Math.floor(totalMs / 1000);
  const sec = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const min = totalMinutes % 60;
  const hour = Math.floor(totalMinutes / 60);
  return `${String(hour).padStart(2, "0")}:${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}
