import type { ChangeSet } from '@codemirror/state';

// CodeMirror counts CRLF as one character. Apply only its actual edits to the original text.
export function applyEditorChanges(raw: string, changes: ChangeSet) {
  const crlfPositions: number[] = [];
  for (const match of raw.matchAll(/\r\n/gu)) crlfPositions.push(match.index - crlfPositions.length);
  const separator = raw.match(/\r\n|\n|\r/u)?.[0] ?? '\n';

  function rawOffset(position: number) {
    let start = 0;
    let end = crlfPositions.length;
    while (start < end) {
      const middle = Math.floor((start + end) / 2);
      if (crlfPositions[middle] < position) start = middle + 1;
      else end = middle;
    }
    return position + start;
  }

  let cursor = 0;
  let result = '';
  changes.iterChanges((start, end, _newStart, _newEnd, insert) => {
    result += raw.slice(cursor, rawOffset(start)) + insert.toString().replaceAll('\n', separator);
    cursor = rawOffset(end);
  });
  return result + raw.slice(cursor);
}
