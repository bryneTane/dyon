"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Plus, Trash2 } from "lucide-react";
import {
  findModel,
  MAX_COMPETITORS,
  settingsLabel,
  VENDOR_LABELS,
  VENDORS,
  type Catalog,
  type CompetitorSpec,
} from "@/lib/domain/catalog";

/**
 * One editable chip per competitor; a popover sets agent, model and effort. Models and their efforts are the ones
 * each agent reports (the catalog), so only settings the agent accepts can be picked.
 */
export function CompetitorPicker({
  catalog,
  value,
  onChange,
}: {
  catalog: Catalog;
  value: CompetitorSpec[];
  onChange: (next: CompetitorSpec[]) => void;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open === null) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(null);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const update = (i: number, patch: Partial<CompetitorSpec>) =>
    onChange(value.map((spec, j) => (j === i ? { ...spec, ...patch } : spec)));

  const add = () => {
    // Suggest the vendor least represented, with its default model.
    const vendor = VENDORS.find((v) => !value.some((s) => s.vendor === v) && catalog[v].models.length) ?? "claude";
    const models = catalog[vendor].models;
    if (!models.length) return;
    const used = new Set(value.filter((s) => s.vendor === vendor).map((s) => s.model));
    const model = models.find((m) => !used.has(m.id))?.id ?? models[0].id;
    onChange([...value, { vendor, model, effort: null }]);
    setOpen(value.length);
  };

  return (
    <div className="picker" ref={ref}>
      {value.map((spec, i) => (
        <div key={i} className="picker-item">
          <button
            className={`chip slot-${i} on`}
            onClick={() => setOpen(open === i ? null : i)}
            aria-expanded={open === i}
            title="Change vendor, model or effort"
          >
            <span className="dot" />
            <span>{VENDOR_LABELS[spec.vendor]}</span>
            <span className="chip-sub">{settingsLabel(spec, catalog)}</span>
            <ChevronDown size={12} className="muted" />
          </button>
          {open === i && (
            <div className="popover" role="dialog" aria-label={`Competitor ${i + 1}`}>
              <div className="field">
                <span className="field-label">Agent</span>
                <div className="segmented">
                  {VENDORS.map((v) => (
                    <button
                      key={v}
                      className={spec.vendor === v ? "on" : ""}
                      disabled={!catalog[v].models.length}
                      title={catalog[v].error}
                      onClick={() =>
                        spec.vendor !== v && update(i, { vendor: v, model: catalog[v].models[0].id, effort: null })
                      }
                    >
                      {VENDOR_LABELS[v]}
                    </button>
                  ))}
                </div>
              </div>
              <div className="field">
                <span className="field-label">Model</span>
                <div className="options">
                  {catalog[spec.vendor].models.map((m) => (
                    <button
                      key={m.id}
                      className={`option ${spec.model === m.id ? "on" : ""}`}
                      // Keep the effort only if the new model accepts it.
                      onClick={() =>
                        update(i, {
                          model: m.id,
                          effort: spec.effort && m.efforts.includes(spec.effort) ? spec.effort : null,
                        })
                      }
                    >
                      <span>{m.label}</span>
                      <code className="muted small">{m.id}</code>
                    </button>
                  ))}
                </div>
              </div>
              <div className="field">
                <span className="field-label">Reasoning effort</span>
                <div className="segmented">
                  <button
                    className={spec.effort === null ? "on" : ""}
                    onClick={() => update(i, { effort: null })}
                    title="The agent's own default"
                  >
                    Default
                  </button>
                  {(findModel(catalog, spec.vendor, spec.model)?.efforts ?? []).map((e) => (
                    <button key={e} className={spec.effort === e ? "on" : ""} onClick={() => update(i, { effort: e })}>
                      {e}
                    </button>
                  ))}
                </div>
              </div>
              {value.length > 1 && (
                <button
                  className="text-button danger"
                  onClick={() => {
                    onChange(value.filter((_, j) => j !== i));
                    setOpen(null);
                  }}
                >
                  <Trash2 size={13} /> Remove
                </button>
              )}
            </div>
          )}
        </div>
      ))}
      {value.length < MAX_COMPETITORS && (
        <button className="chip add" onClick={add} title="Add a competitor (up to 3)">
          <Plus size={13} />
        </button>
      )}
    </div>
  );
}
