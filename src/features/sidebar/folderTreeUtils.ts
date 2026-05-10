import type { RequestDraft, WorkspaceState } from "../../types";
import type { FolderNode } from "../../shared/appTypes";

export function buildFolderTree(workspace: WorkspaceState | null, requests: RequestDraft[]): FolderNode | null {
  if (!workspace) {
    return null;
  }

  const root: FolderNode = {
    path: "",
    name: workspace.name,
    children: [],
    requests: []
  };
  const nodes = new Map<string, FolderNode>([["", root]]);

  workspace.folders.forEach((folder) => {
    if (!folder) {
      return;
    }

    const parts = folder.split("/");
    let currentPath = "";

    parts.forEach((part) => {
      const nextPath = currentPath ? `${currentPath}/${part}` : part;

      if (!nodes.has(nextPath)) {
        const node = { path: nextPath, name: part, children: [], requests: [] };
        nodes.set(nextPath, node);
        nodes.get(currentPath || "")?.children.push(node);
      }

      currentPath = nextPath;
    });
  });

  requests.forEach((request) => {
    const folder = request.folder || "";
    if (!nodes.has(folder)) {
      const parts = folder.split("/").filter(Boolean);
      let currentPath = "";
      parts.forEach((part) => {
        const nextPath = currentPath ? `${currentPath}/${part}` : part;
        if (!nodes.has(nextPath)) {
          const node = { path: nextPath, name: part, children: [], requests: [] };
          nodes.set(nextPath, node);
          nodes.get(currentPath || "")?.children.push(node);
        }
        currentPath = nextPath;
      });
    }

    nodes.get(folder)?.requests.push(request);
  });

  nodes.forEach((node) => {
    node.children.sort((a, b) => a.name.localeCompare(b.name));
  });

  return root;
}
