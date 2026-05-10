import { useMemo, useState } from "react";
import { ScanSearch } from "lucide-react";

export function RegexTool() {
  const [pattern, setPattern] = useState("\\bOpenHTTP\\b");
  const [flags, setFlags] = useState("gi");
  const [text, setText] = useState("OpenHTTP makes HTTP workflows calmer. openhttp also has tools.");

  const result = useMemo(() => {
    try {
      const regex = new RegExp(pattern, flags.includes("g") ? flags : `${flags}g`);
      const matches: Array<{ index: number; value: string }> = [];
      let match: RegExpExecArray | null;
      while ((match = regex.exec(text))) {
        matches.push({ index: match.index, value: match[0] });
        if (match[0] === "") {
          regex.lastIndex += 1;
        }
      }
      return { matches, error: "" };
    } catch (error) {
      return { matches: [], error: error instanceof Error ? error.message : String(error) };
    }
  }, [flags, pattern, text]);

  return (
    <div className="tool-panel regex-tool">
      <header>
        <ScanSearch size={22} />
        <h2>Regex Tester</h2>
      </header>

      <div className="regex-controls">
        <input value={pattern} onChange={(event) => setPattern(event.target.value)} placeholder="Pattern" />
        <input value={flags} onChange={(event) => setFlags(event.target.value)} placeholder="Flags" />
      </div>
      <textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="Text" />
      {result.error ? (
        <span className="tool-error">{result.error}</span>
      ) : (
        <div className="regex-results">
          <strong>{result.matches.length} matches</strong>
          {result.matches.map((match, index) => (
            <code key={`${match.index}-${index}`}>#{index + 1} [{match.index}] {match.value}</code>
          ))}
        </div>
      )}
    </div>
  );
}
