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
const normalizeColor = (c) => (ALLOWED.has(String(c)) ? String(c) : "neutral");

// Normaliza clave (sin acentos, minúsculas, espacios -> guiones)
const normalizeKey = (s = "") =>
  String(s)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "-")
    .toLowerCase()
    .trim();

// ✅ PRESET_MAP indexado por slug normalizado
const PRESET_MAP = new Map(
  PRESET_LABELS.map((l) => [normalizeKey(l.slug || l.name || ""), l])
);

function LabelChips({ labels, slugs, className = "" }) {
  let items = [];

  if (Array.isArray(labels) && labels.length) {
    // Caso: vienen objetos {name, slug, color}
    items = labels.map((l) => {
      const rawSlug =
        l.slug ||
        l.id ||
        normalizeKey(l.name || ""); // si no hay slug, lo derivamos del name
      const norm = normalizeKey(rawSlug);
      const preset = PRESET_MAP.get(norm);
      const color = normalizeColor(l.color || preset?.color || "neutral");
      return {
        // usamos el slug normalizado para claves internas
        slug: norm,
        // 👇 mostramos SIEMPRE el nombre "humano"
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
        // 👇 mostramos el nombre de preset si existe; si no, el texto original
        name: preset?.name || raw,
        color,
      };
    });
  }

  // ✅ Deduplicado visual por clave normalizada (evita “día-lunes” vs “dia-lunes”)
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
      {items.map((l) => (
        <span
          key={l.slug}
       className={`badge badge-outline text-xs ${COLOR_TO_BADGE[l.color]} text-base-content`}
          title={l.name}         // <- si no querés tooltip, eliminá esta prop
        >
          {l.name}               {/* <- SOLO el nombre visible */}
        </span>
      ))}
    </div>
  );
}

export default LabelChips;
