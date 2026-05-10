import type { EnvironmentConfig, KeyValueRow } from "../../types";

export function applyRowsToUrl(rawUrl: string, params: KeyValueRow[]) {
  if (!rawUrl.trim()) {
    return rawUrl;
  }

  const normalizedUrl = /^[a-z][a-z\d+.-]*:\/\//i.test(rawUrl.trim()) ? rawUrl.trim() : `http://${rawUrl.trim()}`;
  const enabledRows = params.filter((row) => row.enabled && row.key.trim());
  if (enabledRows.length === 0) {
    return normalizedUrl;
  }

  const url = new URL(normalizedUrl);

  enabledRows.forEach((row) => {
    url.searchParams.set(row.key.trim(), row.value);
  });

  return url.toString();
}

export function activeEnvironmentMap(environment?: EnvironmentConfig) {
  const values = new Map<string, string>();

  environment?.variables.forEach((variable) => {
    const key = variable.key.trim();
    if (key && variable.active && !values.has(key)) {
      values.set(key, variable.value);
    }
  });

  return values;
}

export function resolveVariables(value: string, environment?: EnvironmentConfig) {
  const values = activeEnvironmentMap(environment);
  return value.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_token, key: string) => values.get(key) ?? "");
}
