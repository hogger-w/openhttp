import { useState } from "react";
import { Binary, Braces, CalendarClock, Clock, Link, ScanSearch, Wrench } from "lucide-react";
import type { ToolId } from "../../shared/appTypes";
import { Base64Tool } from "./components/Base64Tool";
import { CronTool } from "./components/CronTool";
import { JsonFormatTool } from "./components/JsonFormatTool";
import { RegexTool } from "./components/RegexTool";
import { UrlCodecTool } from "./components/UrlCodecTool";

const toolItems: Array<{ id: ToolId; label: string; icon: typeof Binary }> = [
  { id: "base64", label: "Base64", icon: Binary },
  { id: "json-format", label: "JSON Format", icon: Braces },
  { id: "cron", label: "Cron Expression", icon: CalendarClock },
  { id: "regex", label: "Regex Tester", icon: ScanSearch },
  { id: "url-codec", label: "URL Codec", icon: Link },
  { id: "timestamp", label: "Timestamp", icon: Clock }
];

export function ToolsPage({
  activeTool,
  onSelectTool,
  isSidebarHidden
}: {
  activeTool: ToolId;
  onSelectTool: (tool: ToolId) => void;
  isSidebarHidden: boolean;
}) {
  return (
    <main className="app-shell tools-shell">
      {!isSidebarHidden && (
        <aside className="sidebar tools-sidebar">
          <div className="tools-title">
            <Wrench size={17} />
            Tools
          </div>
          {toolItems.map((item) => {
            const Icon = item.icon;
            return (
              <button className={activeTool === item.id ? "tool-row active" : "tool-row"} onClick={() => onSelectTool(item.id)} key={item.id}>
                <Icon size={16} />
                {item.label}
              </button>
            );
          })}
        </aside>
      )}
      <section className="tools-workbench">
        {activeTool === "base64" && <Base64Tool />}
        {activeTool === "json-format" && <JsonFormatTool />}
        {activeTool === "cron" && <CronTool />}
        {activeTool === "regex" && <RegexTool />}
        {activeTool === "url-codec" && <UrlCodecTool />}
        {activeTool === "timestamp" && <TimestampTool />}
      </section>
    </main>
  );
}

function TimestampTool() {
  const [timestamp, setTimestamp] = useState(() => String(Date.now()));
  const numeric = Number(timestamp);
  const date = Number.isFinite(numeric) ? new Date(timestamp.length === 10 ? numeric * 1000 : numeric) : null;

  return (
    <div className="tool-panel timestamp-tool">
      <header>
        <Clock size={22} />
        <h2>Timestamp</h2>
      </header>
      <div className="content-type-row">
        <label>Timestamp</label>
        <input value={timestamp} onChange={(event) => setTimestamp(event.target.value)} />
        <button className="button" onClick={() => setTimestamp(String(Date.now()))}>
          Now
        </button>
      </div>
      <div className="timestamp-grid">
        <div>
          <span>Local</span>
          <strong>{date && !Number.isNaN(date.valueOf()) ? date.toLocaleString() : "Invalid"}</strong>
        </div>
        <div>
          <span>ISO</span>
          <strong>{date && !Number.isNaN(date.valueOf()) ? date.toISOString() : "Invalid"}</strong>
        </div>
        <div>
          <span>Seconds</span>
          <strong>{date && !Number.isNaN(date.valueOf()) ? Math.floor(date.getTime() / 1000) : "Invalid"}</strong>
        </div>
        <div>
          <span>Milliseconds</span>
          <strong>{date && !Number.isNaN(date.valueOf()) ? date.getTime() : "Invalid"}</strong>
        </div>
      </div>
    </div>
  );
}
