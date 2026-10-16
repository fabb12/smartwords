// The model returns the current sentence, minimally corrected, plus its continuation.
// Keep the unchanged prefix in the editor (including its formatting) and propose
// only the suffix that needs replacing. Offsets use UTF-16, like ProseMirror.
export function completionProposal(before: string, answer: string, done: boolean) {
  if (!answer.trim() || before === answer || (!done && before.startsWith(answer))) return null;
  let offset = 0;
  while (offset < before.length && offset < answer.length && before[offset] === answer[offset]) offset++;
  if (offset < before.length) {
    // Start a correction at a word boundary, never halfway through a word or emoji.
    while (offset > 0 && !/\s/u.test(before[offset - 1])) offset--;
  }
  return {
    offset,
    text: answer.slice(offset),
    ...(offset < before.length ? { original: before.slice(offset) } : {}),
  };
}
