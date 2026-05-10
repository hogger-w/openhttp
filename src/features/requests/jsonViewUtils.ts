export type FoldRange = {
  start: number;
  end: number;
};

export function findFoldRanges(value: string) {
  const ranges: FoldRange[] = [];
  const stack: Array<{ char: string; line: number }> = [];
  const lines = value.split("\n");
  let inString = false;
  let escaped = false;

  lines.forEach((line, lineIndex) => {
    for (const char of line) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === "\"") {
        inString = !inString;
        continue;
      }
      if (inString) {
        continue;
      }
      if (char === "{" || char === "[") {
        stack.push({ char, line: lineIndex });
      }
      if (char === "}" || char === "]") {
        const open = stack.pop();
        if (open && lineIndex > open.line) {
          ranges.push({ start: open.line, end: lineIndex });
        }
      }
    }
  });

  return ranges;
}

export function buildFoldedText(value: string, foldedStarts: Set<number>) {
  const lines = value.split("\n");
  const ranges = findFoldRanges(value);
  const rangeByStart = new Map(ranges.map((range) => [range.start, range]));
  const visibleLines: string[] = [];
  const visibleNumbers: number[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const range = rangeByStart.get(index);
    if (range && foldedStarts.has(index)) {
      visibleLines.push(`${lines[index].trimEnd()} ... ${lines[range.end].trim()}`);
      visibleNumbers.push(index + 1);
      index = range.end;
      continue;
    }

    visibleLines.push(lines[index]);
    visibleNumbers.push(index + 1);
  }

  return {
    text: visibleLines.join("\n"),
    visibleNumbers
  };
}

export function formatJsonValue(value: string) {
  return JSON.stringify(JSON.parse(value), null, 2);
}

export function minifyJsonValue(value: string) {
  return JSON.stringify(JSON.parse(value));
}
