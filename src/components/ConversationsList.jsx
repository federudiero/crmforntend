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

/** Normaliza slugs para usar como clave del índice */
const normSlug = (s) => String(s ?? "").trim().toLowerCase();

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

  const isAdmin =
    !!user?.email &&
    ["federudiero@gmail.com", "fede_rudiero@gmail.com"].includes(user.email);

  const canDelete = (c) => {
    if (!user?.uid) return false;
    if (isAdmin) return true;
    return c.assignedToUid === user.uid; // solo el dueño asignado
  };

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

  const softDelete = async (c) => {
    if (!canDelete(c)) return;
    const ref = doc(db, "conversations", c.id);
    const who = user?.displayName || user?.email || "Agente";
    if (
      !window.confirm(
        `¿Eliminar esta conversación?\n\nCliente: ${
          c.contact?.name || c.id
        }\n\nNo se borran los mensajes del servidor, solo se ocultará de tu lista.`
      )
    ) {
      return;
    }
    try {
      await updateDoc(ref, {
        deletedAt: new Date().toISOString(),
        deletedByUid: user?.uid || "",
        deletedByName: who,
      });
    } catch (e) {
      console.error("softDelete error", e);
      alert("No se pudo eliminar.");
    }
  };

  // Buscar por texto (nombre o número) + excluir eliminados
  const filteredByText = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = items.filter((c) => !c.deletedAt); // ocultar eliminados
    if (!q) return base;
    return base.filter((c) => {
      const name = String(c.contact?.name || "").toLowerCase();
      const id = String(c.id || "").toLowerCase();
      return name.includes(q) || id.includes(q);
    });
  }, [items, search]);

  // Filtros por pestaña (lista normal)
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
  //   ETIQUETAS (MIS CHATS)
  // =========================
  const myForLabels = useMemo(() => {
    if (!user?.uid) return [];
    return filteredByText.filter((c) => c.assignedToUid === user.uid);
  }, [filteredByText, user?.uid]);

  /** Índice por etiqueta (clave normalizada), manteniendo nombre original */
  const labelsIndex = useMemo(() => {
    const map = new Map(); // key: normSlug -> { display, items: [] }
    for (const c of myForLabels) {
      const slugs =
        Array.isArray(c.labels) && c.labels.length ? c.labels : ["__none__"];
      for (const s of slugs) {
        const key = s === "__none__" ? "__none__" : normSlug(s);
        const display = s === "__none__" ? "__none__" : String(s);
        if (!map.has(key)) map.set(key, { display, items: [] });
        map.get(key).items.push(c);
      }
    }
    // ordenar cada grupo por actividad
    for (const entry of map.values()) {
      entry.items.sort((a, b) => {
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
    const entries = Array.from(labelsIndex.entries()).map(([key, val]) => ({
      key,
      display: val.display,
      items: val.items,
    }));
    entries.sort((a, b) => {
      const diff = b.items.length - a.items.length;
      if (diff !== 0) return diff;
      const an = a.display === "__none__" ? "zzz" : a.display;
      const bn = b.display === "__none__" ? "zzz" : b.display;
      return an.localeCompare(bn);
    });
    return entries;
  }, [labelsIndex]);

  const canOpen = (c) =>
    !c.assignedToUid || c.assignedToUid === user?.uid;

  const tryOpen = (c) => {
    if (canOpen(c)) onSelect?.(c.id);
  };

  // clave seleccionada normalizada
  const selectedKey =
    selectedLabel === "__all__" ? "__all__" : normSlug(selectedLabel);
  const selectedGroup =
    selectedKey === "__all__" ? null : labelsIndex.get(selectedKey);

  return (
    <div className="flex flex-col min-h-0 h-full border-r bg-[#F6FBF7] border-[#CDEBD6]">
      {/* Header: tabs + búsqueda (sticky en mobile) */}
      <div className="sticky top-0 z-10 flex items-center gap-2 p-2 border-b bg-[#E8F5E9] border-[#CDEBD6]">
        <div className="flex overflow-x-auto max-w-full border rounded bg-white/70 border-[#CDEBD6]">
          {[
            ["todos", "Todos"],
            ["mios", "Mis chats"],
            ["fav", "Favoritos"],
            ["etiquetas", "Por etiqueta"],
          ].map(([key, label]) => (
            <button
              key={key}
              className={
                "px-3 py-2 text-sm whitespace-nowrap transition-colors " +
                (tab === key
                  ? "bg-[#2E7D32] text-white"
                  : "bg-transparent hover:bg-[#E8F5E9]")
              }
              onClick={() => setTab(key)}
              title={label}
            >
              {label}
            </button>
          ))}
        </div>

        <input
          className="flex-1 input input-sm bg-white input-bordered border-[#CDEBD6] focus:border-[#2E7D32] focus:outline-none"
          placeholder="Buscar nombre o número…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Contenido scrollable */}
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
                    "border-t px-3 py-3 transition-colors border-[#E3EFE7] " +
                    (isActive ? "bg-[#E8F5E9] " : "bg-white hover:bg-[#F1FAF3] ") +
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
                  <div className="flex items-center justify-between gap-3">
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
                          onClick={(e) => {
                            e.stopPropagation();
                            unassign(c);
                          }}
                          className="border-0 btn btn-xs md:btn-sm"
                          style={{
                            backgroundColor: "var(--color-error, #ef4444)",
                            color: "#fff",
                          }}
                          title="Desasignarme"
                        >
                          Yo ✓
                        </button>
                      ) : c.assignedToUid ? (
                        <button
                          className="cursor-not-allowed btn btn-xs md:btn-sm"
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
                          className="btn btn-xs md:btn-sm"
                          style={{
                            backgroundColor: "#2E7D32",
                            borderColor: "#2E7D32",
                            color: "#fff",
                          }}
                          title="Asignarme esta conversación"
                        >
                          Asignarme
                        </button>
                      )}

                      {/* ☆/★: deshabilitado si lockedByOther */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (lockedByOther) return;
                          toggleStar(c);
                        }}
                        disabled={lockedByOther}
                        className={
                          "text-xl leading-none " +
                          (lockedByOther
                            ? "opacity-30 cursor-not-allowed"
                            : isStarred(c)
                            ? "text-yellow-500"
                            : "text-gray-400 hover:text-gray-600")
                        }
                        title={
                          lockedByOther
                            ? `No podés marcar favoritos: asignada a ${c.assignedToName || "otro agente"}`
                            : isStarred(c)
                            ? "Quitar de favoritos"
                            : "Agregar a favoritos"
                        }
                      >
                        {isStarred(c) ? "★" : "☆"}
                      </button>

                      {/* 🗑️ Eliminar (soft delete) */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          softDelete(c);
                        }}
                        disabled={!canDelete(c)}
                        className={
                          "btn btn-xs md:btn-sm " +
                          (!canDelete(c)
                            ? "btn-disabled"
                            : "border border-red-500 text-red-600 hover:bg-red-50")
                        }
                        title={
                          canDelete(c)
                            ? "Eliminar conversación (soft delete)"
                            : "Solo puede eliminarla el agente asignado"
                        }
                      >
                        🗑️
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
          // ===== Vista por etiqueta (MIS etiquetas) — responsive fix =====
          <div className="w-full overflow-x-hidden md:flex md:min-h-0">
            {/* Sidebar desktop */}
            <aside className="hidden md:block w-56 overflow-y-auto border-r shrink-0 border-[#CDEBD6]">
              <div className="p-2 border-b border-[#CDEBD6] bg-[#EAF7EE]">
                <button
                  onClick={() => setSelectedLabel("__all__")}
                  className={
                    "w-full rounded px-2 py-1 text-left transition-colors " +
                    (selectedLabel === "__all__"
                      ? "bg-[#2E7D32] text-white"
                      : "hover:bg-[#E8F5E9]")
                  }
                  title="Mis etiquetas (todas agrupadas)"
                >
                  Mis etiquetas
                </button>
              </div>

              <ul className="p-2 space-y-1">
                {sortedGroups.map(({ key, display, items }) => {
                  const isNone = display === "__none__";
                  return (
                    <li key={key}>
                      <button
                        onClick={() => setSelectedLabel(display)}
                        className={
                          "flex w-full items-center justify-between gap-2 rounded px-2 py-1 transition-colors " +
                          (normSlug(selectedLabel) === key
                            ? "bg-[#2E7D32] text-white"
                            : "hover:bg-[#E8F5E9]")
                        }
                        title={isNone ? "Sin etiqueta" : display}
                      >
                        <span className="flex items-center gap-2 truncate">
                          {isNone ? (
                            <span className="text-xs badge badge-neutral">
                              Sin etiqueta
                            </span>
                          ) : (
                            <LabelChips slugs={[display]} />
                          )}
                        </span>
                        <span className="text-xs opacity-70">{items.length}</span>
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

            {/* Selector mobile (arriba y sticky) */}
            <div className="w-full md:hidden sticky top-0 z-10 border-b border-[#CDEBD6] bg-[#EAF7EE] p-2">
              <label className="block mb-1 text-xs text-gray-600">Etiqueta</label>
              <select
                className="select select-sm w-full bg-white border-[#CDEBD6] focus:border-[#2E7D32] focus:outline-none"
                value={selectedLabel}
                onChange={(e) => setSelectedLabel(e.target.value)}
              >
                <option value="__all__">Mis etiquetas (agrupadas)</option>
                {sortedGroups.map(({ key, display, items }) => (
                  <option key={key} value={display}>
                    {display === "__none__" ? "Sin etiqueta" : display} ({items.length})
                  </option>
                ))}
              </select>
            </div>

            {/* Contenido derecha */}
            <section className="w-full min-w-0 overflow-y-auto md:flex-1">
              {selectedKey === "__all__" ? (
                <div className="divide-y">
                  {sortedGroups.map(({ key, display, items }) => {
                    const isNone = display === "__none__";
                    return (
                      <details key={key} className="group">
                        <summary className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-[#EAF7EE]">
                          <div className="flex items-center gap-2">
                            {isNone ? (
                              <span className="text-xs badge badge-neutral">
                                Sin etiqueta
                              </span>
                            ) : (
                              <LabelChips slugs={[display]} />
                            )}
                          </div>
                          <span className="text-xs text-gray-500">
                            {items.length}
                          </span>
                        </summary>
                        <div className="p-2 space-y-1">
                          {items.map((c) => {
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
                                  "rounded border bg-white px-3 py-2 transition-colors border-[#E3EFE7] " +
                                  (isActive ? "bg-[#E8F5E9] " : "hover:bg-[#F1FAF3] ") +
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
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          unassign(c);
                                        }}
                                        className="border-0 btn btn-xs md:btn-sm"
                                        style={{
                                          backgroundColor: "var(--color-error, #ef4444)",
                                          color: "#fff",
                                        }}
                                        title="Desasignarme"
                                      >
                                        Yo ✓
                                      </button>
                                    ) : c.assignedToUid ? (
                                      <button
                                        className="btn btn-xs md:btn-sm btn-disabled"
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
                                        className="btn btn-xs md:btn-sm"
                                        style={{
                                          backgroundColor: "#2E7D32",
                                          borderColor: "#2E7D32",
                                          color: "#fff",
                                        }}
                                        title="Asignarme esta conversación"
                                      >
                                        Asignarme
                                      </button>
                                    )}
                                    {/* ☆/★ */}
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (lockedByOther) return;
                                        toggleStar(c);
                                      }}
                                      disabled={lockedByOther}
                                      className={
                                        "text-xl leading-none " +
                                        (lockedByOther
                                          ? "opacity-30 cursor-not-allowed"
                                          : isStarred(c)
                                          ? "text-yellow-500"
                                          : "text-gray-400 hover:text-gray-600")
                                      }
                                      title={
                                        lockedByOther
                                          ? `No podés marcar favoritos: asignada a ${c.assignedToName || "otro agente"}`
                                          : isStarred(c)
                                          ? "Quitar de favoritos"
                                          : "Agregar a favoritos"
                                      }
                                    >
                                      {isStarred(c) ? "★" : "☆"}
                                    </button>

                                    {/* 🗑️ Eliminar */}
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        softDelete(c);
                                      }}
                                      disabled={!canDelete(c)}
                                      className={
                                        "btn btn-xs md:btn-sm " +
                                        (!canDelete(c)
                                          ? "btn-disabled"
                                          : "border border-red-500 text-red-600 hover:bg-red-50")
                                      }
                                      title={
                                        canDelete(c)
                                          ? "Eliminar conversación (soft delete)"
                                          : "Solo puede eliminarla el agente asignado"
                                      }
                                    >
                                      🗑️
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
                  {(selectedGroup?.items || []).map((c) => {
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
                          "rounded border bg-white px-3 py-2 transition-colors border-[#E3EFE7] " +
                          (isActive ? "bg-[#E8F5E9] " : "hover:bg-[#F1FAF3] ") +
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
                                onClick={(e) => {
                                  e.stopPropagation();
                                  unassign(c);
                                }}
                                className="border-0 btn btn-xs md:btn-sm"
                                style={{
                                  backgroundColor: "var(--color-error, #ef4444)",
                                  color: "#fff",
                                }}
                                title="Desasignarme"
                              >
                                Yo ✓
                              </button>
                            ) : c.assignedToUid ? (
                              <button
                                className="btn btn-xs md:btn-sm btn-disabled"
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
                                className="btn btn-xs md:btn-sm"
                                style={{
                                  backgroundColor: "#2E7D32",
                                  borderColor: "#2E7D32",
                                  color: "#fff",
                                }}
                                title="Asignarme esta conversación"
                              >
                                Asignarme
                              </button>
                            )}
                            {/* ☆/★ */}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (lockedByOther) return;
                                toggleStar(c);
                              }}
                              disabled={lockedByOther}
                              className={
                                "text-xl leading-none " +
                                (lockedByOther
                                  ? "opacity-30 cursor-not-allowed"
                                  : isStarred(c)
                                  ? "text-yellow-500"
                                  : "text-gray-400 hover:text-gray-600")
                              }
                              title={
                                lockedByOther
                                  ? `No podés marcar favoritos: asignada a ${c.assignedToName || "otro agente"}`
                                  : isStarred(c)
                                  ? "Quitar de favoritos"
                                  : "Agregar a favoritos"
                              }
                            >
                              {isStarred(c) ? "★" : "☆"}
                            </button>

                            {/* 🗑️ Eliminar */}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                softDelete(c);
                              }}
                              disabled={!canDelete(c)}
                              className={
                                "btn btn-xs md:btn-sm " +
                                (!canDelete(c)
                                  ? "btn-disabled"
                                  : "border border-red-500 text-red-600 hover:bg-red-50")
                              }
                              title={
                                canDelete(c)
                                  ? "Eliminar conversación (soft delete)"
                                  : "Solo puede eliminarla el agente asignado"
                              }
                            >
                              🗑️
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
