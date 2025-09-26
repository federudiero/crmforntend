import React from "react";
import { useDestacadosChat } from "../hooks/useDestacadosChat";

function fmt(ts) {
  const d = ts?.seconds
    ? new Date(ts.seconds * 1000)
    : ts instanceof Date
    ? ts
    : typeof ts === "number"
    ? new Date(ts)
    : null;

  return d
    ? d.toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })
    : "—";
}

export default function ChatDestacadosPanel({ chatId }) {
  const { items, cargando, cargar, quitar } = useDestacadosChat(chatId);

  return (
    <div className="flex flex-col w-full h-full">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold">Destacados</h3>
        <button className="btn btn-xs" onClick={cargar}>Actualizar</button>
      </div>

      {cargando ? (
        <div className="text-sm opacity-60">Cargando…</div>
      ) : items.length === 0 ? (
        <div className="text-sm opacity-60">No tenés destacados en este chat.</div>
      ) : (
        <ul className="space-y-2 overflow-auto">
          {items.map((it) => (
            <li key={it.id} className="p-3 bg-base-200 rounded-xl">
              <div className="text-sm whitespace-pre-wrap">{it.preview}</div>
              <div className="flex items-center justify-between mt-1 text-xs opacity-60">
                <span>{fmt(it.createdAt)}</span>
                <button
                  className="btn btn-ghost btn-xs"
                  onClick={() => quitar(it.id)}
                  title="Quitar de destacados"
                >
                  Quitar
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
