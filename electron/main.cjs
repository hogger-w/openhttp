const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");

const HTTP_FILE_SUFFIX = ".http";
const LEGACY_REQUEST_FILE_SUFFIX = ".openhttp.json";
const APP_NAME = "OpenHTTP";
const APP_USER_MODEL_ID = "com.openhttp.app";
const httpMethods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
const SHORTCUT_FILE_NAME = `${APP_NAME}.lnk`;

app.setName(APP_NAME);
if (process.platform === "win32") {
  app.setAppUserModelId(APP_USER_MODEL_ID);
}

app.commandLine.appendSwitch("disable-web-security");
app.commandLine.appendSwitch("allow-running-insecure-content");

let mainWindow;
const isSmokeTest = process.env.OPENHTTP_SMOKE === "1";
let verifySslCertificates = true;

function getAppIconPath() {
  return app.isPackaged ? process.execPath : path.join(__dirname, "..", "assets", "oh.ico");
}

function getWindowsShortcutDetails() {
  const target = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;

  return {
    target,
    cwd: process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(target),
    description: APP_NAME,
    icon: target,
    iconIndex: 0,
    appUserModelId: APP_USER_MODEL_ID
  };
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function getAvailableShortcutPath(directory, preferredPath) {
  if (!(await pathExists(preferredPath))) {
    return preferredPath;
  }

  for (let index = 2; index < 100; index += 1) {
    const candidate = path.join(directory, `${APP_NAME} (${index}).lnk`);
    if (!(await pathExists(candidate))) {
      return candidate;
    }
  }

  return preferredPath;
}

async function ensureWindowsStartMenuShortcut() {
  const shortcutDirectory = path.join(app.getPath("appData"), "Microsoft", "Windows", "Start Menu", "Programs");
  const shortcutPath = path.join(shortcutDirectory, SHORTCUT_FILE_NAME);

  await fs.mkdir(shortcutDirectory, { recursive: true });
  shell.writeShortcutLink(shortcutPath, (await pathExists(shortcutPath)) ? "replace" : "create", getWindowsShortcutDetails());
}

async function repairWindowsTaskbarShortcuts() {
  const taskbarDirectory = path.join(
    app.getPath("appData"),
    "Microsoft",
    "Internet Explorer",
    "Quick Launch",
    "User Pinned",
    "TaskBar"
  );
  const executableTargets = new Set(
    [process.execPath, getWindowsShortcutDetails().target].map((target) => path.resolve(target).toLowerCase())
  );
  let entries;

  try {
    entries = await fs.readdir(taskbarDirectory, { withFileTypes: true });
  } catch {
    return;
  }

  await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".lnk"))
      .map(async (entry) => {
        const shortcutPath = path.join(taskbarDirectory, entry.name);
        let shortcutDetails;

        try {
          shortcutDetails = shell.readShortcutLink(shortcutPath);
        } catch {
          return;
        }

        if (!executableTargets.has(path.resolve(shortcutDetails.target || "").toLowerCase())) {
          return;
        }

        shell.writeShortcutLink(shortcutPath, "replace", getWindowsShortcutDetails());

        if (!/^electron(?: \(\d+\))?\.lnk$/i.test(entry.name)) {
          return;
        }

        const desiredPath = await getAvailableShortcutPath(taskbarDirectory, path.join(taskbarDirectory, SHORTCUT_FILE_NAME));
        if (path.resolve(desiredPath).toLowerCase() === path.resolve(shortcutPath).toLowerCase()) {
          return;
        }

        try {
          await fs.rename(shortcutPath, desiredPath);
        } catch {
          // Windows may keep taskbar shortcuts locked while Explorer refreshes them.
        }
      })
  );
}

async function ensureWindowsShellIntegration() {
  if (process.platform !== "win32" || !app.isPackaged) {
    return;
  }

  await ensureWindowsStartMenuShortcut();
  await repairWindowsTaskbarShortcuts();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1380,
    height: 920,
    minWidth: 1040,
    minHeight: 720,
    title: APP_NAME,
    icon: getAppIconPath(),
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: "#f5f3ef",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: false,
      allowRunningInsecureContent: true
    }
  });

  Menu.setApplicationMenu(null);

  const emitWindowState = () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    mainWindow.webContents.send("window:maximized-change", mainWindow.isMaximized());
  };

  mainWindow.on("maximize", emitWindowState);
  mainWindow.on("unmaximize", emitWindowState);

  if (app.isPackaged || isSmokeTest) {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  } else {
    mainWindow.loadURL("http://127.0.0.1:5173");
    if (process.env.OPENHTTP_DEVTOOLS === "1") {
      mainWindow.webContents.openDevTools({ mode: "detach" });
    }
  }

  if (isSmokeTest) {
    mainWindow.webContents.once("did-finish-load", () => {
      console.log("OPENHTTP_SMOKE_OK");
      setTimeout(() => app.quit(), 200);
    });

    mainWindow.webContents.once("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
      console.error(`OPENHTTP_SMOKE_FAILED ${errorCode} ${errorDescription} ${validatedURL}`);
      app.exit(1);
    });
  }
}

app.whenReady().then(async () => {
  try {
    await ensureWindowsShellIntegration();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Failed to update Windows shortcuts: ${message}`);
  }

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("certificate-error", (event, _webContents, _url, _error, _certificate, callback) => {
  if (!verifySslCertificates) {
    event.preventDefault();
    callback(true);
    return;
  }

  callback(false);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

function ensureInsideWorkspace(workspacePath, targetPath) {
  const workspaceRoot = path.resolve(workspacePath);
  const resolvedTarget = path.resolve(targetPath);
  const relative = path.relative(workspaceRoot, resolvedTarget);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Target path is outside of the selected workspace.");
  }
}

function slugify(value) {
  const fallback = "request";
  const slug = String(value || fallback)
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);

  return slug || fallback;
}

function collectionFileName(workspaceRoot, folder) {
  const folderName = folder ? path.basename(folder) : path.basename(workspaceRoot);
  return `${slugify(folderName)}${HTTP_FILE_SUFFIX}`;
}

function collectionRelativePath(workspaceRoot, folder) {
  return (folder ? `${folder}/${collectionFileName(workspaceRoot, folder)}` : collectionFileName(workspaceRoot, folder)).replaceAll("\\", "/");
}

function collectionFullPath(workspaceRoot, folder) {
  return path.join(workspaceRoot, folder || "", collectionFileName(workspaceRoot, folder));
}

function folderFullPath(workspaceRoot, folder) {
  return path.join(workspaceRoot, folder || "");
}

function relativeFolderPath(workspaceRoot, folderPath) {
  const relative = path.relative(workspaceRoot, folderPath).replaceAll(path.sep, "/");
  return relative === "." ? "" : relative;
}

function folderFromRelativePath(relativePath) {
  const folder = path.dirname(relativePath).replaceAll("\\", "/");
  return folder === "." ? "" : folder;
}

async function nextAvailableFolderPath(workspaceRoot, folder) {
  if (!folder) {
    throw new Error("The workspace root folder cannot be copied.");
  }

  const sourcePath = folderFullPath(workspaceRoot, folder);
  const parentPath = path.dirname(sourcePath);
  const baseName = `${path.basename(sourcePath)} Copy`;
  let attempt = 0;

  while (true) {
    const candidate = path.join(parentPath, attempt === 0 ? baseName : `${baseName} ${attempt + 1}`);
    ensureInsideWorkspace(workspaceRoot, candidate);

    try {
      await fs.access(candidate);
      attempt += 1;
    } catch {
      return candidate;
    }
  }
}

async function createAvailableChildFolder(workspaceRoot, parentFolder, name) {
  const safeName = slugify(name || "New Folder");
  let attempt = 0;

  while (true) {
    const folderName = attempt === 0 ? safeName : `${safeName} ${attempt + 1}`;
    const targetPath = path.join(workspaceRoot, parentFolder || "", folderName);
    ensureInsideWorkspace(workspaceRoot, targetPath);

    try {
      await fs.mkdir(targetPath, { recursive: false });
      return {
        targetPath,
        createdFolder: relativeFolderPath(workspaceRoot, targetPath)
      };
    } catch (error) {
      if (error && error.code === "EEXIST") {
        attempt += 1;
        continue;
      }

      throw error;
    }
  }
}

function requestMarkerId(request) {
  if (request.markerId) {
    return String(request.markerId);
  }

  const raw = String(request.id || "");
  const marker = raw.includes("#") ? raw.slice(raw.lastIndexOf("#") + 1) : raw;
  return marker && !marker.startsWith("draft-") ? marker : cryptoRandomId();
}

function cryptoRandomId() {
  return `${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;
}

function normalizeRequest(raw, relativePath, folder = "") {
  const type = raw.type === "websocket" ? "websocket" : "http";
  const basename = path.basename(relativePath, HTTP_FILE_SUFFIX);
  const markerId = raw.markerId || requestMarkerId(raw);
  const id = `${relativePath}#${markerId}`;

  if (type === "websocket") {
    return {
      id,
      markerId,
      version: 1,
      type,
      name: raw.name || basename || "WebSocket Request",
      folder,
      relativePath,
      fileName: path.basename(relativePath),
      url: raw.url || "ws://127.0.0.1:8080",
      protocols: raw.protocols || "",
      notes: raw.notes || "",
      createdAt: raw.createdAt || new Date().toISOString(),
      updatedAt: raw.updatedAt || raw.createdAt || new Date().toISOString()
    };
  }

  return {
    id,
    markerId,
    version: 1,
    type,
    name: raw.name || basename || "HTTP Request",
    folder,
    relativePath,
    fileName: path.basename(relativePath),
    method: raw.method || "GET",
    url: raw.url || "http://127.0.0.1:8080",
    params: Array.isArray(raw.params) ? raw.params : [],
    headers: Array.isArray(raw.headers) ? raw.headers : [],
    body: {
      mode: raw.body?.mode || "raw",
      rawType: raw.body?.rawType || "json",
      raw: raw.body?.raw || "",
      contentType: raw.body?.contentType || "",
      formData: Array.isArray(raw.body?.formData) ? raw.body.formData : [],
      urlencoded: Array.isArray(raw.body?.urlencoded) ? raw.body.urlencoded : []
    },
    notes: raw.notes || "",
    createdAt: raw.createdAt || new Date().toISOString(),
    updatedAt: raw.updatedAt || raw.createdAt || new Date().toISOString()
  };
}

function parseHeaderRows(lines) {
  return lines
    .map((line) => {
      const separatorIndex = line.indexOf(":");
      if (separatorIndex === -1) {
        return null;
      }

      return {
        key: line.slice(0, separatorIndex).trim(),
        value: line.slice(separatorIndex + 1).trim(),
        enabled: true
      };
    })
    .filter(Boolean);
}

function parseHttpCollection(content, relativePath, folder) {
  const normalizedContent = content.replace(/\r\n/g, "\n");
  const lines = normalizedContent.split("\n");
  const segments = [];
  let current = [];

  lines.forEach((line) => {
    if (/^\s*###/.test(line) && current.some((item) => item.trim())) {
      segments.push(current);
      current = [line];
    } else {
      current.push(line);
    }
  });

  if (current.some((item) => item.trim())) {
    segments.push(current);
  }

  return segments
    .map((segment, index) => parseHttpSegment(segment, relativePath, folder, index))
    .filter(Boolean);
}

function parseHttpSegment(segment, relativePath, folder, index) {
  const lines = [...segment];
  let name = "";
  let markerId = "";
  let openHttpBody = null;

  while (lines.length && !lines[0].trim()) {
    lines.shift();
  }

  if (lines[0]?.trim().startsWith("###")) {
    name = lines.shift().trim().replace(/^###\s*/, "").trim();
  }

  while (lines.length) {
    const line = lines[0].trim();
    const nameMatch = line.match(/^#\s*@name\s+(.+)$/i);
    const idMatch = line.match(/^#\s*@id\s+(.+)$/i);

    if (nameMatch) {
      if (!name) {
        name = nameMatch[1].trim();
      }
      lines.shift();
      continue;
    }

    if (idMatch) {
      markerId = idMatch[1].trim();
      lines.shift();
      continue;
    }

    const bodyMatch = line.match(/^#\s*@openhttp-body\s+(.+)$/i);
    if (bodyMatch) {
      try {
        openHttpBody = JSON.parse(bodyMatch[1]);
      } catch {
        openHttpBody = null;
      }
      lines.shift();
      continue;
    }

    if (!line || line.startsWith("#") || line.startsWith("//")) {
      lines.shift();
      continue;
    }

    break;
  }

  const requestLine = lines.shift()?.trim();
  if (!requestLine) {
    return null;
  }

  const headerLines = [];
  while (lines.length) {
    const line = lines.shift();
    if (line === undefined || !line.trim()) {
      break;
    }
    headerLines.push(line);
  }

  const body = lines.join("\n").replace(/\n+$/g, "");
  const headers = parseHeaderRows(headerLines);
  const contentType = headers.find((header) => header.key.toLowerCase() === "content-type")?.value || "";
  const marker = markerId || cryptoRandomId();

  if (/^WEBSOCKET\s+/i.test(requestLine)) {
    const url = requestLine.replace(/^WEBSOCKET\s+/i, "").trim();
    const protocols = headers.find((header) => header.key.toLowerCase() === "sec-websocket-protocol")?.value || "";
    return normalizeRequest(
      {
        markerId: marker,
        type: "websocket",
        name: name || `WebSocket Request ${index + 1}`,
        url,
        protocols
      },
      relativePath,
      folder
    );
  }

  const [methodCandidate, ...urlParts] = requestLine.split(/\s+/);
  const method = methodCandidate.toUpperCase();

  if (!httpMethods.has(method)) {
    return null;
  }

  const url = urlParts.join(" ").replace(/\s+HTTP\/\d(?:\.\d)?$/i, "").trim();

  return normalizeRequest(
    {
      markerId: marker,
      type: "http",
      name: name || `${method} Request ${index + 1}`,
      method,
      url,
      headers,
      params: [],
      body: {
        mode: "raw",
        rawType: contentType.includes("xml") ? "xml" : contentType.includes("json") ? "json" : "text",
        raw: body,
        contentType,
        ...(openHttpBody || {})
      }
    },
    relativePath,
    folder
  );
}

function requestUrlWithParams(request) {
  if (request.type !== "http" || !Array.isArray(request.params) || request.params.length === 0) {
    return request.url || "";
  }

  const enabledParams = request.params.filter((param) => param.enabled && String(param.key || "").trim());
  if (enabledParams.length === 0) {
    return request.url || "";
  }

  const separator = String(request.url || "").includes("?") ? "&" : "?";
  const query = enabledParams
    .map((param) => `${encodeURIComponent(String(param.key).trim())}=${encodeURIComponent(String(param.value || ""))}`)
    .join("&");

  return `${request.url || ""}${separator}${query}`;
}

function serializeHttpRequest(request, relativePath) {
  const markerId = requestMarkerId(request);
  const lines = [`### ${request.name || "Untitled Request"}`, `# @name ${slugify(request.name || "request")}`, `# @id ${markerId}`];
  if (request.type === "http" && request.body && request.body.mode !== "raw") {
    lines.push(`# @openhttp-body ${JSON.stringify(request.body)}`);
  }

  if (request.type === "websocket") {
    lines.push(`WEBSOCKET ${request.url || ""}`);
    if (request.protocols) {
      lines.push(`Sec-WebSocket-Protocol: ${request.protocols}`);
    }
    return lines.join("\n");
  }

  lines.push(`${request.method || "GET"} ${requestUrlWithParams(request)}`);

  const headers = Array.isArray(request.headers) ? request.headers.filter((header) => header.enabled !== false && header.key) : [];
  const hasContentType = headers.some((header) => String(header.key).toLowerCase() === "content-type");
  headers.forEach((header) => {
    lines.push(`${header.key}: ${header.value || ""}`);
  });

  if (request.body?.contentType && !hasContentType) {
    lines.push(`Content-Type: ${request.body.contentType}`);
  }

  if (request.body?.mode === "urlencoded" && Array.isArray(request.body.urlencoded)) {
    const encoded = request.body.urlencoded
      .filter((row) => row.enabled !== false && row.key)
      .map((row) => `${encodeURIComponent(row.key)}=${encodeURIComponent(row.value || "")}`)
      .join("&");
    if (encoded) {
      lines.push("", encoded);
    }
  } else if (request.body?.mode === "raw" && request.body?.raw) {
    lines.push("", request.body.raw);
  }

  return lines.join("\n");
}

function parseHttpEnvironment(content, relativePath, folder) {
  const normalizedContent = content.replace(/\r\n/g, "\n");
  const lines = normalizedContent.split("\n");

  for (const line of lines) {
    const match = line.trim().match(/^#\s*@openhttp-environment\s+(.+)$/i);
    if (!match) {
      continue;
    }

    try {
      return normalizeEnvironment(JSON.parse(match[1]), folder, relativePath);
    } catch {
      return null;
    }
  }

  return null;
}

function serializeHttpEnvironment(environment) {
  const payload = {
    version: 1,
    variables: Array.isArray(environment.variables)
      ? environment.variables.map((variable) => ({
          id: variable.id,
          key: variable.key,
          value: variable.value,
          active: Boolean(variable.active)
        }))
      : [],
    updatedAt: environment.updatedAt || new Date().toISOString()
  };

  return [`### Environment`, `# @openhttp-environment ${JSON.stringify(payload)}`].join("\n");
}

function serializeHttpCollection(requests, relativePath, environment = null) {
  const segments = [];

  if (environment) {
    segments.push(serializeHttpEnvironment(environment));
  }

  segments.push(...requests.map((request) => serializeHttpRequest(request, relativePath)));
  return `${segments.join("\n\n")}\n`;
}

async function readCollectionDocument(workspaceRoot, folder, relativePath) {
  const filePath = path.join(workspaceRoot, relativePath);
  try {
    const content = await fs.readFile(filePath, "utf8");
    return {
      requests: parseHttpCollection(content, relativePath, folder),
      environment: parseHttpEnvironment(content, relativePath, folder)
    };
  } catch {
    return {
      requests: [],
      environment: null
    };
  }
}

function normalizeEnvironment(raw, folder, relativePath = "") {
  const variables = Array.isArray(raw.variables)
    ? raw.variables.map((variable) => ({
        id: variable.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        key: String(variable.key || ""),
        value: String(variable.value || ""),
        active: Boolean(variable.active)
      }))
    : [];

  return {
    version: 1,
    folder,
    relativePath: relativePath || raw.relativePath || "",
    variables,
    updatedAt: raw.updatedAt || new Date().toISOString()
  };
}

async function readWorkspace(workspacePath) {
  const workspaceRoot = path.resolve(workspacePath);
  const stats = await fs.stat(workspaceRoot);

  if (!stats.isDirectory()) {
    throw new Error("Workspace path is not a directory.");
  }

  const requests = [];
  const folderSet = new Set([""]);
  const environments = {};

  async function visit(directory) {
    const folder = path.relative(workspaceRoot, directory).replaceAll(path.sep, "/");
    const normalizedFolder = folder === "." ? "" : folder;
    folderSet.add(normalizedFolder);

    const entries = await fs.readdir(directory, { withFileTypes: true });
    const hasHttpCollection = entries.some((entry) => entry.isFile() && entry.name.endsWith(HTTP_FILE_SUFFIX));

    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".git") {
        continue;
      }

      const fullPath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        await visit(fullPath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const relativePath = path.relative(workspaceRoot, fullPath).replaceAll(path.sep, "/");
      const requestFolder = path.dirname(relativePath) === "." ? "" : path.dirname(relativePath).replaceAll("\\", "/");

      if (entry.name.endsWith(HTTP_FILE_SUFFIX)) {
        const content = await fs.readFile(fullPath, "utf8");
        const parsedRequests = parseHttpCollection(content, relativePath, requestFolder);
        const parsedEnvironment = parseHttpEnvironment(content, relativePath, requestFolder);
        const canonicalRelativePath = collectionRelativePath(workspaceRoot, requestFolder);
        const existingEnvironment = environments[requestFolder];

        if (
          parsedEnvironment &&
          (!existingEnvironment || relativePath === canonicalRelativePath || existingEnvironment.relativePath !== canonicalRelativePath)
        ) {
          environments[requestFolder] = parsedEnvironment;
        }

        requests.push(...parsedRequests);
        continue;
      }

      if (!hasHttpCollection && entry.name.endsWith(LEGACY_REQUEST_FILE_SUFFIX)) {
        try {
          const raw = JSON.parse(await fs.readFile(fullPath, "utf8"));
          requests.push(normalizeRequest(raw, relativePath, requestFolder));
        } catch {
          // Invalid legacy request files are ignored during migration.
        }
      }
    }

    if (!environments[normalizedFolder]) {
      environments[normalizedFolder] = normalizeEnvironment(
        { variables: [] },
        normalizedFolder,
        collectionRelativePath(workspaceRoot, normalizedFolder)
      );
    }
  }

  await visit(workspaceRoot);

  return {
    path: workspaceRoot,
    name: path.basename(workspaceRoot),
    folders: Array.from(folderSet).sort((a, b) => a.localeCompare(b)),
    environments,
    requests
  };
}

ipcMain.handle("workspace:open", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Open Local Collection Folder",
    properties: ["openDirectory", "createDirectory"]
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return readWorkspace(result.filePaths[0]);
});

ipcMain.handle("workspace:read", async (_event, workspacePath) => {
  return readWorkspace(workspacePath);
});

ipcMain.handle("request:save", async (_event, workspacePath, request) => {
  const workspaceRoot = path.resolve(workspacePath);
  const folder = request.folder || "";
  const relativePath = request.relativePath && request.relativePath.endsWith(HTTP_FILE_SUFFIX)
    ? request.relativePath
    : collectionRelativePath(workspaceRoot, folder);
  const targetPath = path.join(workspaceRoot, relativePath);

  ensureInsideWorkspace(workspaceRoot, targetPath);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });

  const existingDocument = await readCollectionDocument(workspaceRoot, folder, relativePath);
  const normalized = normalizeRequest(
    {
      ...request,
      updatedAt: new Date().toISOString(),
      createdAt: request.createdAt || new Date().toISOString()
    },
    relativePath,
    folder
  );
  const shouldUpdateExisting = Boolean(request.id && existingDocument.requests.some((existingRequest) => existingRequest.id === request.id));
  const nextRequests = shouldUpdateExisting
    ? existingDocument.requests.map((existingRequest) => (existingRequest.id === request.id ? normalized : existingRequest))
    : [...existingDocument.requests, normalized];

  await fs.writeFile(targetPath, serializeHttpCollection(nextRequests, relativePath, existingDocument.environment), "utf8");
  return readWorkspace(workspaceRoot);
});

ipcMain.handle("request:delete", async (_event, workspacePath, request) => {
  const workspaceRoot = path.resolve(workspacePath);
  const folder = request.folder || "";
  const relativePath = request.relativePath && request.relativePath.endsWith(HTTP_FILE_SUFFIX)
    ? request.relativePath
    : collectionRelativePath(workspaceRoot, folder);
  const targetPath = path.join(workspaceRoot, relativePath);
  ensureInsideWorkspace(workspaceRoot, targetPath);

  const existingDocument = await readCollectionDocument(workspaceRoot, folder, relativePath);
  const nextRequests = existingDocument.requests.filter((existingRequest) => existingRequest.id !== request.id);
  await fs.writeFile(targetPath, serializeHttpCollection(nextRequests, relativePath, existingDocument.environment), "utf8");
  return readWorkspace(workspaceRoot);
});

ipcMain.handle("request:move", async (_event, workspacePath, payload) => {
  const request = payload?.request;
  if (!request?.id) {
    throw new Error("Request cannot be moved before it has been saved.");
  }

  const workspaceRoot = path.resolve(workspacePath);
  const requestedSourceFolder = String(request.folder || "").replaceAll("\\", "/");
  const rawSourceRelativePath = request.relativePath && request.relativePath.endsWith(HTTP_FILE_SUFFIX)
    ? String(request.relativePath).replaceAll("\\", "/")
    : collectionRelativePath(workspaceRoot, requestedSourceFolder);
  const sourcePath = path.resolve(workspaceRoot, rawSourceRelativePath);
  ensureInsideWorkspace(workspaceRoot, sourcePath);
  const sourceRelativePath = path.relative(workspaceRoot, sourcePath).replaceAll(path.sep, "/");
  const sourceFolder = folderFromRelativePath(sourceRelativePath);

  const requestedTargetFolder = String(payload.targetFolder || "").replaceAll("\\", "/");
  const rawTargetRelativePath = payload.targetRelativePath && String(payload.targetRelativePath).endsWith(HTTP_FILE_SUFFIX)
    ? String(payload.targetRelativePath).replaceAll("\\", "/")
    : collectionRelativePath(workspaceRoot, requestedTargetFolder);
  const targetPath = path.resolve(workspaceRoot, rawTargetRelativePath);
  ensureInsideWorkspace(workspaceRoot, targetPath);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });

  const targetRelativePath = path.relative(workspaceRoot, targetPath).replaceAll(path.sep, "/");
  const targetFolder = folderFromRelativePath(targetRelativePath);
  const sameDocument = sourceRelativePath === targetRelativePath;
  const sourceDocument = await readCollectionDocument(workspaceRoot, sourceFolder, sourceRelativePath);
  const movingRequest = sourceDocument.requests.find((existingRequest) => existingRequest.id === request.id);

  if (!movingRequest) {
    throw new Error("Request was not found in its source collection.");
  }

  const movingMarkerId = requestMarkerId(movingRequest);
  const sourceRequests = sourceDocument.requests.filter((existingRequest) => existingRequest.id !== request.id);
  const targetDocument = sameDocument
    ? { requests: sourceRequests, environment: sourceDocument.environment }
    : await readCollectionDocument(workspaceRoot, targetFolder, targetRelativePath);
  const targetRequests = targetDocument.requests.filter((existingRequest) => existingRequest.id !== request.id);
  const nextMarkerId = targetRequests.some((existingRequest) => requestMarkerId(existingRequest) === movingMarkerId)
    ? cryptoRandomId()
    : movingMarkerId;
  const normalized = normalizeRequest(
    {
      ...movingRequest,
      markerId: nextMarkerId,
      folder: targetFolder,
      updatedAt: new Date().toISOString(),
      createdAt: movingRequest.createdAt || new Date().toISOString()
    },
    targetRelativePath,
    targetFolder
  );

  let insertIndex = targetRequests.length;
  const targetRequestId = payload.targetRequestId ? String(payload.targetRequestId) : "";
  if (targetRequestId && targetRequestId !== request.id) {
    const targetIndex = targetRequests.findIndex((existingRequest) => existingRequest.id === targetRequestId);
    if (targetIndex >= 0) {
      insertIndex = payload.position === "after" ? targetIndex + 1 : targetIndex;
    }
  }

  targetRequests.splice(insertIndex, 0, normalized);

  if (sameDocument) {
    await fs.writeFile(targetPath, serializeHttpCollection(targetRequests, targetRelativePath, targetDocument.environment), "utf8");
  } else {
    await fs.writeFile(targetPath, serializeHttpCollection(targetRequests, targetRelativePath, targetDocument.environment), "utf8");
    await fs.writeFile(sourcePath, serializeHttpCollection(sourceRequests, sourceRelativePath, sourceDocument.environment), "utf8");
  }

  return {
    workspace: await readWorkspace(workspaceRoot),
    movedRequestId: normalized.id
  };
});

ipcMain.handle("environment:save", async (_event, workspacePath, environment) => {
  const workspaceRoot = path.resolve(workspacePath);
  const folder = environment.folder || "";
  const relativePath = environment.relativePath && environment.relativePath.endsWith(HTTP_FILE_SUFFIX)
    ? environment.relativePath
    : collectionRelativePath(workspaceRoot, folder);
  const targetPath = path.join(workspaceRoot, relativePath);
  ensureInsideWorkspace(workspaceRoot, targetPath);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });

  const activeByKey = new Set();
  const normalized = normalizeEnvironment(
    {
      ...environment,
      variables: (environment.variables || []).map((variable) => {
        const key = String(variable.key || "").trim();
        const canStayActive = variable.active && key && !activeByKey.has(key);

        if (canStayActive) {
          activeByKey.add(key);
        }

        return {
          ...variable,
          key,
          active: canStayActive
        };
      }),
      updatedAt: new Date().toISOString()
    },
    folder,
    relativePath
  );

  const existingDocument = await readCollectionDocument(workspaceRoot, folder, relativePath);
  await fs.writeFile(targetPath, serializeHttpCollection(existingDocument.requests, relativePath, normalized), "utf8");
  return readWorkspace(workspaceRoot);
});

ipcMain.handle("folder:open-location", async (_event, workspacePath, folder) => {
  const workspaceRoot = path.resolve(workspacePath);
  const targetPath = folderFullPath(workspaceRoot, folder || "");
  ensureInsideWorkspace(workspaceRoot, targetPath);
  await shell.openPath(targetPath);
});

ipcMain.handle("request:open-location", async (_event, workspacePath, request) => {
  const workspaceRoot = path.resolve(workspacePath);
  const folder = request?.folder || "";
  const relativePath = request?.relativePath
    ? String(request.relativePath).replaceAll("\\", "/")
    : collectionRelativePath(workspaceRoot, folder);
  const targetPath = path.join(workspaceRoot, relativePath);
  ensureInsideWorkspace(workspaceRoot, targetPath);
  shell.showItemInFolder(targetPath);
});

ipcMain.handle("folder:copy", async (_event, workspacePath, folder) => {
  const workspaceRoot = path.resolve(workspacePath);
  const sourcePath = folderFullPath(workspaceRoot, folder || "");
  ensureInsideWorkspace(workspaceRoot, sourcePath);

  const targetPath = await nextAvailableFolderPath(workspaceRoot, folder || "");
  await fs.cp(sourcePath, targetPath, {
    recursive: true,
    filter: (source) => path.resolve(source) !== path.resolve(targetPath)
  });
  return readWorkspace(workspaceRoot);
});

ipcMain.handle("folder:delete", async (_event, workspacePath, folder) => {
  if (!folder) {
    throw new Error("The workspace root folder cannot be deleted.");
  }

  const workspaceRoot = path.resolve(workspacePath);
  const targetPath = folderFullPath(workspaceRoot, folder);
  ensureInsideWorkspace(workspaceRoot, targetPath);
  await fs.rm(targetPath, { recursive: true, force: true });
  return readWorkspace(workspaceRoot);
});

ipcMain.handle("folder:create", async (_event, workspacePath, parentFolder, name) => {
  const workspaceRoot = path.resolve(workspacePath);
  const parentPath = folderFullPath(workspaceRoot, parentFolder || "");
  ensureInsideWorkspace(workspaceRoot, parentPath);

  const { createdFolder } = await createAvailableChildFolder(workspaceRoot, parentFolder || "", name);

  return {
    workspace: await readWorkspace(workspaceRoot),
    createdFolder
  };
});

ipcMain.handle("settings:set-verify-ssl", (_event, value) => {
  verifySslCertificates = Boolean(value);
  return verifySslCertificates;
});

ipcMain.handle("app:get-version", () => app.getVersion());

ipcMain.handle("window:minimize", () => {
  mainWindow?.minimize();
});

ipcMain.handle("window:toggle-maximize", () => {
  if (!mainWindow) {
    return false;
  }

  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }

  return mainWindow.isMaximized();
});

ipcMain.handle("window:close", () => {
  mainWindow?.close();
});

ipcMain.handle("window:is-maximized", () => {
  return Boolean(mainWindow?.isMaximized());
});
