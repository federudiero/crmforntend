// src/components/TagsMenu.jsx
import React, { useEffect, useMemo, useState } from "react";
import { listLabels, addLabelToConversation } from "../lib/labels";

export default function TagsMenu({ conversationId, currentSlugs = [], onChanged }) {
  const [all, setAll] = useState([]);
  const [selected, setSelected] = useState("");

  useEffect(() => {
    (async () => setAll(await listLabels()))();
  }, []);

  const options = useMemo(
    () => all.filter((l) => !currentSlugs.includes(l.slug)),
    [all, currentSlugs]
  );

  const add = async () => {
    if (!selected || !conversationId) return;
    await addLabelToConversation(conversationId, selected);
    setSelected("");
    onChanged?.();
  };

  return (
    <div className="flex items-center gap-2">
      <select
        className="select select-sm select-bordered"
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
      >
        <option value="">+ agregar etiqueta…</option>
        {options.map((l) => (
          <option key={l.slug} value={l.slug}>
            {l.name}
          </option>
        ))}
      </select>

      <button className="btn btn-sm" onClick={add} disabled={!selected}>
        Agregar
      </button>
    </div>
  );
}
