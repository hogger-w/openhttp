import type { BodyFormDataRow, EnvironmentConfig, EnvironmentVariable, HttpRequest, KeyValueRow, RequestDraft, WebSocketRequest } from "../../types";
import type { RequestTab } from "../../shared/appTypes";
import { rootFolderId } from "../../shared/constants";

export const emptyRow = (): KeyValueRow => ({
  id: crypto.randomUUID(),
  key: "",
  value: "",
  enabled: true
});

export const emptyEnvVariable = (): EnvironmentVariable => ({
  id: crypto.randomUUID(),
  key: "",
  value: "",
  active: false
});

export const emptyFormDataRow = (): BodyFormDataRow => ({
  id: crypto.randomUUID(),
  key: "",
  value: "",
  enabled: true,
  valueType: "text",
  contentType: "",
  fileNames: []
});

export const createHttpRequest = (folder = ""): HttpRequest => ({
  id: `draft-${crypto.randomUUID()}`,
  version: 1,
  type: "http",
  name: "Untitled HTTP Request",
  folder,
  method: "GET",
  url: "http://127.0.0.1:8080",
  params: [emptyRow()],
  headers: [
    {
      id: crypto.randomUUID(),
      key: "Content-Type",
      value: "application/json",
      enabled: true
    },
    emptyRow()
  ],
  body: {
    mode: "raw",
    rawType: "json",
    raw: "{}",
    contentType: "application/json",
    formData: [emptyFormDataRow()],
    urlencoded: [emptyRow()]
  }
});

export const createWebSocketRequest = (folder = ""): WebSocketRequest => ({
  id: `draft-${crypto.randomUUID()}`,
  version: 1,
  type: "websocket",
  name: "Untitled WebSocket",
  folder,
  url: "ws://127.0.0.1:8080",
  protocols: ""
});

export function cloneRequest(request: RequestDraft): RequestDraft {
  return JSON.parse(JSON.stringify(request));
}

export function cloneEnvironment(environment: EnvironmentConfig): EnvironmentConfig {
  return JSON.parse(JSON.stringify(environment));
}

export function requestKey(request: RequestDraft) {
  return request.id || request.relativePath || crypto.randomUUID();
}

export function folderKey(folder: string) {
  return folder || rootFolderId;
}

export function ensureEditableRows(rows: KeyValueRow[] = []) {
  const cloned = rows.map((row) => ({ ...row, id: row.id || crypto.randomUUID() }));
  const hasBlank = cloned.some((row) => !row.key && !row.value);
  return hasBlank ? cloned : [...cloned, emptyRow()];
}

export function ensureEditableFormRows(rows: BodyFormDataRow[] = []) {
  const cloned = rows.map((row) => ({
    ...row,
    id: row.id || crypto.randomUUID(),
    valueType: row.valueType || "text",
    contentType: row.contentType || "",
    fileNames: row.fileNames || []
  }));
  const hasBlank = cloned.some((row) => !row.key && !row.value && (!row.fileNames || row.fileNames.length === 0));
  return hasBlank ? cloned : [...cloned, emptyFormDataRow()];
}

export function normalizeDraftForEdit(request: RequestDraft): RequestDraft {
  const draft = cloneRequest(request);

  if (draft.type === "http") {
    draft.params = ensureEditableRows(draft.params);
    draft.headers = ensureEditableRows(draft.headers);
    draft.body = draft.body || { mode: "raw", rawType: "json", raw: "", contentType: "" };
    draft.body.rawType = draft.body.rawType || "json";
    draft.body.formData = ensureEditableFormRows(draft.body.formData);
    draft.body.urlencoded = ensureEditableRows(draft.body.urlencoded);
  }

  return draft;
}

export function rowsForSave(rows: KeyValueRow[]) {
  return rows
    .filter((row) => row.key.trim() || row.value.trim())
    .map(({ key, value, enabled }) => ({ key, value, enabled }));
}

export function formRowsForSave(rows: BodyFormDataRow[] = []) {
  return rows
    .filter((row) => row.key.trim() || row.value.trim() || (row.fileNames && row.fileNames.length > 0))
    .map(({ id, key, value, enabled, valueType, contentType, fileNames }) => ({
      id,
      key,
      value,
      enabled,
      valueType,
      contentType: contentType || "",
      fileNames: fileNames || []
    }));
}

export function compactRequest(request: RequestDraft): RequestDraft {
  if (request.type === "websocket") {
    return {
      ...request,
      name: request.name.trim() || "Untitled WebSocket",
      url: request.url.trim(),
      protocols: request.protocols.trim()
    };
  }

  return {
    ...request,
    name: request.name.trim() || "Untitled HTTP Request",
    url: request.url.trim(),
    params: rowsForSave(request.params),
    headers: rowsForSave(request.headers),
    body: {
      mode: request.body.mode,
      rawType: request.body.rawType || "json",
      raw: request.body.raw,
      contentType: request.body.contentType.trim(),
      formData: formRowsForSave(request.body.formData),
      urlencoded: rowsForSave(request.body.urlencoded || [])
    }
  };
}

export function requestSnapshot(request: RequestDraft) {
  return JSON.stringify(compactRequest(request));
}

export function isTabDirty(tab: RequestTab) {
  return requestSnapshot(tab.draft) !== tab.savedSnapshot;
}

export function normalizeEnvironmentForEdit(environment: EnvironmentConfig): EnvironmentConfig {
  return {
    ...cloneEnvironment(environment),
    variables:
      environment.variables.length > 0
        ? environment.variables.map((variable) => ({ ...variable, id: variable.id || crypto.randomUUID() }))
        : [emptyEnvVariable()]
  };
}

export function compactEnvironment(environment: EnvironmentConfig): EnvironmentConfig {
  const activeKeys = new Set<string>();

  return {
    ...environment,
    variables: environment.variables
      .filter((variable) => variable.key.trim() || variable.value.trim())
      .map((variable) => {
        const key = variable.key.trim();
        const active = Boolean(variable.active && key && !activeKeys.has(key));

        if (active) {
          activeKeys.add(key);
        }

        return {
          id: variable.id,
          key,
          value: variable.value,
          active
        };
      })
  };
}
