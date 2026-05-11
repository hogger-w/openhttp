import { useEffect, useRef } from "react";
import { Save } from "lucide-react";

export function CloseDirtyTabsDialog({
  dirtyCount,
  onDiscard,
  onSave
}: {
  dirtyCount: number;
  onDiscard: () => void;
  onSave: () => void;
}) {
  const saveButtonRef = useRef<HTMLButtonElement | null>(null);
  const tabLabel = dirtyCount === 1 ? "tab has" : `${dirtyCount} tabs have`;

  useEffect(() => {
    saveButtonRef.current?.focus();
  }, []);

  return (
    <div className="modal-backdrop">
      <section className="confirm-modal" role="dialog" aria-modal="true" aria-label="Close unsaved tabs">
        <header className="confirm-modal-title">
          <h2>Save Before Closing?</h2>
        </header>
        <div className="confirm-modal-body">
          <p>{tabLabel} unsaved changes. Save before closing, or close without saving.</p>
        </div>
        <footer className="confirm-modal-actions">
          <button className="button soft" onClick={onDiscard}>
            Don't Save
          </button>
          <button className="button primary" onClick={onSave} ref={saveButtonRef}>
            <Save size={16} />
            Save and Close
          </button>
        </footer>
      </section>
    </div>
  );
}
