// src/components/TagsMenu.jsx
import React, { useMemo, useState } from "react";

/**
 * Props esperadas:
 *  - tags: Array<{ slug: string; name: string; count: number }>
 *  - onPick?: (slug: string) => void  // callback al hacer click
 *  - selected?: string | null         // slug seleccionado (opcional)
 */
export default function TagsMenu({ tags = [], onPick, selected = null }) {
  const [q, setQ] = useState("");

  const filtradas = useMemo(() => {
    const t = (q || "").trim().toLowerCase();
    if (!t) return tags;
    return tags.filter(
      (x) =>
        (x?.name || "").toLowerCase().includes(t) ||
        (x?.slug || "").toLowerCase().includes(t)
    );
  }, [tags, q]);

  const total = tags.reduce((acc, t) => acc + (t?.count || 0), 0);

  return (
    <div className="flex flex-col gap-4">
      {/* Header + buscador */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex gap-2 items-center">
          <h2 className="text-lg font-semibold">Mis etiquetas</h2>
          <span className="badge badge-outline">{tags.length}</span>
          <span className="badge badge-ghost">Total conv: {total}</span>
        </div>
       <div className="flex gap-2 w-full md:w-auto">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar etiqueta…"
            className="w-64 input input-bordered"
          />
          {q && (
            <button className="btn btn-ghost" onClick={() => setQ("")}>
              Limpiar
            </button>
          )}
        </div>
      </div>

      {/* Grid de etiquetas */}
      {filtradas.length === 0 ? (
        <div className="alert alert-info">
          <span>No se encontraron etiquetas para “{q}”.</span>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {filtradas
            // opcional: orden por cantidad desc
            .slice()
            .sort((a, b) => (b?.count || 0) - (a?.count || 0))
            .map((tag) => {
              const active = selected === tag.slug;
              return (
                <button
                  key={tag.slug}
                  onClick={() => onPick?.(tag.slug)}
                   className={["card w-full shadow-sm border transition-colors text-sm",
                    active
                      ? "bg-primary text-primary-content border-primary"
                      : "bg-base-200 hover:bg-base-300 border-base-300",
                  ].join(" ")}
                >
                  <div className="px-4 py-3 card-body">
                    <div className="flex gap-3 justify-between items-center">
                      <div className="text-left">
                        <div className="font-medium leading-tight [text-wrap:balance]">
                          {tag.name || tag.slug}
                        </div>
                        <div className="text-xs opacity-70">{tag.slug}</div>
                      </div>
                      <div className="flex gap-2 items-center">
                        <span
                          className={[
                            "badge",
                            active ? "badge-outline" : "badge-neutral",
                          ].join(" ")}
                          title="Conversaciones con esta etiqueta"
                        >
                          {tag.count ?? 0}
                        </span>
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
        </div>
      )}
    </div>
  );
}
