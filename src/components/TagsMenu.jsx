// src/components/TagsMenu.jsx
import React, { useMemo, useState } from "react";

function buildSelectedSet(selected) {
  if (!selected) return new Set();
  if (selected instanceof Set) return selected;
  if (Array.isArray(selected)) return new Set(selected.filter(Boolean));
  return new Set([selected].filter(Boolean));
}

/**
 * Props esperadas:
 *  - tags: Array<{ slug: string; name: string; count: number }>
 *  - onPick?: (slug: string) => void
 *  - selected?: string | string[] | Set<string> | null
 */
export default function TagsMenu({ tags = [], onPick, selected = null }) {
  const [q, setQ] = useState("");

  const selectedSet = useMemo(() => buildSelectedSet(selected), [selected]);

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
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold">Mis etiquetas</h2>
          <span className="badge badge-outline">{tags.length}</span>
          <span className="badge badge-ghost">Total conv: {total}</span>
        </div>
        <div className="flex w-full gap-2 md:w-auto">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar etiqueta…"
            className="w-full md:w-64 input input-bordered"
          />
          {q && (
            <button className="btn btn-ghost" onClick={() => setQ("")}>
              Limpiar
            </button>
          )}
        </div>
      </div>

      {filtradas.length === 0 ? (
        <div className="alert alert-info">
          <span>No se encontraron etiquetas para “{q}”.</span>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {filtradas
            .slice()
            .sort((a, b) => (b?.count || 0) - (a?.count || 0))
            .map((tag) => {
              const active = selectedSet.has(tag.slug);
              return (
                <button
                  key={tag.slug}
                  onClick={() => onPick?.(tag.slug)}
                  className={[
                    "card w-full shadow-sm border transition-all text-sm",
                    active
                      ? "bg-primary/15 border-primary ring-1 ring-primary"
                      : "bg-base-200 hover:bg-base-300 border-base-300",
                  ].join(" ")}
                  aria-pressed={active}
                  title={active ? "Etiqueta aplicada a esta conversación" : "Aplicar etiqueta"}
                >
                  <div className="px-4 py-3 card-body">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 text-left">
                        <div className="font-medium leading-tight [text-wrap:balance] truncate">
                          {tag.name || tag.slug}
                        </div>
                        <div className="text-xs truncate opacity-70">{tag.slug}</div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {active && (
                          <span className="badge badge-primary badge-sm">Aplicada</span>
                        )}
                        <span
                          className={[
                            "badge badge-sm",
                            active ? "badge-outline border-primary text-primary" : "badge-neutral",
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
