import { Info, Settings, ShieldCheck, X } from "lucide-react";
import type { SettingsSection } from "../../shared/appTypes";

export function SettingsModal({
  activeSection,
  isDark,
  verifySsl,
  onClose,
  onSelectSection,
  onToggleDark,
  onToggleVerifySsl
}: {
  activeSection: SettingsSection;
  isDark: boolean;
  verifySsl: boolean;
  onClose: () => void;
  onSelectSection: (section: SettingsSection) => void;
  onToggleDark: (value: boolean) => void;
  onToggleVerifySsl: (value: boolean) => void;
}) {
  return (
    <div className="modal-backdrop">
      <section className="settings-modal" role="dialog" aria-modal="true" aria-label="Settings">
        <header className="settings-modal-title">
          <div>
            <h2>Setting</h2>
            <span>OpenHTTP preferences</span>
          </div>
          <button className="icon-button ghost" onClick={onClose} title="Close">
            <X size={17} />
          </button>
        </header>

        <div className="settings-modal-body">
          <aside className="settings-sidebar">
            <button className={activeSection === "settings" ? "active" : ""} onClick={() => onSelectSection("settings")}>
              <Settings size={16} />
              Setting
            </button>
            <button className={activeSection === "about" ? "active" : ""} onClick={() => onSelectSection("about")}>
              <Info size={16} />
              About
            </button>
          </aside>

          <div className="settings-content">
            {activeSection === "settings" ? (
              <>
                <div className="setting-row">
                  <div>
                    <strong>SSL Certificate Verification</strong>
                    <span>Validate HTTPS certificates when sending requests.</span>
                  </div>
                  <label className="inline-switch">
                    <input type="checkbox" checked={verifySsl} onChange={(event) => onToggleVerifySsl(event.target.checked)} />
                    <span />
                  </label>
                </div>
                <div className="setting-row">
                  <div>
                    <strong>Dark Mode</strong>
                    <span>Switch the application theme.</span>
                  </div>
                  <label className="inline-switch">
                    <input type="checkbox" checked={isDark} onChange={(event) => onToggleDark(event.target.checked)} />
                    <span />
                  </label>
                </div>
              </>
            ) : (
              <div className="about-panel">
                <ShieldCheck size={34} />
                <h3>OpenHTTP</h3>
                <p>
                  OpenHTTP is a local-first HTTP and WebSocket testing client. Collections, requests, and environment files
                  stay in your selected folder so they are easy to inspect, version, and move.
                </p>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
