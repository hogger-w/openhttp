import { useMemo, useState } from "react";
import { Braces, ChevronDown, ChevronRight, Minimize2, WandSparkles } from "lucide-react";
import { buildFoldedText, findFoldRanges, formatJsonValue, minifyJsonValue } from "../../../features/requests/jsonViewUtils";

const defaultJson = JSON.stringify({ hello: "world", items: [{ id: 1, active: true }] }, null, 2);

export function JsonFormatTool() {
  const [value, setValue] = useState(defaultJson);
  const [error, setError] = useState("");
  const [foldedStarts, setFoldedStarts] = useState<Set<number>>(new Set());
  const foldRanges = useMemo(() => findFoldRanges(value), [value]);
  const foldStartSet = useMemo(() => new Set(foldRanges.map((range) => range.start)), [foldRanges]);
  const rendered = useMemo(() => buildFoldedText(value, foldedStarts), [foldedStarts, value]);

  const formatJson = () => {
    try {
      setValue(formatJsonValue(value));
      setFoldedStarts(new Set());
      setError("");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  };

  const minifyJson = () => {
    try {
      setValue(minifyJsonValue(value));
      setFoldedStarts(new Set());
      setError("");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  };

  const toggleFold = (lineNumber: number) => {
    const lineIndex = lineNumber - 1;
    setFoldedStarts((current) => {
      const next = new Set(current);
      if (next.has(lineIndex)) {
        next.delete(lineIndex);
      } else {
        next.add(lineIndex);
      }
      return next;
    });
  };

  return (
    <div className="tool-panel json-tool">
      <header>
        <Braces size={22} />
        <h2>JSON Format</h2>
        <div className="tool-header-actions">
          <button className="icon-button ghost" onClick={formatJson} title="Format JSON">
            <WandSparkles size={16} />
          </button>
          <button className="icon-button ghost" onClick={minifyJson} title="Minify JSON">
            <Minimize2 size={16} />
          </button>
        </div>
      </header>

      <div className="json-editor">
        <div className="json-gutter" aria-hidden="true">
          {rendered.visibleNumbers.map((lineNumber) => {
            const lineIndex = lineNumber - 1;
            const canFold = foldStartSet.has(lineIndex);
            const isFolded = foldedStarts.has(lineIndex);
            return (
              <button
                key={lineNumber}
                className={canFold ? "foldable" : ""}
                onClick={() => canFold && toggleFold(lineNumber)}
                tabIndex={-1}
                type="button"
              >
                {canFold ? isFolded ? <ChevronRight size={12} /> : <ChevronDown size={12} /> : <span />}
                <em>{lineNumber}</em>
              </button>
            );
          })}
        </div>
        <textarea
          value={rendered.text}
          onChange={(event) => {
            setValue(event.target.value);
            setFoldedStarts(new Set());
          }}
          spellCheck={false}
          placeholder='{"hello":"world"}'
        />
      </div>
      {error && <span className="tool-error">{error}</span>}
    </div>
  );
}
