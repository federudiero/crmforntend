// src/components/QuickRepliesBar.jsx
import React, { useEffect, useMemo, useState } from "react";
import { db } from "../firebase";
import { collection, getDocs, orderBy, query } from "firebase/firestore";

/**
 * Barra de respuestas rápidas (macros) para el ChatWindow.
 * - Muestra presets locales y, si existen, las macros guardadas en Firestore (colección: quickReplies).
 * - onPick(text) => callback para insertar el texto elegido.
 *
 * Props:
 * - onPick(text: string)
 * - compact?: boolean  (reduce el margen superior)
 */
export default function QuickRepliesBar({ onPick, compact = false }) {
  const [rows, setRows] = useState([]);

  const PRESETS = useMemo(
    () => [
      "¡Gracias por tu compra! 🧾",
      "¿Coordinamos envío? 🚚",
      "¿Te quedó alguna duda? 👇",
      "¿Te interesa ver más opciones?",
      "¡Listo! Cualquier cosa estoy acá ✨",
    ],
    []
  );

  useEffect(() => {
    (async () => {
      try {
        const q = query(collection(db, "quickReplies"), orderBy("ord", "asc"));
        const snap = await getDocs(q);
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setRows(list);
      } catch {
        // si falla, dejamos solo los presets locales
        setRows([]);
      }
    })();
  }, []);

  const items = useMemo(() => {
    const cloud = rows.map((r) => r.text).filter(Boolean);
    return [...PRESETS, ...cloud];
  }, [rows, PRESETS]);

  if (!items.length) return null;

  return (
    <div
      className={
        "flex gap-2 " +
        (compact ? "mt-2" : "mt-3") +
        " overflow-x-auto whitespace-nowrap pb-1"
      }
    >
      {items.map((t, i) => (
        <button
          key={i}
          type="button"
          className="text-black border rounded-full btn btn-xs bg-base-200 border-base-300 hover:bg-base-100"
          onClick={() => onPick?.(t)}
          title={t}
        >
          {t.length > 28 ? t.slice(0, 28) + "…" : t}
        </button>
      ))}
    </div>
  );
}
