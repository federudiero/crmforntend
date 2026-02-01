// src/components/LabelChips.jsx
import React from "react";
import { PRESET_LABELS } from "../lib/labels";

// DaisyUI badge classes por color
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

const ALLOWED = new Set(Object.keys(COLOR_TO_BADGE));
const isHexColor = (c) => /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(String(c || "").trim());

const normalizeColor = (c) => {
  const s = String(c || "").trim();
  if (ALLOWED.has(s)) return s;      // DaisyUI
  if (isHexColor(s)) return s;       // HEX custom
  return "neutral";
};

// Normaliza clave (sin acentos, minúsculas, espacios -> guiones)
const normalizeKey = (s = "") =>
  String(s)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "-")
    .toLowerCase()
    .trim();

// ✅ PRESET_MAP indexado por slug normalizado
const PRESET_MAP = new Map(PRESET_LABELS.map((l) => [normalizeKey(l.slug || l.name || ""), l]));

function hexToRgb(hex) {
  const h = String(hex || "").trim();
  if (!isHexColor(h)) return null;
  let x = h.slice(1);
  if (x.length === 3) x = x.split("").map((ch) => ch + ch).join("");
  const r = parseInt(x.slice(0, 2), 16);
  const g = parseInt(x.slice(2, 4), 16);
  const b = parseInt(x.slice(4, 6), 16);
  return { r, g, b };
}

function hexToRgba(hex, a = 0.14) {
  const rgb = hexToRgb(hex);
  if (!rgb) return undefined;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${a})`;
}

function LabelChips({ labels, slugs, className = "" }) {
  let items = [];

  if (Array.isArray(labels) && labels.length) {
    // Caso: vienen objetos {name, slug, color}
    items = labels.map((l) => {
      const rawSlug = l.slug || l.id || normalizeKey(l.name || "");
      const norm = normalizeKey(rawSlug);
      const preset = PRESET_MAP.get(norm);
      const color = normalizeColor(l.color || preset?.color || "neutral");
      return {
        slug: norm,
        name: l.name || preset?.name || rawSlug,
        color,
      };
    });
  } else if (Array.isArray(slugs) && slugs.length) {
    // Caso: vienen slugs (strings)
    items = slugs.map((s) => {
      const raw = String(s);
      const norm = normalizeKey(raw);
      const preset = PRESET_MAP.get(norm);
      const color = normalizeColor(preset?.color || "neutral");
      return {
        slug: norm,
        name: preset?.name || raw,
        color,
      };
    });
  }

  // Deduplicado
  if (items.length) {
    const seen = new Set();
    items = items.filter((l) => {
      const key = l.slug || normalizeKey(l.name || "");
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  if (!items.length) return null;

  return (
    <div className={`flex flex-wrap gap-1 ${className}`}>
      {items.map((l) => {
        const isDaisy = ALLOWED.has(l.color);
        const isHex = isHexColor(l.color);

        const cls = `badge badge-outline text-xs whitespace-nowrap ${isDaisy ? COLOR_TO_BADGE[l.color] : ""
          }`;

        const style = isHex
          ? {
            borderColor: l.color,
            backgroundColor: hexToRgba(l.color, 0.14),
            color: l.color,
          }
          : undefined;

        return (
          <span key={l.slug} className={cls} style={style} title={l.name}>
            {l.name}
          </span>
        );
      })}
    </div>
  );
}

export default LabelChips;
