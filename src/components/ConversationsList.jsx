// src/components/ConversationsList.jsx
import { useEffect, useMemo, useState } from "react";
import { db } from "../firebase";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  limit,
  doc,
  getDoc,
  updateDoc,
  runTransaction,
  arrayUnion,
  arrayRemove,
  deleteField,
} from "firebase/firestore";
import { useAuthState } from "../hooks/useAuthState.js";
import LabelChips from "./LabelChips";

/** Fecha corta para la columna izquierda */
function formatShort(ts) {
  const d = ts?.toDate ? ts.toDate() : ts ? new Date(ts) : null;
  return d ? d.toLocaleString() : "";
}

export default function ConversationsList({ activeId, onSelect }) {
  const { user } = useAuthState();
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("todos"); // todos | mios | fav | etiquetas
  const [selectedLabel, setSelectedLabel] = useState("__all__");

  // Suscripción a conversaciones (últimas 100 por actividad)
  useEffect(() => {
    const qRef = query(
      collection(db, "conversations"),
      orderBy("lastMessageAt", "desc"),
      limit(100)
    );

    const unsub = onSnapshot(
      qRef,
      async (snap) => {
        const rows = await Promise.all(
          snap.docs.map(async (d) => {
            let contact = null;
            try {
              const c = await getDoc(doc(db, "contacts", d.id));
              contact = c.exists() ? c.data() : null;
            } catch (e) {
              console.error(e);
            }
            return { id: d.id, ...d.data(), contact };
          })
        );
        setItems(rows);
      },
      (err) => console.error("onSnapshot(conversations) error:", err)
    );
    return () => unsub();
  }, []);

  // Helpers
  const isStarred = (c) =>
    Array.isArray(c.stars) && user?.uid ? c.stars.includes(user.uid) : false;

  // Acciones rápidas
  const toggleStar = async (c) => {
    if (!user?.uid) return;
    const ref = doc(db, "conversations", c.id);
    try {
      if (isStarred(c)) {
        await updateDoc(ref, { stars: arrayRemove(user.uid) });
      } else {
        await updateDoc(ref, { stars: arrayUnion(user.uid) });
      }
    } catch (e) {
      console.error("toggleStar error", e);
      alert("No se pudo actualizar favoritos.");
    }
  };

  const assignToMe = async (c) => {
    if (!user) return;
    const ref = doc(db, "conversations", c.id);
    try {
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error("La conversación no existe.");
        const cur = snap.data();
        const currentUid = cur.assignedToUid || null;
        if (currentUid && currentUid !== user.uid) {
          throw new Error("Esta conversación ya está asignada a otro agente.");
        }
        tx.update(ref, {
          assignedToUid: user.uid,
          assignedToName: user.displayName || user.email || "Agente",
        });
      });
    } catch (e) {
      console.error("assignToMe error", e);
      alert(e.message || "No se pudo asignar.");
    }
  };

  const unassign = async (c) => {
    const ref = doc(db, "conversations", c.id);
    try {
      await updateDoc(ref, {
        assignedToUid: deleteField(),
        assignedToName: deleteField(),
      });
    } catch (e) {
      console.error("unassign error", e);
      alert("No se pudo desasignar.");
    }
  };

  // Buscar por texto (nombre o número)
  const filteredByText = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((c) => {
      const name = String(c.contact?.name || "").toLowerCase();
      const id = String(c.id || "").toLowerCase();
      return name.includes(q) || id.includes(q);
    });
  }, [items, search]);

  // Filtros por pestaña (para lista normal)
  const filtered = useMemo(() => {
    const base = filteredByText;
    if (tab === "mios" && user?.uid) {
      return base.filter((c) => c.assignedToUid === user.uid);
    }
    if (tab === "fav" && user?.uid) {
      return base.filter(
        (c) => Array.isArray(c.stars) && c.stars.includes(user.uid)
      );
    }
    return base;
  }, [filteredByText, tab, user?.uid]);

  // =========================
  //   ETIQUETAS POR VENDEDOR
  // =========================
  // En la vista "Por etiqueta", construimos el índice SOLO
  // con conversaciones asignadas al usuario actual.
  const myForLabels = useMemo(() => {
    if (!user?.uid) return [];
    return filteredByText.filter((c) => c.assignedToUid === user.uid);
  }, [filteredByText, user?.uid]);

  // Índice por etiqueta (solo "mis" conversaciones)
  const labelsIndex = useMemo(() => {
    const map = new Map();
    const source = myForLabels; // <— clave del cambio
    for (const c of source) {
      const slugs =
        Array.isArray(c.labels) && c.labels.length ? c.labels : ["__none__"];
      for (const s of slugs) {
        if (!map.has(s)) map.set(s, []);
        map.get(s).push(c);
      }
    }
    // ordenar cada grupo por actividad
    for (const [, arr] of map) {
      arr.sort((a, b) => {
        const ta =
          a.lastMessageAt?.toMillis?.() ??
          (a.lastMessageAt ? +new Date(a.lastMessageAt) : 0);
        const tb =
          b.lastMessageAt?.toMillis?.() ??
          (b.lastMessageAt ? +new Date(b.lastMessageAt) : 0);
        return tb - ta;
      });
    }
    return map;
  }, [myForLabels]);

  const sortedGroups = useMemo(() => {
    const entries = Array.from(labelsIndex.entries());
    entries.sort((a, b) => {
      const diff = b[1].length - a[1].length;
      if (diff !== 0) return diff;
      const an = a[0] === "__none__" ? "zzz" : a[0];
      const bn = b[0] === "__none__" ? "zzz" : b[0];
      return an.localeCompare(bn);
    });
    return entries;
  }, [labelsIndex]);

  // Abrir sólo si no está tomada por otro
  const canOpen = (c) =>
    !c.assignedToUid || c.assignedToUid === user?.uid;

  const tryOpen = (c) => {
    if (canOpen(c)) onSelect?.(c.id);
  };

  return (
    <div className="flex flex-col min-h-0 border-r bg-base-100">
      {/* Header: tabs + búsqueda */}
      <div className="flex items-center gap-2 p-2">
        <div className="flex overflow-hidden border rounded">
          {[
            ["todos", "Todos"],
            ["mios", "Mis chats"],
            ["fav", "Favoritos"],
            ["etiquetas", "Por etiqueta"], // ← esta ahora es "mis etiquetas"
          ].map(([key, label]) => (
            <button
              key={key}
              className={
                "px-3 py-1 text-sm " +
                (tab === key
                  ? "bg-primary text-white"
                  : "bg-base-100 hover:bg-base-200")
              }
              onClick={() => setTab(key)}
              title={label}
            >
              {label}
            </button>
          ))}
        </div>

        <input
          className="flex-1 input input-sm input-bordered"
          placeholder="Buscar nombre o número…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Contenido */}
      <div className="flex-1 overflow-y-auto">
        {tab !== "etiquetas" ? (
          <>
            {filtered.map((c) => {
              const isActive = String(c.id) === String(activeId || "");
              const slugs = Array.isArray(c.labels) ? c.labels : [];
              const assignedToMe = user?.uid && c.assignedToUid === user?.uid;
              const lockedByOther = !!c.assignedToUid && !assignedToMe;
              const assigned =
                c.assignedToName ||
                (c.assignedToUid ? "Asignado" : "No asignado");

              return (
                <div
                  key={c.id}
                  className={
                    "border-t bg-base-100 px-3 py-2 " +
                    (isActive ? "bg-base-200 " : "hover:bg-base-200/60 ") +
                    (lockedByOther ? "opacity-60 cursor-not-allowed " : "")
                  }
                  role="button"
                  tabIndex={0}
                  onClick={() => tryOpen(c)}
                  onKeyDown={(e) => {
                    if ((e.key === "Enter" || e.key === " ") && canOpen(c))
                      onSelect?.(c.id);
                  }}
                  title={
                    lockedByOther
                      ? `Asignada a ${c.assignedToName || "otro agente"}`
                      : c.id
                  }
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-mono text-sm truncate">
                        {c.contact?.name || c.id}
                      </div>
                      <div className="text-[11px] text-gray-500">
                        {formatShort(c.lastMessageAt)}
                      </div>
                      <div className="mt-1">
                        <LabelChips slugs={slugs} />
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {assignedToMe ? (
                        <button
                          onClick={(e) => { e.stopPropagation(); unassign(c); }}
                          className="border-0 btn btn-xs"
                          style={{ backgroundColor: "var(--color-error, #ef4444)", color: "#fff" }}
                          title="Desasignarme"
                        >
                          Yo ✓
                        </button>
                      ) : c.assignedToUid ? (
                        <button
  className="cursor-not-allowed btn btn-xs"
  style={{
    backgroundColor: "var(--color-error, #ef4444)",
    borderColor: "var(--color-error, #ef4444)",
    color: "#fff",
  }}
  disabled
  onClick={(e) => e.stopPropagation()}
  title={`Asignada a ${c.assignedToName || "otro agente"}`}
>
  Ocupada
</button>

                      ) : (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            assignToMe(c);
                          }}
                          className="btn btn-xs btn-primary"
                          title="Asignarme esta conversación"
                        >
                          Asignarme
                        </button>
                      )}

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleStar(c);
                        }}
                        className={
                          "text-xl leading-none " +
                          (isStarred(c)
                            ? "text-yellow-500"
                            : "text-gray-400 hover:text-gray-600")
                        }
                        title={
                          isStarred(c)
                            ? "Quitar de favoritos"
                            : "Agregar a favoritos"
                        }
                      >
                        {isStarred(c) ? "★" : "☆"}
                      </button>
                    </div>
                  </div>

                  <div className="mt-1 text-[11px] text-gray-600">
                    {c.assignedToUid ? (
                      <span>
                        Asignado a{" "}
                        <b>
                          {c.assignedToUid === user?.uid
                            ? "mí"
                            : c.assignedToName || c.assignedToUid}
                        </b>
                      </span>
                    ) : (
                      <span className="italic text-gray-400">{assigned}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </>
        ) : (
          // ===== Vista por etiqueta (solo MIS etiquetas) =====
          <div className="flex min-h-0">
            {/* Sidebar */}
            <aside className="w-56 overflow-y-auto border-r shrink-0">
              <div className="p-2 border-b">
                <button
                  onClick={() => setSelectedLabel("__all__")}
                  className={
                    "w-full rounded px-2 py-1 text-left " +
                    (selectedLabel === "__all__"
                      ? "bg-primary text-white"
                      : "hover:bg-base-200")
                  }
                  title="Ver todas (mis etiquetas agrupadas)"
                >
                  Mis etiquetas
                </button>
              </div>

              <ul className="p-2 space-y-1">
                {sortedGroups.map(([slug, arr]) => {
                  const isNone = slug === "__none__";
                  return (
                    <li key={slug}>
                      <button
                        onClick={() => setSelectedLabel(slug)}
                        className={
                          "flex w-full items-center justify-between gap-2 rounded px-2 py-1 " +
                          (selectedLabel === slug
                            ? "bg-primary text-white"
                            : "hover:bg-base-200")
                        }
                        title={isNone ? "Sin etiqueta" : slug}
                      >
                        <span className="flex items-center gap-2 truncate">
                          {isNone ? (
                            <span className="text-xs badge badge-neutral">
                              Sin etiqueta
                            </span>
                          ) : (
                            <LabelChips slugs={[slug]} />
                          )}
                        </span>
                        <span className="text-xs opacity-70">
                          {arr.length}
                        </span>
                      </button>
                    </li>
                  );
                })}
                {sortedGroups.length === 0 && (
                  <li className="px-2 text-sm text-gray-500">
                    (No tenés conversaciones asignadas)
                  </li>
                )}
              </ul>
            </aside>

            {/* Contenido derecha */}
            <section className="flex-1 overflow-y-auto">
              {selectedLabel === "__all__" ? (
                <div className="divide-y">
                  {sortedGroups.map(([slug, arr]) => {
                    const isNone = slug === "__none__";
                    return (
                      <details key={slug} className="group">
                        <summary className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-base-200">
                          <div className="flex items-center gap-2">
                            {isNone ? (
                              <span className="text-xs badge badge-neutral">
                                Sin etiqueta
                              </span>
                            ) : (
                              <LabelChips slugs={[slug]} />
                            )}
                          </div>
                          <span className="text-xs text-gray-500">
                            {arr.length}
                          </span>
                        </summary>
                        <div className="p-2 space-y-1">
                          {arr.map((c) => {
                            const isActive =
                              String(c.id) === String(activeId || "");
                            const slugs = Array.isArray(c.labels)
                              ? c.labels
                              : [];
                            const assignedToMe =
                              user?.uid && c.assignedToUid === user?.uid;
                            const lockedByOther =
                              !!c.assignedToUid && !assignedToMe;
                            const assigned =
                              c.assignedToName ||
                              (c.assignedToUid ? "Asignado" : "No asignado");
                            return (
                              <div
                                key={c.id}
                                className={
                                  "rounded border bg-base-100 px-3 py-2 " +
                                  (isActive ? "bg-base-200 " : "hover:bg-base-200/60 ") +
                                  (lockedByOther
                                    ? "opacity-60 cursor-not-allowed "
                                    : "")
                                }
                                role="button"
                                tabIndex={0}
                                onClick={() => tryOpen(c)}
                                onKeyDown={(e) => {
                                  if (
                                    (e.key === "Enter" || e.key === " ") &&
                                    canOpen(c)
                                  )
                                    onSelect?.(c.id);
                                }}
                                title={
                                  lockedByOther
                                    ? `Asignada a ${
                                        c.assignedToName || "otro agente"
                                      }`
                                    : c.id
                                }
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <div className="min-w-0">
                                    <div className="font-mono text-sm truncate">
                                      {c.contact?.name || c.id}
                                    </div>
                                    <div className="text-[11px] text-gray-500">
                                      {formatShort(c.lastMessageAt)}
                                    </div>
                                    <div className="mt-1">
                                      <LabelChips slugs={slugs} />
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2 shrink-0">
                                    {assignedToMe ? (
                                      <button
                                        onClick={(e) => { e.stopPropagation(); unassign(c); }}
                                        className="border-0 btn btn-xs"
                                        style={{ backgroundColor: "var(--color-error, #ef4444)", color: "#fff" }}
                                        title="Desasignarme"
                                      >
                                        Yo ✓
                                      </button>
                                    ) : c.assignedToUid ? (
                                      <button
                                        className="btn btn-xs btn-disabled"
                                        disabled
                                        onClick={(e) => e.stopPropagation()}
                                        title={`Asignada a ${
                                          c.assignedToName || "otro agente"
                                        }`}
                                      >
                                        Ocupada
                                      </button>
                                    ) : (
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          assignToMe(c);
                                        }}
                                        className="btn btn-xs btn-primary"
                                        title="Asignarme esta conversación"
                                      >
                                        Asignarme
                                      </button>
                                    )}
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        toggleStar(c);
                                      }}
                                      className={
                                        "text-xl leading-none " +
                                        (isStarred(c)
                                          ? "text-yellow-500"
                                          : "text-gray-400 hover:text-gray-600")
                                      }
                                      title={
                                        isStarred(c)
                                          ? "Quitar de favoritos"
                                          : "Agregar a favoritos"
                                      }
                                    >
                                      {isStarred(c) ? "★" : "☆"}
                                    </button>
                                  </div>
                                </div>
                                <div className="mt-1 text-[11px] text-gray-600">
                                  {c.assignedToUid ? (
                                    <span>
                                      Asignado a{" "}
                                      <b>
                                        {c.assignedToUid === user?.uid
                                          ? "mí"
                                          : c.assignedToName ||
                                            c.assignedToUid}
                                      </b>
                                    </span>
                                  ) : (
                                    <span className="italic text-gray-400">
                                      {assigned}
                                    </span>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </details>
                    );
                  })}
                </div>
              ) : (
                <div className="p-2 space-y-2">
                  {(labelsIndex.get(selectedLabel) || []).map((c) => {
                    const isActive = String(c.id) === String(activeId || "");
                    const slugs = Array.isArray(c.labels) ? c.labels : [];
                    const assignedToMe =
                      user?.uid && c.assignedToUid === user?.uid;
                    const lockedByOther =
                      !!c.assignedToUid && !assignedToMe;
                    const assigned =
                      c.assignedToName ||
                      (c.assignedToUid ? "Asignado" : "No asignado");
                    return (
                      <div
                        key={c.id}
                        className={
                          "rounded border bg-base-100 px-3 py-2 " +
                          (isActive ? "bg-base-200 " : "hover:bg-base-200/60 ") +
                          (lockedByOther ? "opacity-60 cursor-not-allowed " : "")
                        }
                        role="button"
                        tabIndex={0}
                        onClick={() => tryOpen(c)}
                        onKeyDown={(e) => {
                          if ((e.key === "Enter" || e.key === " ") && canOpen(c))
                            onSelect?.(c.id);
                        }}
                        title={
                          lockedByOther
                            ? `Asignada a ${c.assignedToName || "otro agente"}`
                            : c.id
                        }
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="font-mono text-sm truncate">
                              {c.contact?.name || c.id}
                            </div>
                            <div className="text-[11px] text-gray-500">
                              {formatShort(c.lastMessageAt)}
                            </div>
                            <div className="mt-1">
                              <LabelChips slugs={slugs} />
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {assignedToMe ? (
                              <button
                                onClick={(e) => { e.stopPropagation(); unassign(c); }}
                                className="border-0 btn btn-xs"
                                style={{ backgroundColor: "var(--color-error, #ef4444)", color: "#fff" }}
                                title="Desasignarme"
                              >
                                Yo ✓
                              </button>
                            ) : c.assignedToUid ? (
                              <button
                                className="btn btn-xs btn-disabled"
                                disabled
                                onClick={(e) => e.stopPropagation()}
                                title={`Asignada a ${
                                  c.assignedToName || "otro agente"
                                }`}
                              >
                                Ocupada
                              </button>
                            ) : (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  assignToMe(c);
                                }}
                                className="btn btn-xs btn-primary"
                                title="Asignarme esta conversación"
                              >
                                Asignarme
                              </button>
                            )}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleStar(c);
                              }}
                              className={
                                "text-xl leading-none " +
                                (isStarred(c)
                                  ? "text-yellow-500"
                                  : "text-gray-400 hover:text-gray-600")
                              }
                              title={
                                isStarred(c)
                                  ? "Quitar de favoritos"
                                  : "Agregar a favoritos"
                              }
                            >
                              {isStarred(c) ? "★" : "☆"}
                            </button>
                          </div>
                        </div>
                        <div className="mt-1 text-[11px] text-gray-600">
                          {c.assignedToUid ? (
                            <span>
                              Asignado a{" "}
                              <b>
                                {c.assignedToUid === user?.uid
                                  ? "mí"
                                  : c.assignedToName || c.assignedToUid}
                              </b>
                            </span>
                          ) : (
                            <span className="italic text-gray-400">{assigned}</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
