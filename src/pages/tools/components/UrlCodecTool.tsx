import { useState } from "react";
import { ArrowDown, ArrowUp, Link } from "lucide-react";
import { safeDecodeURIComponent, safeEncodeURIComponent } from "../toolUtils";

export function UrlCodecTool() {
  const [plain, setPlain] = useState("https://example.com/search?q=OpenHTTP tools&tab=1");
  const [encoded, setEncoded] = useState("");
  const [error, setError] = useState("");

  const encode = () => {
    try {
      setEncoded(safeEncodeURIComponent(plain));
      setError("");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  };

  const decode = () => {
    try {
      setPlain(safeDecodeURIComponent(encoded));
      setError("");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  };

  return (
    <div className="tool-panel url-codec-tool">
      <header>
        <Link size={22} />
        <h2>URL Codec</h2>
      </header>
      <div className="codec-grid">
        <textarea value={plain} onChange={(event) => setPlain(event.target.value)} placeholder="URL" />
        <div className="codec-actions-vertical">
          <button className="button primary" onClick={encode}>
            <ArrowDown size={17} />
            Encode URL
          </button>
          <button className="button" onClick={decode}>
            <ArrowUp size={17} />
            Decode URL
          </button>
          {error && <span className="tool-error">{error}</span>}
        </div>
        <textarea value={encoded} onChange={(event) => setEncoded(event.target.value)} placeholder="Encoded URL" />
      </div>
    </div>
  );
}
