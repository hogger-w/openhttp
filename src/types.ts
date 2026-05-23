export type KeyValueRow = {
  id?: string;
  key: string;
  value: string;
  enabled: boolean;
};

export type BodyState = {
  mode: "raw" | "form-data" | "urlencoded";
  rawType?: "json" | "xml" | "text";
  raw: string;
  contentType: string;
  formData?: BodyFormDataRow[];
  urlencoded?: KeyValueRow[];
};

export type BodyFormDataRow = {
  id?: string;
  key: string;
  value: string;
  enabled: boolean;
  valueType: "text" | "file";
  contentType?: string;
  fileNames?: string[];
};

export type BaseRequest = {
  id?: string;
  markerId?: string;
  relativePath?: string;
  folder?: string;
  fileName?: string;
  version: 1;
  type: "http" | "websocket";
  name: string;
  url: string;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
  invalid?: boolean;
};

export type HttpRequest = BaseRequest & {
  type: "http";
  method: string;
  params: KeyValueRow[];
  headers: KeyValueRow[];
  body: BodyState;
};

export type WebSocketRequest = BaseRequest & {
  type: "websocket";
  protocols: string;
};

export type RequestDraft = HttpRequest | WebSocketRequest;

export type RequestMovePosition = "inside" | "before" | "after";

export type RequestMovePayload = {
  request: RequestDraft;
  targetFolder: string;
  targetRelativePath?: string;
  targetRequestId?: string | null;
  position: RequestMovePosition;
};

export type RequestMoveResult = {
  workspace: WorkspaceState;
  movedRequestId: string;
};

export type EnvironmentVariable = {
  id?: string;
  key: string;
  value: string;
  active: boolean;
};

export type EnvironmentConfig = {
  version: 1;
  folder: string;
  relativePath: string;
  variables: EnvironmentVariable[];
  updatedAt?: string;
};

export type WorkspaceState = {
  path: string;
  name: string;
  folders: string[];
  environments: Record<string, EnvironmentConfig>;
  requests: RequestDraft[];
};

export type ResponseBodyKind = "text" | "image" | "audio" | "video" | "binary";

export type ResponseState = {
  status: number;
  statusText: string;
  ok: boolean;
  elapsedMs: number;
  size: number;
  url: string;
  headers: KeyValueRow[];
  body: string;
  bodyBlob: Blob;
  bodyKind: ResponseBodyKind;
  contentType: string;
};

export type WebSocketMessage = {
  id: string;
  direction: "in" | "out" | "system" | "error";
  body: string;
  time: string;
};
