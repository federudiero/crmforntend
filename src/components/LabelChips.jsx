import React from "react";
import { PRESET_LABELS } from "../lib/labels";

const PRESET_MAP = new Map(PRESET_LABELS.map((l) => [l.slug, l]));

// Mapa → clases DaisyUI
const COLOR_TO_BADGE = {
  primary: "badge-primary",
  secondary: "badge-secondary",
  accent: "badge-accent",
  info: "badge-info",
  success: "badge-success",
  warning: "badge-warning",
  error: "badge-error",
  neutral: "badge-neutral",
};

// Whitelist: si no coincide, va "neutral"
const ALLOWED = new Set(Object.keys(COLOR_TO_BADGE));
const normalizeColor = (c) => (ALLOWED.has(String(c)) ? String(c) : "neutral");

export default function LabelChips({ labels, slugs, className = "" }) {
  let items = [];

  if (Array.isArray(labels) && labels.length) {
    items = labels.map((l) => {
      const slug = l.slug || l.id || String(l.name || "").toLowerCase();
      const preset = PRESET_MAP.get(slug);
      const color = normalizeColor(l.color || preset?.color || "neutral");
      return {
        slug,
        name: l.name || preset?.name || slug,
        color,
      };
    });
  } else if (Array.isArray(slugs) && slugs.length) {
    items = slugs.map((s) => {
      const slug = String(s);
      const preset = PRESET_MAP.get(slug);
      const color = normalizeColor(preset?.color || "neutral");
      return {
        slug,
        name: preset?.name || slug,
        color,
      };
    });
  }

  if (!items.length) return null;

  return (
    <div className={`flex flex-wrap gap-1 ${className}`}>
      {items.map((l) => (
        <span
          key={l.slug}
          className={`badge text-xs ${COLOR_TO_BADGE[l.color]}`}
          title={l.slug}
        >
          {l.name}
        </span>
      ))}
    </div>
  );
}
