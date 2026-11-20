"use client";

import { useEffect, useRef, useState } from "react";
import { KeyRound } from "lucide-react";
import type { Vendor } from "@/lib/domain/catalog";

/** The user's own API keys (bring your own keys), kept in this tab (sessionStorage) and sent with each turn. */
export interface UserKeys {
  anthropic?: string;
  openai?: string;
}

const STORAGE = "dyon-keys";
const FIELDS: { vendor: Vendor; field: keyof UserKeys; label: string; placeholder: string; url: string }[] = [
  {
    vendor: "claude",
    field: "anthropic",
    label: "Anthropic API key",
    placeholder: "sk-ant-…",
    url: "https://console.anthropic.com/settings/keys",
  },
  {
    vendor: "codex",
    field: "openai",
    label: "OpenAI API key",
    placeholder: "sk-…",
    url: "https://platform.openai.com/api-keys",
  },
];

export function loadKeys(): UserKeys {
  try {
    return JSON.parse(sessionStorage.getItem(STORAGE) ?? "{}") as UserKeys;
  } catch {
    return {};
  }
}

function saveKeys(keys: UserKeys) {
  try {
    sessionStorage.setItem(STORAGE, JSON.stringify(keys));
  } catch {
    // private window or blocked storage: the keys still work for this page
  }
}

/** Vendors that need the user's key: used by a competitor and not provided by this server (local development). */
export function useKeyRequirements(vendors: Vendor[]) {
  const [serverKeys, setServerKeys] = useState<Vendor[] | null>(null);
  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((c: { serverKeys: Vendor[] }) => setServerKeys(c.serverKeys))
      .catch(() => setServerKeys([]));
  }, []);
  return [...new Set(vendors)].filter((v) => serverKeys !== null && !serverKeys.includes(v));
}

export function KeysButton({
  keys,
  onChange,
  required,
  open: forcedOpen,
}: {
  keys: UserKeys;
  onChange: (keys: UserKeys) => void;
  required: Vendor[];
  open?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const missing = FIELDS.filter((f) => required.includes(f.vendor) && !keys[f.field]);

  useEffect(() => {
    if (forcedOpen) setOpen(true);
  }, [forcedOpen]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const update = (field: keyof UserKeys, value: string) => {
    const next = { ...keys, [field]: value.trim() || undefined };
    saveKeys(next);
    onChange(next);
  };

  return (
    <div className="keys" ref={ref}>
      <button
        className={`chip ${missing.length ? "warn-chip" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title="Your own API keys: the agents run on your accounts"
      >
        <KeyRound size={13} /> Keys{missing.length ? ` (${missing.length} missing)` : ""}
      </button>
      {open && (
        <div className="popover keys-popover" role="dialog" aria-label="Your API keys">
          <p className="keys-intro">
            The agents run on your own accounts. Your keys stay in this tab and are forgotten when you close it. They
            are sent with each turn; the server keeps them encrypted only until a worker starts the turn, then deletes
            them.
          </p>
          {FIELDS.map((f) => (
            <label key={f.field} className="keys-field">
              <span>
                {f.label}
                {required.includes(f.vendor) ? "" : " (optional: this server has one)"}
                <a href={f.url} target="_blank" rel="noreferrer">
                  Get one
                </a>
              </span>
              <input
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder={f.placeholder}
                value={keys[f.field] ?? ""}
                onChange={(e) => update(f.field, e.target.value)}
              />
            </label>
          ))}
          <button className="text-button" onClick={() => (saveKeys({}), onChange({}))}>
            Forget my keys
          </button>
        </div>
      )}
    </div>
  );
}
