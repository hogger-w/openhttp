import type { HttpRequest, KeyValueRow, ResponseBodyKind } from "../../types";
import { ensureEditableRows } from "./requestUtils";

export function contentTypeForRaw(rawType: "json" | "xml" | "text") {
  if (rawType === "json") {
    return "application/json";
  }
  if (rawType === "xml") {
    return "application/xml";
  }
  return "text/plain";
}

export function contentTypeForBodyMode(mode: HttpRequest["body"]["mode"], rawType: "json" | "xml" | "text" = "json") {
  if (mode === "form-data") {
    return "multipart/form-data";
  }
  if (mode === "urlencoded") {
    return "application/x-www-form-urlencoded";
  }
  return contentTypeForRaw(rawType);
}

export function withContentTypeHeader(rows: KeyValueRow[], contentType: string) {
  const normalizedRows = ensureEditableRows(rows);
  const nextRows: KeyValueRow[] = [];
  let updated = false;

  normalizedRows.forEach((row) => {
    if (row.key.trim().toLowerCase() !== "content-type") {
      nextRows.push(row);
      return;
    }

    if (!updated) {
      nextRows.push({
        ...row,
        key: "Content-Type",
        value: contentType,
        enabled: true
      });
      updated = true;
    }
  });

  if (!updated) {
    const contentTypeRow = {
      id: crypto.randomUUID(),
      key: "Content-Type",
      value: contentType,
      enabled: true
    };
    const blankIndex = nextRows.findIndex((row) => !row.key && !row.value);

    if (blankIndex === -1) {
      nextRows.push(contentTypeRow);
    } else {
      nextRows.splice(blankIndex, 0, contentTypeRow);
    }
  }

  return ensureEditableRows(nextRows);
}

export function formatXml(value: string) {
  const compact = value.replace(/>\s+</g, "><").trim();
  if (!compact) {
    return "";
  }

  let indent = 0;
  return compact
    .replace(/(>)(<)(\/*)/g, "$1\n$2$3")
    .split("\n")
    .map((line) => {
      if (/^<\//.test(line)) {
        indent = Math.max(indent - 1, 0);
      }
      const formatted = `${"  ".repeat(indent)}${line}`;
      if (/^<[^!?/][^>]*[^/]?>$/.test(line) && !line.includes("</")) {
        indent += 1;
      }
      return formatted;
    })
    .join("\n");
}

export function formatRawBody(value: string, rawType: "json" | "xml" | "text") {
  if (!value.trim()) {
    return value;
  }
  if (rawType === "json") {
    return JSON.stringify(JSON.parse(value), null, 2);
  }
  if (rawType === "xml") {
    return formatXml(value);
  }
  return value;
}

export function prettyBody(body: string, contentType: string) {
  if (!body) {
    return "";
  }

  if (!contentType.includes("json")) {
    return body;
  }

  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}

export function responseBodyKind(contentType: string): ResponseBodyKind {
  const mime = contentType.split(";")[0].trim().toLowerCase();

  if (mime.startsWith("image/")) {
    return "image";
  }
  if (mime.startsWith("audio/")) {
    return "audio";
  }
  if (mime.startsWith("video/")) {
    return "video";
  }
  if (
    !mime ||
    mime.startsWith("text/") ||
    mime.includes("json") ||
    mime.includes("xml") ||
    mime.includes("javascript") ||
    mime === "application/x-www-form-urlencoded"
  ) {
    return "text";
  }

  return "binary";
}

export function createResponseTextDecoder(contentType: string) {
  const charset = /charset=([^;]+)/i.exec(contentType)?.[1]?.trim().replace(/^"|"$/g, "") || "utf-8";

  try {
    return new TextDecoder(charset);
  } catch {
    return new TextDecoder("utf-8");
  }
}

export function responseFileExtension(contentType: string, kind: ResponseBodyKind) {
  const mime = contentType.split(";")[0].trim().toLowerCase();
  const subtype = mime.split("/")[1] || "";
  const cleanedSubtype = subtype.replace(/^x-/, "").replace(/\+.*/, "");

  if (mime.includes("json")) {
    return "json";
  }
  if (mime.includes("xml")) {
    return "xml";
  }
  if (mime.includes("html")) {
    return "html";
  }
  if (mime === "image/jpeg") {
    return "jpg";
  }
  if (mime === "image/svg+xml") {
    return "svg";
  }
  if (mime === "audio/mpeg") {
    return "mp3";
  }
  if (mime === "audio/wav" || mime === "audio/x-wav") {
    return "wav";
  }
  if (kind === "text") {
    return "txt";
  }

  return cleanedSubtype || "bin";
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function timeStamp() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
