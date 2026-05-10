export const httpMethods = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
export const bodylessMethods = new Set(["GET", "HEAD"]);
export const rootFolderId = "__root__";
export const envLabel = "Environment";

export const commonHeaderNames = [
  "Accept",
  "Accept-Encoding",
  "Authorization",
  "Cache-Control",
  "Content-Type",
  "Cookie",
  "If-None-Match",
  "Origin",
  "Referer",
  "User-Agent",
  "X-API-Key",
  "X-Requested-With"
];

export const commonFormDataContentTypes = [
  "",
  "text/plain",
  "application/json",
  "application/xml",
  "text/html",
  "image/png",
  "image/jpeg",
  "application/pdf",
  "application/octet-stream"
];
