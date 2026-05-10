import { useMemo, useState } from "react";
import { CalendarClock, Copy } from "lucide-react";

type CronFieldMode = "every" | "step" | "value" | "range";

const fieldLabels = [
  { key: "minute", label: "Minute", min: 0, max: 59 },
  { key: "hour", label: "Hour", min: 0, max: 23 },
  { key: "day", label: "Day", min: 1, max: 31 },
  { key: "month", label: "Month", min: 1, max: 12 },
  { key: "weekday", label: "Weekday", min: 0, max: 6 }
] as const;

type FieldKey = (typeof fieldLabels)[number]["key"];
type FieldState = Record<FieldKey, { mode: CronFieldMode; value: string; step: string; rangeStart: string; rangeEnd: string }>;

const initialFields: FieldState = {
  minute: { mode: "value", value: "0", step: "5", rangeStart: "0", rangeEnd: "30" },
  hour: { mode: "every", value: "9", step: "1", rangeStart: "9", rangeEnd: "18" },
  day: { mode: "every", value: "1", step: "1", rangeStart: "1", rangeEnd: "15" },
  month: { mode: "every", value: "1", step: "1", rangeStart: "1", rangeEnd: "12" },
  weekday: { mode: "every", value: "1", step: "1", rangeStart: "1", rangeEnd: "5" }
};

function cronPart(field: FieldState[FieldKey]) {
  if (field.mode === "every") {
    return "*";
  }
  if (field.mode === "step") {
    return `*/${field.step || 1}`;
  }
  if (field.mode === "range") {
    return `${field.rangeStart || 0}-${field.rangeEnd || 0}`;
  }
  return field.value || "0";
}

function describeCron(parts: string[]) {
  const [minute, hour, day, month, weekday] = parts;
  return `At minute ${minute}, hour ${hour}, day ${day}, month ${month}, weekday ${weekday}.`;
}

export function CronTool() {
  const [fields, setFields] = useState<FieldState>(initialFields);
  const parts = useMemo(() => fieldLabels.map((field) => cronPart(fields[field.key])), [fields]);
  const expression = parts.join(" ");

  const updateField = (key: FieldKey, patch: Partial<FieldState[FieldKey]>) => {
    setFields((current) => ({ ...current, [key]: { ...current[key], ...patch } }));
  };

  return (
    <div className="tool-panel cron-tool">
      <header>
        <CalendarClock size={22} />
        <h2>Cron Expression</h2>
        <div className="tool-header-actions">
          <button className="icon-button ghost" onClick={() => navigator.clipboard?.writeText(expression)} title="Copy cron">
            <Copy size={16} />
          </button>
        </div>
      </header>

      <div className="cron-builder">
        {fieldLabels.map((field) => (
          <div className="cron-field" key={field.key}>
            <label>{field.label}</label>
            <select value={fields[field.key].mode} onChange={(event) => updateField(field.key, { mode: event.target.value as CronFieldMode })}>
              <option value="every">Every</option>
              <option value="step">Every N</option>
              <option value="value">Specific</option>
              <option value="range">Range</option>
            </select>
            {fields[field.key].mode === "step" ? (
              <input
                type="number"
                min={1}
                max={field.max}
                value={fields[field.key].step}
                onChange={(event) => updateField(field.key, { step: event.target.value })}
              />
            ) : fields[field.key].mode === "range" ? (
              <div className="cron-range">
                <input
                  type="number"
                  min={field.min}
                  max={field.max}
                  value={fields[field.key].rangeStart}
                  onChange={(event) => updateField(field.key, { rangeStart: event.target.value })}
                />
                <input
                  type="number"
                  min={field.min}
                  max={field.max}
                  value={fields[field.key].rangeEnd}
                  onChange={(event) => updateField(field.key, { rangeEnd: event.target.value })}
                />
              </div>
            ) : (
              <input
                type="number"
                min={field.min}
                max={field.max}
                value={fields[field.key].value}
                disabled={fields[field.key].mode === "every"}
                onChange={(event) => updateField(field.key, { value: event.target.value })}
              />
            )}
          </div>
        ))}
      </div>

      <div className="cron-output">
        <code>{expression}</code>
        <span>{describeCron(parts)}</span>
      </div>
    </div>
  );
}
