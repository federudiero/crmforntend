// src/components/StagePicker.jsx
import React, { useMemo } from "react";
import { db } from "../firebase";
import { doc, updateDoc } from "firebase/firestore";

/**
 * Selector de etapa (pipeline) de una conversación.
 * Usa el campo `stage` en `conversations/{id}`: "nuevo" | "en-curso" | "cerrado" | "perdido"
 */
export default function StagePicker({ conversationId, value }) {
  const options = useMemo(() => ([
    { value: "nuevo",     label: "Nuevo" },
    { value: "en-curso",  label: "En curso" },
    { value: "cerrado",   label: "Cerrado" },
    { value: "perdido",   label: "Perdido" },
  ]), []);

  const onChange = async (e) => {
    const stage = e.target.value;
    if (!conversationId) return;
    try {
      await updateDoc(doc(db, "conversations", String(conversationId)), { stage });
    } catch (e) {
      console.error(e);
      alert("No se pudo actualizar la etapa.");
    }
  };

  return (
    <select className="w-full max-w-xs select select-sm" value={value || ""} onChange={onChange}>
      <option value="">(sin etapa)</option>
      {options.map(op => (
        <option key={op.value} value={op.value}>{op.label}</option>
      ))}
    </select>
  );
}
