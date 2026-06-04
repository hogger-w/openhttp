import { useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import {
  Activity,
  ChevronDown,
  ChevronRight,
  Circle,
  Database,
  Download,
  FileCode,
  Folder,
  MessageSquare,
  Minimize2,
  Plus,
  RefreshCw,
  Save,
  Send,
  Trash2,
  Unplug,
  WandSparkles,
  Wifi,
  X
} from "lucide-react";
import type { FormFileMap } from "../../shared/appTypes";
import { bodylessMethods, commonFormDataContentTypes, commonHeaderNames, envLabel, httpMethods } from "../../shared/constants";
import type {
  BodyFormDataRow,
  EnvironmentConfig,
  EnvironmentVariable,
  HttpRequest,
  KeyValueRow,
  ResponseState,
  UploadProgressState,
  WebSocketMessage,
  WebSocketRequest
} from "../../types";
import { contentTypeForBodyMode, contentTypeForRaw, formatBytes, formatRawBody, withContentTypeHeader } from "../requests/bodyUtils";
import { buildFoldedText, findFoldRanges, formatJsonValue, minifyJsonValue } from "../requests/jsonViewUtils";
import { emptyFormDataRow, emptyRow, ensureEditableFormRows, ensureEditableRows } from "../requests/requestUtils";
import { resolveVariables } from "../requests/urlUtils";

export function FolderBreadcrumb({ workspaceName, folder }: { workspaceName: string; folder: string }) {
  const parts = folder.split("/").filter(Boolean);
  const labels = parts.length > 0 ? parts : [workspaceName];
  const title = parts.length > 0 ? `${workspaceName}/${folder}` : workspaceName;

  return (
    <nav className="folder-breadcrumb" title={title} aria-label="Request folder">
      <Folder size={14} />
      {labels.map((label, index) => (
        <span className="breadcrumb-part" key={`${label}-${index}`}>
          {index > 0 && <ChevronRight size={13} />}
          <span>{label}</span>
        </span>
      ))}
    </nav>
  );
}

function useElapsedRequestTime(isSending: boolean, startedAt: number | null, settledElapsedMs: number | null) {
  const [elapsedMs, setElapsedMs] = useState(settledElapsedMs || 0);

  useEffect(() => {
    if (!isSending || startedAt === null) {
      setElapsedMs(settledElapsedMs || 0);
      return;
    }

    const updateElapsed = () => setElapsedMs(performance.now() - startedAt);
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 50);

    return () => window.clearInterval(timer);
  }, [isSending, settledElapsedMs, startedAt]);

  return isSending ? elapsedMs : settledElapsedMs || elapsedMs;
}

function formatUploadRate(bytesPerSecond: number) {
  return `${formatBytes(Math.max(0, bytesPerSecond))}/s`;
}

function UploadProgressMeta({ uploadProgress }: { uploadProgress: UploadProgressState }) {
  const percent = uploadProgress.percent === null ? null : Math.min(Math.max(uploadProgress.percent, 0), 100);
  const progressLabel = percent === null ? formatBytes(uploadProgress.loaded) : `${Math.round(percent)}%`;
  const loadedLabel =
    uploadProgress.total === null
      ? formatBytes(uploadProgress.loaded)
      : `${formatBytes(uploadProgress.loaded)} / ${formatBytes(uploadProgress.total)}`;

  return (
    <div className="upload-progress-pill" title={`Upload ${loadedLabel}`}>
      <div className="upload-progress-track" aria-hidden="true">
        {percent !== null && <div style={{ width: `${percent}%` }} />}
      </div>
      <b>Upload {progressLabel}</b>
      <b>{formatUploadRate(uploadProgress.bytesPerSecond)}</b>
    </div>
  );
}

type HttpWorkbenchProps = {
  draft: HttpRequest;
  environment?: EnvironmentConfig;
  httpTab: "params" | "headers" | "body";
  resultTab: "body" | "headers";
  isSending: boolean;
  sendStartedAt: number | null;
  uploadProgress: UploadProgressState | null;
  response: ResponseState | null;
  requestError: string | null;
  setHttpTab: (tab: "params" | "headers" | "body") => void;
  setResultTab: (tab: "body" | "headers") => void;
  sendHttp: () => void;
  downloadResponse: (response: ResponseState) => void;
  formFiles: FormFileMap;
  setFormFiles: Dispatch<SetStateAction<FormFileMap>>;
  updateHttpDraft: (recipe: (request: HttpRequest) => HttpRequest) => void;
};

export function HttpWorkbench({
  draft,
  environment,
  httpTab,
  resultTab,
  isSending,
  sendStartedAt,
  uploadProgress,
  response,
  requestError,
  setHttpTab,
  setResultTab,
  sendHttp,
  downloadResponse,
  formFiles,
  setFormFiles,
  updateHttpDraft
}: HttpWorkbenchProps) {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const panelResizeRef = useRef(false);
  const [requestPanelHeight, setRequestPanelHeight] = useState<number | null>(null);
  const elapsedMs = useElapsedRequestTime(isSending, sendStartedAt, response?.elapsedMs ?? null);

  useEffect(() => {
    const onMouseMove = (event: MouseEvent) => {
      if (!panelResizeRef.current || !gridRef.current) {
        return;
      }

      const rect = gridRef.current.getBoundingClientRect();
      const minRequestHeight = 190;
      const minResponseHeight = 170;
      const dividerHeight = 7;
      const maxRequestHeight = Math.max(minRequestHeight, rect.height - minResponseHeight - dividerHeight);
      const nextHeight = Math.min(Math.max(event.clientY - rect.top, minRequestHeight), maxRequestHeight);
      setRequestPanelHeight(nextHeight);
    };

    const onMouseUp = () => {
      panelResizeRef.current = false;
      document.body.classList.remove("panel-resizing");
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);

    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      document.body.classList.remove("panel-resizing");
    };
  }, []);

  return (
    <div
      className="workbench-grid"
      ref={gridRef}
      style={requestPanelHeight ? { gridTemplateRows: `${requestPanelHeight}px 7px minmax(0, 1fr)` } : undefined}
    >
      <section className="request-panel">
        <div className="url-row">
          <select
            className={`method-select ${draft.method.toLowerCase()}`}
            value={draft.method}
            onChange={(event) => updateHttpDraft((request) => ({ ...request, method: event.target.value }))}
          >
            {httpMethods.map((method) => (
              <option value={method} key={method}>
                {method}
              </option>
            ))}
          </select>
          <input
            className="url-input"
            value={draft.url}
            onChange={(event) => updateHttpDraft((request) => ({ ...request, url: event.target.value }))}
            placeholder="https://api.example.com/users or {{baseUrl}}/users"
          />
          <button
            className={`button send ${isSending ? "cancel" : ""}`}
            onClick={sendHttp}
            disabled={!isSending && !draft.url.trim()}
            title={isSending ? "Cancel request" : "Send request"}
          >
            {isSending ? <RefreshCw className="spin" size={16} /> : <Send size={16} />}
            {isSending ? "Cancel" : "Send"}
          </button>
        </div>
        <VariableHints value={draft.url} environment={environment} />

        <div className="tabs">
          <button className={httpTab === "params" ? "active" : ""} onClick={() => setHttpTab("params")}>
            Params
          </button>
          <button className={httpTab === "headers" ? "active" : ""} onClick={() => setHttpTab("headers")}>
            Headers
          </button>
          <button className={httpTab === "body" ? "active" : ""} onClick={() => setHttpTab("body")}>
            Body
          </button>
        </div>

        <div className="editor-surface">
          {httpTab === "params" && (
            <KeyValueEditor
              rows={draft.params}
              onRowsChange={(rows) => updateHttpDraft((request) => ({ ...request, params: rows }))}
            />
          )}

          {httpTab === "headers" && (
            <KeyValueEditor
              rows={draft.headers}
              keySuggestions={commonHeaderNames}
              onRowsChange={(rows) => updateHttpDraft((request) => ({ ...request, headers: rows }))}
            />
          )}

          {httpTab === "body" && (
            <BodyEditor
              draft={draft}
              formFiles={formFiles}
              setFormFiles={setFormFiles}
              updateHttpDraft={updateHttpDraft}
            />
          )}
        </div>
      </section>

      <div
        className="panel-height-resizer"
        role="separator"
        aria-orientation="horizontal"
        title="Drag to resize request and response panels"
        onMouseDown={(event) => {
          event.preventDefault();
          panelResizeRef.current = true;
          document.body.classList.add("panel-resizing");
        }}
      />

      <section className="response-panel">
        <header className="response-header">
          <div className="response-title">
            <Activity size={17} />
            <span>Response</span>
          </div>
          {(response || isSending) && (
            <div className="response-meta">
              {response ? <span className={response.ok ? "status-ok" : "status-bad"}>{response.status}</span> : <span>Sending</span>}
              <span>{Math.round(elapsedMs)} ms</span>
              {uploadProgress && <UploadProgressMeta uploadProgress={uploadProgress} />}
              {response && <span>{formatBytes(response.size)}</span>}
              {response && (
                <button className="icon-button ghost response-download" onClick={() => downloadResponse(response)} title="Download response">
                  <Download size={15} />
                </button>
              )}
            </div>
          )}
        </header>

        <div className="tabs compact">
          <button className={resultTab === "body" ? "active" : ""} onClick={() => setResultTab("body")}>
            Body
          </button>
          <button className={resultTab === "headers" ? "active" : ""} onClick={() => setResultTab("headers")}>
            Headers
          </button>
        </div>

        <div className="result-surface">
          {requestError ? (
            <div className="error-box">
              <X size={18} />
              <span>{requestError}</span>
            </div>
          ) : response ? (
            resultTab === "body" ? (
              <ResponseBodyPreview response={response} />
            ) : (
              <KeyValueTable rows={response.headers} />
            )
          ) : (
            <div className="empty-result">No response yet</div>
          )}
        </div>
      </section>
    </div>
  );
}

function ResponseBodyPreview({ response }: { response: ResponseState }) {
  const [previewUrl, setPreviewUrl] = useState("");

  useEffect(() => {
    if (!["image", "audio", "video"].includes(response.bodyKind)) {
      setPreviewUrl("");
      return;
    }

    const objectUrl = URL.createObjectURL(response.bodyBlob);
    setPreviewUrl(objectUrl);

    return () => URL.revokeObjectURL(objectUrl);
  }, [response.bodyBlob, response.bodyKind]);

  if (response.bodyKind === "text") {
    if (response.contentType.toLowerCase().includes("json")) {
      return <ResponseJsonViewer value={response.body} />;
    }

    return <StreamingTextPreview value={response.body || "(empty response)"} />;
  }

  if (!response.size) {
    return <div className="empty-result">Empty response</div>;
  }

  if (response.bodyKind === "image") {
    return (
      <div className="response-preview media-preview image-preview">
        {previewUrl && <img src={previewUrl} alt="Response preview" />}
      </div>
    );
  }

  if (response.bodyKind === "audio") {
    return (
      <div className="response-preview media-preview audio-preview">
        {previewUrl && <audio controls src={previewUrl} />}
      </div>
    );
  }

  if (response.bodyKind === "video") {
    return (
      <div className="response-preview media-preview video-preview">
        {previewUrl && <video controls src={previewUrl} />}
      </div>
    );
  }

  return (
    <div className="response-preview binary-preview">
      <FileCode size={22} />
      <div>
        <strong>Preview unavailable</strong>
        <span>{response.contentType || "application/octet-stream"} can be downloaded from the response toolbar.</span>
      </div>
    </div>
  );
}

function StreamingTextPreview({ value }: { value: string }) {
  const preRef = useRef<HTMLPreElement | null>(null);

  useEffect(() => {
    const scroller = preRef.current?.parentElement;
    if (scroller) {
      scroller.scrollTop = scroller.scrollHeight;
    }
  }, [value]);

  return <pre ref={preRef}>{value}</pre>;
}

function AutoHeightResponseTextarea({ value }: { value: string }) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    let frame = 0;
    const resize = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const surface = textarea.closest<HTMLElement>(".result-surface");
        const viewer = textarea.closest<HTMLElement>(".response-json-viewer");
        const toolbar = viewer?.querySelector<HTMLElement>(".response-json-toolbar");
        const viewerStyle = viewer ? window.getComputedStyle(viewer) : null;
        const verticalPadding = viewerStyle
          ? parseFloat(viewerStyle.paddingTop) + parseFloat(viewerStyle.paddingBottom)
          : 0;
        const availableHeight = surface ? surface.clientHeight - (toolbar?.offsetHeight || 0) - verticalPadding : 0;
        textarea.style.height = "0px";
        textarea.style.height = `${Math.max(textarea.scrollHeight, availableHeight, 220)}px`;
      });
    };

    resize();
    const observer = new ResizeObserver(resize);
    const surface = textarea.closest<HTMLElement>(".result-surface");
    if (surface) {
      observer.observe(surface);
    } else if (textarea.parentElement) {
      observer.observe(textarea.parentElement);
    }
    window.addEventListener("resize", resize);

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, [value]);

  return <textarea ref={textareaRef} value={value} readOnly rows={1} spellCheck={false} />;
}

function ResponseJsonViewer({ value }: { value: string }) {
  const [displayValue, setDisplayValue] = useState(value);
  const [foldedStarts, setFoldedStarts] = useState<Set<number>>(new Set());
  const [error, setError] = useState("");
  const foldRanges = useMemo(() => findFoldRanges(displayValue), [displayValue]);
  const foldStartSet = useMemo(() => new Set(foldRanges.map((range) => range.start)), [foldRanges]);
  const rendered = useMemo(() => buildFoldedText(displayValue, foldedStarts), [displayValue, foldedStarts]);

  useEffect(() => {
    setDisplayValue(value);
    setFoldedStarts(new Set());
    setError("");
  }, [value]);

  const formatJson = () => {
    try {
      setDisplayValue(formatJsonValue(displayValue));
      setFoldedStarts(new Set());
      setError("");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  };

  const minifyJson = () => {
    try {
      setDisplayValue(minifyJsonValue(displayValue));
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
    <div className="response-json-viewer">
      <div className="response-json-toolbar">
        <span>JSON</span>
        <button className="icon-button ghost" onClick={formatJson} title="格式化 JSON">
          <WandSparkles size={15} />
        </button>
        <button className="icon-button ghost" onClick={minifyJson} title="收缩 JSON">
          <Minimize2 size={15} />
        </button>
      </div>
      <div className="json-editor response-json-editor">
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
        <AutoHeightResponseTextarea value={rendered.text || "(empty response)"} />
      </div>
      {error && <span className="response-json-error">{error}</span>}
    </div>
  );
}

type BodyEditorProps = {
  draft: HttpRequest;
  formFiles: FormFileMap;
  setFormFiles: Dispatch<SetStateAction<FormFileMap>>;
  updateHttpDraft: (recipe: (request: HttpRequest) => HttpRequest) => void;
};

function BodyEditor({ draft, formFiles, setFormFiles, updateHttpDraft }: BodyEditorProps) {
  const bodyDisabled = bodylessMethods.has(draft.method);
  const rawType = draft.body.rawType || "json";

  const updateBody = (patch: Partial<HttpRequest["body"]>) => {
    updateHttpDraft((request) => ({ ...request, body: { ...request.body, ...patch } }));
  };

  const selectMode = (mode: HttpRequest["body"]["mode"]) => {
    const nextContentType = contentTypeForBodyMode(mode, draft.body.rawType || "json");

    updateHttpDraft((request) => ({
      ...request,
      headers: withContentTypeHeader(request.headers, nextContentType),
      body: {
        ...request.body,
        mode,
        contentType: nextContentType,
        formData: ensureEditableFormRows(request.body.formData),
        urlencoded: ensureEditableRows(request.body.urlencoded)
      }
    }));
  };

  const formatBody = () => {
    try {
      if (!draft.body.raw.trim()) {
        updateBody({ raw: "" });
        return;
      }

      updateBody({ raw: rawType === "json" ? formatJsonValue(draft.body.raw) : formatRawBody(draft.body.raw, rawType) });
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Unable to format body");
    }
  };

  const minifyBody = () => {
    try {
      if (!draft.body.raw.trim()) {
        updateBody({ raw: "" });
        return;
      }

      updateBody({ raw: minifyJsonValue(draft.body.raw) });
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Unable to minify body");
    }
  };

  return (
    <div className="body-editor">
      <div className="body-toolbar">
        <div className="segmented-control">
          <button className={draft.body.mode === "raw" ? "active" : ""} onClick={() => selectMode("raw")}>
            raw
          </button>
          <button className={draft.body.mode === "form-data" ? "active" : ""} onClick={() => selectMode("form-data")}>
            form-data
          </button>
          <button className={draft.body.mode === "urlencoded" ? "active" : ""} onClick={() => selectMode("urlencoded")}>
            x-www-form-urlencoded
          </button>
        </div>
      </div>

      {bodyDisabled && <div className="body-disabled-note">Body is disabled for {draft.method} requests.</div>}

      {draft.body.mode === "raw" && (
        <div className="raw-body-panel">
          <div className="raw-toolbar">
            <select
              value={rawType}
              onChange={(event) => {
                const nextType = event.target.value as "json" | "xml" | "text";
                const nextContentType = contentTypeForRaw(nextType);
                updateHttpDraft((request) => ({
                  ...request,
                  headers: withContentTypeHeader(request.headers, nextContentType),
                  body: { ...request.body, rawType: nextType, contentType: nextContentType }
                }));
              }}
              disabled={bodyDisabled}
            >
              <option value="json">JSON</option>
              <option value="xml">XML</option>
              <option value="text">Text</option>
            </select>
            {(rawType === "json" || rawType === "xml") && (
              <button className="icon-button ghost format-button" onClick={formatBody} disabled={bodyDisabled} title="格式化 JSON">
                <WandSparkles size={15} />
              </button>
            )}
            {rawType === "json" && (
              <button className="icon-button ghost" onClick={minifyBody} disabled={bodyDisabled} title="收缩 JSON">
                <Minimize2 size={15} />
              </button>
            )}
          </div>
          <RawBodyTextArea
            value={draft.body.raw}
            disabled={bodyDisabled}
            onChange={(value) => updateBody({ raw: value })}
            placeholder={bodyDisabled ? "Body disabled for this method" : "{\n  \"name\": \"OpenHTTP\"\n}"}
          />
        </div>
      )}

      {draft.body.mode === "form-data" && (
        <FormDataEditor
          rows={draft.body.formData || [emptyFormDataRow()]}
          formFiles={formFiles}
          disabled={bodyDisabled}
          setFormFiles={setFormFiles}
          onRowsChange={(rows) => updateBody({ formData: ensureEditableFormRows(rows) })}
        />
      )}

      {draft.body.mode === "urlencoded" && (
        <KeyValueEditor
          rows={draft.body.urlencoded || [emptyRow()]}
          onRowsChange={(rows) => updateBody({ urlencoded: rows })}
        />
      )}
    </div>
  );
}

function RawBodyTextArea({
  value,
  disabled,
  onChange,
  placeholder
}: {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  const gutterRef = useRef<HTMLDivElement | null>(null);
  const lineNumbers = useMemo(() => {
    const lineCount = Math.max(value.split("\n").length, 1);
    return Array.from({ length: lineCount }, (_, index) => index + 1);
  }, [value]);

  return (
    <div className="raw-body-editor">
      <div className="raw-line-gutter" ref={gutterRef} aria-hidden="true">
        {lineNumbers.map((lineNumber) => (
          <span key={lineNumber}>{lineNumber}</span>
        ))}
      </div>
      <textarea
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        onScroll={(event) => {
          if (gutterRef.current) {
            gutterRef.current.scrollTop = event.currentTarget.scrollTop;
          }
        }}
        spellCheck={false}
        placeholder={placeholder}
      />
    </div>
  );
}

function FormDataEditor({
  rows,
  formFiles,
  disabled,
  setFormFiles,
  onRowsChange
}: {
  rows: BodyFormDataRow[];
  formFiles: FormFileMap;
  disabled: boolean;
  setFormFiles: Dispatch<SetStateAction<FormFileMap>>;
  onRowsChange: (rows: BodyFormDataRow[]) => void;
}) {
  const updateRow = (id: string | undefined, patch: Partial<BodyFormDataRow>) => {
    const nextRows = rows.map((row) => (row.id === id ? { ...row, ...patch } : row));
    onRowsChange(nextRows);
  };

  const removeRow = (id: string | undefined) => {
    if (id) {
      setFormFiles((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
    }

    const nextRows = rows.filter((row) => row.id !== id);
    onRowsChange(nextRows.length > 0 ? nextRows : [emptyFormDataRow()]);
  };

  return (
    <div className="form-data-editor">
      <div className="form-data-head">
        <span />
        <span>Key</span>
        <span>Type</span>
        <span>Value</span>
        <span>Content-Type</span>
        <span />
      </div>
      {rows.map((row) => {
        const selectedFiles = row.id ? formFiles[row.id] || [] : [];
        const fileLabel =
          selectedFiles.length > 0
            ? selectedFiles.map((file) => file.name).join(", ")
            : row.fileNames?.length
              ? row.fileNames.join(", ")
              : "Choose files";

        return (
          <div className="form-data-row" key={row.id}>
            <input
              className="check-cell"
              type="checkbox"
              checked={row.enabled}
              disabled={disabled}
              onChange={(event) => updateRow(row.id, { enabled: event.target.checked })}
              title="Enabled"
            />
            <input
              value={row.key}
              disabled={disabled}
              onChange={(event) => updateRow(row.id, { key: event.target.value })}
              placeholder="key"
            />
            <select
              value={row.valueType}
              disabled={disabled}
              onChange={(event) => {
                const valueType = event.target.value as "text" | "file";
                if (valueType === "text" && row.id) {
                  setFormFiles((current) => {
                    const next = { ...current };
                    delete next[row.id as string];
                    return next;
                  });
                }
                updateRow(row.id, { valueType, value: valueType === "file" ? "" : row.value, fileNames: [] });
              }}
            >
              <option value="text">text</option>
              <option value="file">file</option>
            </select>
            {row.valueType === "file" ? (
              <label className={`file-picker ${disabled ? "disabled" : ""}`} title={fileLabel}>
                <FileCode size={15} />
                <span>{fileLabel}</span>
                <input
                  type="file"
                  multiple
                  disabled={disabled}
                  onChange={(event) => {
                    const files = Array.from(event.target.files || []);
                    if (row.id) {
                      setFormFiles((current) => ({ ...current, [row.id as string]: files }));
                    }
                    updateRow(row.id, { fileNames: files.map((file) => file.name), value: files.map((file) => file.name).join(", ") });
                  }}
                />
              </label>
            ) : (
              <input
                value={row.value}
                disabled={disabled}
                onChange={(event) => updateRow(row.id, { value: event.target.value })}
                placeholder="value"
              />
            )}
            <input
              list="form-data-content-types"
              value={row.contentType || ""}
              disabled={disabled}
              onChange={(event) => updateRow(row.id, { contentType: event.target.value })}
              placeholder="Auto"
            />
            <button className="icon-button ghost" onClick={() => removeRow(row.id)} disabled={disabled} title="Remove row">
              <X size={14} />
            </button>
          </div>
        );
      })}
      <datalist id="form-data-content-types">
        {commonFormDataContentTypes.map((item) => (
          <option value={item} key={item || "auto"} />
        ))}
      </datalist>
    </div>
  );
}

type WebSocketWorkbenchProps = {
  draft: WebSocketRequest;
  environment?: EnvironmentConfig;
  status: "idle" | "connecting" | "open" | "closed" | "error";
  messages: WebSocketMessage[];
  outbound: string;
  setOutbound: (value: string) => void;
  connect: () => void;
  disconnect: () => void;
  sendMessage: () => void;
  updateDraft: (recipe: (request: WebSocketRequest) => WebSocketRequest) => void;
};

export function WebSocketWorkbench({
  draft,
  environment,
  status,
  messages,
  outbound,
  setOutbound,
  connect,
  disconnect,
  sendMessage,
  updateDraft
}: WebSocketWorkbenchProps) {
  const isOpen = status === "open";
  const isBusy = status === "connecting";

  return (
    <div className="websocket-grid">
      <section className="request-panel ws-panel">
        <div className="url-row">
          <div className="ws-badge">
            <Wifi size={16} />
            WS
          </div>
          <input
            className="url-input"
            value={draft.url}
            onChange={(event) => updateDraft((request) => ({ ...request, url: event.target.value }))}
            placeholder="wss://echo.websocket.events or {{socketUrl}}"
          />
          {isOpen ? (
            <button className="button danger-fill" onClick={disconnect} title="Disconnect">
              <Unplug size={16} />
              Disconnect
            </button>
          ) : (
            <button className="button send" onClick={connect} disabled={isBusy || !draft.url.trim()} title="Connect">
              {isBusy ? <RefreshCw className="spin" size={16} /> : <Wifi size={16} />}
              Connect
            </button>
          )}
        </div>
        <VariableHints value={draft.url} environment={environment} />

        <div className="content-type-row ws-protocols">
          <label>Protocols</label>
          <input
            value={draft.protocols}
            onChange={(event) => updateDraft((request) => ({ ...request, protocols: event.target.value }))}
            placeholder="chat, superchat"
          />
        </div>

        <div className="socket-status-line">
          <span className={`socket-status ${status}`}>
            <Circle size={10} fill="currentColor" />
            {status}
          </span>
        </div>
      </section>

      <section className="response-panel socket-messages">
        <header className="response-header">
          <div className="response-title">
            <MessageSquare size={17} />
            <span>Messages</span>
          </div>
        </header>

        <div className="message-stream">
          {messages.length > 0 ? (
            messages.map((message) => (
              <div className={`socket-message ${message.direction}`} key={message.id}>
                <span className="message-time">{message.time}</span>
                <strong>{message.direction}</strong>
                <pre>{message.body}</pre>
              </div>
            ))
          ) : (
            <div className="empty-result">No messages yet</div>
          )}
        </div>

        <div className="message-composer">
          <textarea
            value={outbound}
            onChange={(event) => setOutbound(event.target.value)}
            placeholder="Message"
            disabled={!isOpen}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                sendMessage();
              }
            }}
          />
          <button className="button send" disabled={!isOpen || !outbound} onClick={sendMessage} title="Send message">
            <Send size={16} />
            Send
          </button>
        </div>
      </section>
    </div>
  );
}

function VariableHints({ value, environment }: { value: string; environment?: EnvironmentConfig }) {
  if (!value.trim()) {
    return null;
  }

  const resolvedUrl = resolveVariables(value, environment);

  return (
    <div className="variable-hints" title={resolvedUrl}>
      {resolvedUrl}
    </div>
  );
}

export function EnvironmentWorkbench({
  workspaceName,
  environment,
  onAdd,
  onUpdateVariable,
  onRemoveVariable,
  onSave
}: {
  workspaceName: string;
  environment: EnvironmentConfig;
  onAdd: () => void;
  onUpdateVariable: (id: string | undefined, patch: Partial<EnvironmentVariable>) => void;
  onRemoveVariable: (id: string | undefined) => void;
  onSave: () => void;
}) {
  return (
    <section className="environment-workbench">
      <header className="request-header">
        <div className="request-name-line">
          <Database size={20} />
          <div>
            <h2>{environment.folder || workspaceName}</h2>
            <span>{envLabel}</span>
          </div>
        </div>
        <div className="header-actions">
          <button className="button" onClick={onAdd}>
            <Plus size={16} />
            Add
          </button>
          <button className="button primary" onClick={onSave}>
            <Save size={16} />
            Save
          </button>
        </div>
      </header>

      <div className="environment-editor">
        <div className="env-head">
          <span>Active</span>
          <span>Key</span>
          <span>Value</span>
          <span />
        </div>
        {environment.variables.map((variable) => (
          <div className="env-row" key={variable.id}>
            <input
              type="checkbox"
              checked={variable.active}
              onChange={(event) => onUpdateVariable(variable.id, { active: event.target.checked })}
              title="Active"
            />
            <input
              value={variable.key}
              onChange={(event) => onUpdateVariable(variable.id, { key: event.target.value })}
              placeholder="baseUrl"
            />
            <input
              value={variable.value}
              onChange={(event) => onUpdateVariable(variable.id, { value: event.target.value })}
              placeholder="https://api.example.com"
            />
            <button className="icon-button ghost" onClick={() => onRemoveVariable(variable.id)} title="Delete variable">
              <Trash2 size={15} />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

type KeyValueEditorProps = {
  rows: KeyValueRow[];
  onRowsChange: (rows: KeyValueRow[]) => void;
  keySuggestions?: string[];
};

function KeyValueEditor({ rows, onRowsChange, keySuggestions = [] }: KeyValueEditorProps) {
  const listId = useMemo(() => `kv-suggestions-${crypto.randomUUID()}`, []);

  const updateRow = (id: string | undefined, patch: Partial<KeyValueRow>) => {
    const nextRows = rows.map((row) => (row.id === id ? { ...row, ...patch } : row));
    const hasBlank = nextRows.some((row) => !row.key && !row.value);
    onRowsChange(hasBlank ? nextRows : [...nextRows, emptyRow()]);
  };

  const removeRow = (id: string | undefined) => {
    const nextRows = rows.filter((row) => row.id !== id);
    onRowsChange(nextRows.length > 0 ? nextRows : [emptyRow()]);
  };

  return (
    <div className="kv-editor">
      <div className="kv-head">
        <span />
        <span>Key</span>
        <span>Value</span>
        <span />
      </div>
      {rows.map((row) => (
        <div className="kv-row" key={row.id}>
          <input
            className="check-cell"
            type="checkbox"
            checked={row.enabled}
            onChange={(event) => updateRow(row.id, { enabled: event.target.checked })}
            title="Enabled"
          />
          <input
            value={row.key}
            list={keySuggestions.length ? listId : undefined}
            onFocus={(event) => {
              if (keySuggestions.length) {
                try {
                  (event.currentTarget as HTMLInputElement & { showPicker?: () => void }).showPicker?.();
                } catch {
                  // Some Chromium versions only allow showPicker from direct pointer events.
                }
              }
            }}
            onClick={(event) => {
              if (keySuggestions.length) {
                try {
                  (event.currentTarget as HTMLInputElement & { showPicker?: () => void }).showPicker?.();
                } catch {
                  // Native datalist still opens after typing when showPicker is unavailable.
                }
              }
            }}
            onChange={(event) => updateRow(row.id, { key: event.target.value })}
            placeholder="key"
          />
          <input value={row.value} onChange={(event) => updateRow(row.id, { value: event.target.value })} placeholder="value" />
          <button className="icon-button ghost" onClick={() => removeRow(row.id)} title="Remove row">
            <X size={14} />
          </button>
        </div>
      ))}
      {keySuggestions.length > 0 && (
        <datalist id={listId}>
          {keySuggestions.map((item) => (
            <option value={item} key={item} />
          ))}
        </datalist>
      )}
    </div>
  );
}

function KeyValueTable({ rows }: { rows: KeyValueRow[] }) {
  return (
    <div className="kv-table">
      {rows.map((row) => (
        <div className="kv-table-row" key={row.id || row.key}>
          <strong>{row.key}</strong>
          <span>{row.value}</span>
        </div>
      ))}
    </div>
  );
}
