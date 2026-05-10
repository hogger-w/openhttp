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
  const tabLabel = dirtyCount === 1 ? "标签页" : `${dirtyCount} 个标签页`;

  useEffect(() => {
    saveButtonRef.current?.focus();
  }, []);

  return (
    <div className="modal-backdrop">
      <section className="confirm-modal" role="dialog" aria-modal="true" aria-label="关闭未保存的标签页">
        <header className="confirm-modal-title">
          <h2>关闭前保存？</h2>
        </header>
        <div className="confirm-modal-body">
          <p>{tabLabel}有未保存的修改。保存后关闭，或直接不保存关闭。</p>
        </div>
        <footer className="confirm-modal-actions">
          <button className="button soft" onClick={onDiscard}>
            不保存
          </button>
          <button className="button primary" onClick={onSave} ref={saveButtonRef}>
            <Save size={16} />
            保存并关闭
          </button>
        </footer>
      </section>
    </div>
  );
}
