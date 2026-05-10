import { useRef, useState } from "react";
import { ArrowDown, ArrowUp, Binary, FileCode, Type } from "lucide-react";
import { arrayBufferToBase64, base64ToBlob, decodeBase64Text, encodeBase64Text, saveBlob } from "../toolUtils";

type SourceMode = "text" | "file";

export function Base64Tool() {
  const [sourceMode, setSourceMode] = useState<SourceMode>("text");
  const [textInput, setTextInput] = useState("");
  const [base64Output, setBase64Output] = useState("");
  const [fileName, setFileName] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const encode = async () => {
    try {
      setError("");
      if (sourceMode === "file") {
        if (!selectedFile) {
          return;
        }
        setBase64Output(arrayBufferToBase64(await selectedFile.arrayBuffer()));
        return;
      }

      setBase64Output(encodeBase64Text(textInput));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  };

  const decode = async () => {
    try {
      setError("");
      if (sourceMode === "file") {
        const blob = base64ToBlob(base64Output);
        await saveBlob(blob, fileName ? `${fileName}.decoded` : "decoded.bin");
        return;
      }

      setTextInput(decodeBase64Text(base64Output));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  };

  return (
    <div className="tool-panel base64-tool">
      <header>
        <Binary size={22} />
        <h2>Base64</h2>
      </header>

      <div className="codec-grid">
        <section className="codec-box">
          <div className="tool-tabs">
            <button className={sourceMode === "text" ? "active" : ""} onClick={() => setSourceMode("text")}>
              <Type size={15} />
              Text
            </button>
            <button className={sourceMode === "file" ? "active" : ""} onClick={() => setSourceMode("file")}>
              <FileCode size={15} />
              File
            </button>
          </div>

          {sourceMode === "text" ? (
            <textarea value={textInput} onChange={(event) => setTextInput(event.target.value)} placeholder="Input text" />
          ) : (
            <div className="file-drop-surface">
              <input
                ref={fileInputRef}
                type="file"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0] || null;
                  setSelectedFile(file);
                  setFileName(file?.name || "");
                }}
              />
              <button className="button primary" onClick={() => fileInputRef.current?.click()}>
                Choose File
              </button>
              {fileName && <span>{fileName}</span>}
            </div>
          )}
        </section>

        <div className="codec-actions-vertical">
          <button className="button primary" onClick={encode}>
            <ArrowDown size={17} />
            Encode Base64
          </button>
          <button className="button" onClick={decode} disabled={!base64Output.trim()}>
            <ArrowUp size={17} />
            {sourceMode === "file" ? "Decode Base64 to File" : "Decode Base64"}
          </button>
          {error && <span className="tool-error">{error}</span>}
        </div>

        <section className="codec-box">
          <textarea value={base64Output} onChange={(event) => setBase64Output(event.target.value)} placeholder="Base64 text" />
        </section>
      </div>
    </div>
  );
}
