import { useEffect, useRef, useState } from "react";
import { FolderPen, FolderPlus } from "lucide-react";

export function CreateFolderDialog({
  parentLabel,
  initialName = "New Folder",
  title = "Create Folder",
  actionLabel = "Create",
  actionIcon = "create",
  onCancel,
  onCreate
}: {
  parentLabel: string;
  initialName?: string;
  title?: string;
  actionLabel?: string;
  actionIcon?: "create" | "rename";
  onCancel: () => void;
  onCreate: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(initialName);
  const [error, setError] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isCreating) {
        onCancel();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isCreating, onCancel]);

  const submit = async () => {
    const folderName = name.trim();
    if (!folderName || isCreating) {
      return;
    }

    setError("");
    setIsCreating(true);

    try {
      await onCreate(folderName);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : String(createError));
      setIsCreating(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <section className="confirm-modal" role="dialog" aria-modal="true" aria-label={title}>
        <header className="confirm-modal-title">
          <h2>{title}</h2>
        </header>
        <div className="confirm-modal-body">
          <label className="folder-name-field">
            <span>{parentLabel}</span>
            <input
              ref={inputRef}
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void submit();
                }
              }}
              disabled={isCreating}
            />
          </label>
          {error && <p className="modal-error">{error}</p>}
        </div>
        <footer className="confirm-modal-actions">
          <button className="button soft" onClick={onCancel} disabled={isCreating}>
            Cancel
          </button>
          <button className="button primary" onClick={() => void submit()} disabled={!name.trim() || isCreating}>
            {actionIcon === "rename" ? <FolderPen size={16} /> : <FolderPlus size={16} />}
            {actionLabel}
          </button>
        </footer>
      </section>
    </div>
  );
}
