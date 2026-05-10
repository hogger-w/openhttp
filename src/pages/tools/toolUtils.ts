export function encodeBase64Text(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

export function decodeBase64Text(value: string) {
  const binary = atob(value.replace(/\s+/g, ""));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

export function base64ToBlob(base64: string, mimeType = "application/octet-stream") {
  const binary = atob(base64.replace(/\s+/g, ""));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new Blob([bytes], { type: mimeType });
}

export function downloadBlob(blob: Blob, fileName: string) {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

export async function saveBlob(blob: Blob, suggestedName: string) {
  const savePicker = (window as typeof window & {
    showSaveFilePicker?: (options?: {
      suggestedName?: string;
      types?: Array<{ description: string; accept: Record<string, string[]> }>;
    }) => Promise<{
      createWritable: () => Promise<{
        write: (data: Blob) => Promise<void>;
        close: () => Promise<void>;
      }>;
    }>;
  }).showSaveFilePicker;

  if (!savePicker) {
    downloadBlob(blob, suggestedName);
    return;
  }

  const handle = await savePicker({
    suggestedName,
    types: [
      {
        description: "Decoded file",
        accept: { "application/octet-stream": [".bin"] }
      }
    ]
  });
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
}

export function safeEncodeURIComponent(value: string) {
  return encodeURIComponent(value);
}

export function safeDecodeURIComponent(value: string) {
  return decodeURIComponent(value);
}
