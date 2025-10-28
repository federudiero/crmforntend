// src/components/ConversationsList.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { db } from "../firebase";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  limit,
  doc,
  getDocs,
  updateDoc,
  runTransaction,
  arrayUnion,
  arrayRemove,
  deleteField,
  where,
  documentId,
  startAfter,
  setDoc,
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

/** Chunk helper (para where(documentId(),'in',...)) */
function chunk(array, size = 10) {
  const out = [];
  for (let i = 0; i < array.length; i += size) out.push(array.slice(i, i + size));
  return out;
}

/** Convierte Timestamp/ISO/Date/null -> millis (número) */
function tsToMillis(ts) {
  if (!ts) return 0;
  if (typeof ts?.toMillis === "function") return ts.toMillis();
  if (ts instanceof Date) return +ts;
  if (typeof ts === "string") return +new Date(ts);
  return +new Date(ts);
}

/** Skeleton simple */
function RowSkeleton() {
  return (
    <div className="border-t px-3 py-3 border-[#E3EFE7] bg-white animate-pulse">
      <div className="w-40 h-3 bg-gray-200 rounded" />
      <div className="mt-2 w-56 h-2 bg-gray-200 rounded" />
      <div className="mt-2 w-24 h-2 bg-gray-200 rounded" />
    </div>
  );
}

export default function ConversationsList({ activeId, onSelect }) {
  const { user } = useAuthState();

  // ======= Estilos locales para la animación de "nuevo entrante" =======
  const AttentionStyles = (
    <style>{`
      .new-reply { position: relative; }
      .new-reply::before {
        content: "";
        position: absolute; left: 0; top: 0; bottom: 0; width: 4px;
        background: #16a34a; animation: pulseBar 1.15s ease-in-out infinite;
        border-top-left-radius: 4px; border-bottom-left-radius: 4px;
      }
      @keyframes pulseBar { 0%,100% { opacity: .4; } 50% { opacity: 1; } }
      .ping-badge {
        position: relative; width: 10px; height: 10px; border-radius: 9999px;
        background: #16a34a; box-shadow: 0 0 0 2px #e6f9ec;
      }
      .ping-badge::after {
        content: ""; position: absolute; inset: 0; border-radius: 9999px;
        animation: ping 1.25s cubic-bezier(0,0,.2,1) infinite;
        border: 2px solid rgba(22,163,74,.5);
      }
      @keyframes ping {
        0% { transform: scale(1); opacity: .85; }
        75% { transform: scale(1.9); opacity: 0; }
        100% { transform: scale(2.1); opacity: 0; }
      }
    `}</style>
  );

  // ======================
  // Estado base (feed)
  // ======================
  const [items, setItems] = useState([]);           // lista ACUMULADA (primer lote + paginados)
  const [loading, setLoading] = useState(true);     // loading inicial (primer lote)
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);     // si hay más por paginar
  const lastDocRef = useRef(null);                  // cursor del ÚLTIMO doc traído (para paginar hacia abajo)

  // Filtros UI existentes
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("todos"); // todos | mios | fav | etiquetas
  const [selectedLabel, setSelectedLabel] = useState("__all__");

  // =========================
  //  "Visto" de último entrante (LS + Firestore)
  // =========================
  const SEEN_KEY = "convSeenInbound_v1";
  const seenInboundRef = useRef({});
  const [seenTick, setSeenTick] = useState(0);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SEEN_KEY);
      seenInboundRef.current = raw ? JSON.parse(raw) : {};
    } catch {
      seenInboundRef.current = {};
    }
  }, []);
  const saveSeen = () => {
    try { localStorage.setItem(SEEN_KEY, JSON.stringify(seenInboundRef.current)); } catch {}
  };
  const loadSeenFor = async (ids) => {
    try {
      if (!user?.uid || !Array.isArray(ids) || ids.length === 0) return;
      for (const ids10 of chunk(ids, 10)) {
        const snap = await getDocs(
          query(collection(db, "users", String(user.uid), "convSeen"), where(documentId(), "in", ids10))
        );
        snap.forEach((docSnap) => {
          const id = String(docSnap.id);
          const data = docSnap.data() || {};
          const lastInboundSeen = Number(data.lastInboundSeen || 0);
          if (!Number.isNaN(lastInboundSeen) && lastInboundSeen > 0) {
            seenInboundRef.current[id] = Math.max(
              lastInboundSeen,
              seenInboundRef.current[id] || 0
            );
          }
        });
      }
      saveSeen();
      setSeenTick((t) => t + 1);
    } catch (e) {
      console.error("loadSeenFor error:", e);
    }
  };
  const markSeen = async (c) => {
    const id = String(c.id);
    const inboundMillis =
      tsToMillis(c.lastInboundAt) || tsToMillis(c.lastMessageAt);
    if (!inboundMillis) return;
    seenInboundRef.current[id] = Math.max(
      inboundMillis,
      seenInboundRef.current[id] || 0
    );
    saveSeen();
    try {
      if (user?.uid) {
        await setDoc(
          doc(db, "users", String(user.uid), "convSeen", id),
          { lastInboundSeen: inboundMillis },
          { merge: true }
        );
      }
    } catch (e) {
      console.error("markSeen setDoc error:", e);
    }
  };

  // =========================
  //  Suscripción (primer lote en tiempo real)
  // =========================
  const unsubRef = useRef(null);
  useEffect(() => {
    if (tab === "etiquetas") return; // la vista etiquetas usa su flujo propio
    setLoading(true);
    setHasMore(true);
    lastDocRef.current = null; // reset cursor al cambiar de tab

    // Primer lote en tiempo real
    const pageSize = 25; // tamaño del primer lote (igual que antes por defecto)
    let qRef = query(
      collection(db, "conversations"),
      orderBy("lastMessageAt", "desc"),
      limit(pageSize)
    );

    if (unsubRef.current) {
      unsubRef.current();
      unsubRef.current = null;
    }

    unsubRef.current = onSnapshot(
      qRef,
      async (snap) => {
        try {
          const docs = snap.docs;
          const lastVisible = docs[docs.length - 1] || null;
          if (lastVisible && !lastDocRef.current) {
            // setear cursor con el último del primer lote (de inicio)
            lastDocRef.current = lastVisible;
          }

          const rows = docs.map((d) => ({ id: d.id, ...d.data(), contact: null }));
          const ids = rows.map((r) => r.id);

          // Contactos
          let contactsById = {};
          if (ids.length > 0) {
            const chunks = chunk(ids, 10);
            const results = await Promise.all(
              chunks.map((ids10) =>
                getDocs(query(collection(db, "contacts"), where(documentId(), "in", ids10)))
              )
            );
            for (const res of results) {
              res.forEach((docSnap) => {
                contactsById[docSnap.id] = docSnap.data();
              });
            }
          }
          const withContacts = rows.map((r) => ({ ...r, contact: contactsById[r.id] || null }));

          // Merge: actualizo/insert los del primer lote dentro de la lista acumulada
          setItems((prev) => {
            const map = new Map(prev.map((x) => [String(x.id), x]));
            for (const r of withContacts) map.set(String(r.id), { ...(map.get(String(r.id)) || {}), ...r });
            // ordenar por lastMessageAt desc
            const arr = Array.from(map.values());
            arr.sort((a, b) => {
              const ta = tsToMillis(a.lastMessageAt);
              const tb = tsToMillis(b.lastMessageAt);
              return tb - ta;
            });
            return arr;
          });

          // cargar estado "visto" para estas ids
          try { await loadSeenFor(ids); } catch (e) { console.error("loadSeenFor(realtime) error:", e); }
        } catch (e) {
          console.error("onSnapshot first-page error:", e);
        } finally {
          setLoading(false);
        }
      },
      (err) => {
        console.error("onSnapshot(conversations) error:", err);
        setLoading(false);
      }
    );

    return () => {
      if (unsubRef.current) {
        unsubRef.current();
        unsubRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // =========================
  //  Cargar MÁS (paginado hacia abajo)
  // =========================
  const loadMore = async () => {
    if (isLoadingMore || !hasMore || tab === "etiquetas") return;
    if (search.trim()) return; // si hay búsqueda activa, evitamos traer más para no gastar de más

    const pageSize = 25;
    const cursor = lastDocRef.current;
    if (!cursor) return;

    setIsLoadingMore(true);
    try {
      const qBase = query(
        collection(db, "conversations"),
        orderBy("lastMessageAt", "desc"),
        startAfter(cursor),
        limit(pageSize)
      );
      const snap = await getDocs(qBase);
      if (snap.empty) {
        setHasMore(false);
        return;
      }

      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data(), contact: null }));
      const ids = rows.map((r) => r.id);

      // contactos
      let contactsById = {};
      for (const ids10 of chunk(ids, 10)) {
        const res = await getDocs(
          query(collection(db, "contacts"), where(documentId(), "in", ids10))
        );
        res.forEach((docSnap) => {
          contactsById[docSnap.id] = docSnap.data();
        });
      }

      const withContacts = rows.map((r) => ({ ...r, contact: contactsById[r.id] || null }));

      // append sin duplicar
      setItems((prev) => {
        const existingIds = new Set(prev.map((x) => String(x.id)));
        const appended = [...prev];
        for (const r of withContacts) {
          if (!existingIds.has(String(r.id))) appended.push(r);
        }
        // ordenar por lastMessageAt desc (por si algún item venía mezclado)
        appended.sort((a, b) => tsToMillis(b.lastMessageAt) - tsToMillis(a.lastMessageAt));
        return appended;
      });

      // update cursor
      const newLast = snap.docs[snap.docs.length - 1] || null;
      lastDocRef.current = newLast || lastDocRef.current;

      // seen
      try { await loadSeenFor(ids); } catch (e) { console.error("loadSeenFor(more) error:", e); }

      // cortar si vino incompleto
      if (snap.size < pageSize) setHasMore(false);
    } catch (e) {
      console.error("loadMore error:", e);
    } finally {
      setIsLoadingMore(false);
    }
  };

  // IntersectionObserver para disparar loadMore al llegar al final
const sentinelRef = useRef(null);
useEffect(() => {
  if (tab === "etiquetas" || loading) return;      // ⟵ esperar a que termine el primer load
  const el = sentinelRef.current;
  if (!el) return;

  const io = new IntersectionObserver(
    (entries) => {
      const first = entries[0];
      if (first?.isIntersecting) loadMore();
    },
    { root: null, rootMargin: "1200px 0px 1200px 0px", threshold: 0.01 }
  );

  io.observe(el);
  return () => io.disconnect();
  // ⟵ quitamos sentinelRef.current; agregamos 'loading'
}, [tab, hasMore, isLoadingMore, search, loading]);

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

  // Acciones rápidas (conservadas)
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
        // 1) Asignar
        tx.update(ref, {
          assignedToUid: user.uid,
          assignedToName: user.displayName || user.email || "Agente",
        });
        // 2) baseline "visto"
        const curInbound =
          tsToMillis(cur.lastInboundAt) || tsToMillis(cur.lastMessageAt);
        if (curInbound) {
          const id = String(c.id);
          seenInboundRef.current[id] = Math.max(
            curInbound,
            seenInboundRef.current[id] || 0
          );
          saveSeen();
        }
      });
      // persistir baseline "visto"
      try {
        const id = String(c.id);
        const inboundMillis = seenInboundRef.current[id] || 0;
        if (user?.uid && inboundMillis > 0) {
          await setDoc(
            doc(db, "users", String(user.uid), "convSeen", id),
            { lastInboundSeen: inboundMillis },
            { merge: true }
          );
        }
      } catch (e) {
        console.error("assignToMe setDoc error:", e);
      }
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
    const base = items.filter((c) => !c.deletedAt);
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
      return base.filter((c) => Array.isArray(c.stars) && c.stars.includes(user.uid));
    }
    return base;
  }, [filteredByText, tab, user?.uid]);

  // ==========================================
  //   ETIQUETAS (TODAS, SIN PAGINACIÓN)
  // ==========================================
  const [labelsAll, setLabelsAll] = useState([]);
  const [labelsLoading, setLabelsLoading] = useState(false);
  const [labelsError, setLabelsError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function loadAllForLabels() {
      if (tab !== "etiquetas" || !user?.uid) return;
      setLabelsLoading(true);
      setLabelsError("");
      try {
        const pageLim = 200; // lote grande
        let qBase = query(
          collection(db, "conversations"),
          orderBy("lastMessageAt", "desc"),
          limit(pageLim)
        );

        let out = [];
        let last = null;
        while (true) {
          const qRef = last ? query(qBase, startAfter(last)) : qBase;
          const snap = await getDocs(qRef);
          if (snap.empty) break;

          const rows = snap.docs.map((d) => ({ id: d.id, ...d.data(), contact: null }));
          const mine = rows.filter((c) => !c.deletedAt && c.assignedToUid === user.uid);
          out.push(...mine);

          last = snap.docs[snap.docs.length - 1];
          if (snap.size < pageLim) break;
          if (out.length > 10000) break;
          if (cancelled) return;
        }

        // contactos
        const ids = out.map((r) => r.id);
        let contactsById = {};
        for (const ids10 of chunk(ids, 10)) {
          const res = await getDocs(
            query(collection(db, "contacts"), where(documentId(), "in", ids10))
          );
          res.forEach((docSnap) => {
            contactsById[docSnap.id] = docSnap.data();
          });
          if (cancelled) return;
        }

        const withContacts = out.map((r) => ({ ...r, contact: contactsById[r.id] || null }));

        // seen
        try { await loadSeenFor(ids); } catch (e) { console.error("loadSeenFor(labels) error:", e); }

        // ordenar final
        withContacts.sort((a, b) => tsToMillis(b.lastMessageAt) - tsToMillis(a.lastMessageAt));

        if (!cancelled) setLabelsAll(withContacts);
      } catch (err) {
        console.error("labels loadAll error:", err);
        if (!cancelled) setLabelsError("No se pudieron cargar todas las etiquetas.");
      } finally {
        if (!cancelled) setLabelsLoading(false);
      }
    }
    loadAllForLabels();
    return () => { cancelled = true; };
  }, [tab, user?.uid]);

  // índice por etiqueta
  const baseForLabels = tab === "etiquetas"
    ? labelsAll
    : (user?.uid ? filtered.filter((c) => c.assignedToUid === user?.uid) : []);

  const labelsIndex = useMemo(() => {
    const map = new Map();
    for (const c of baseForLabels) {
      const slugs =
        Array.isArray(c.labels) && c.labels.length ? c.labels : ["__none__"];
      for (const s of slugs) {
        const key = s === "__none__" ? "__none__" : normSlug(s);
        const display = s === "__none__" ? "__none__" : String(s);
        if (!map.has(key)) map.set(key, { display, items: [] });
        map.get(key).items.push(c);
      }
    }
    for (const entry of map.values()) {
      entry.items.sort((a, b) => tsToMillis(b.lastMessageAt) - tsToMillis(a.lastMessageAt));
    }
    return map;
  }, [baseForLabels]);

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

  const canOpen = (c) => !c.assignedToUid || c.assignedToUid === user?.uid;

  const tryOpen = (c) => {
    if (canOpen(c)) {
      markSeen(c);
      onSelect?.(c.id);
    }
  };

  // ========= Cálculo de "nuevo para mí" =========
  const isNewForMe = (c, isActive, assignedToMe) => {
    if (!assignedToMe) return false;
    if (isActive) return false;
    const inboundMillis =
      tsToMillis(c.lastInboundAt) || tsToMillis(c.lastMessageAt);
    if (!inboundMillis) return false;
    const seen = seenInboundRef.current[String(c.id)] || 0;
    return inboundMillis > seen;
  };

  return (
    <div className="flex flex-col min-h-0 h-full border-r bg-[#F6FBF7] border-[#CDEBD6]">
      {AttentionStyles}

      {/* Header superior: tabs + búsqueda (sin botones de paginado) */}
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 p-2 border-b bg-[#E8F5E9] border-[#CDEBD6]">
        {/* Tabs */}
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

        {/* Búsqueda */}
        <input
          className="flex-1 input input-sm bg-white input-bordered border-[#CDEBD6] focus:border-[#2E7D32] focus:outline-none"
          placeholder="Buscar nombre o número…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        {/* Estado de carga para etiquetas */}
        {tab === "etiquetas" && (
          <div className="ml-auto text-xs">
            {labelsLoading ? (
              <span className="badge badge-outline">Cargando todas las etiquetas…</span>
            ) : labelsError ? (
              <span className="text-red-600">{labelsError}</span>
            ) : (
              <span className="badge badge-success">
                Etiquetas cargadas ({labelsAll.length})
              </span>
            )}
          </div>
        )}
      </div>

      {/* Contenido scrollable */}
      <div className="overflow-y-auto flex-1">
        {tab !== "etiquetas" ? (
          <>
            {loading && (
              <>
                <RowSkeleton />
                <RowSkeleton />
                <RowSkeleton />
              </>
            )}

            {!loading &&
              filtered.map((c) => {
                const isActive = String(c.id) === String(activeId || "");
                const slugs = Array.isArray(c.labels) ? c.labels : [];
                const assignedToMe = user?.uid && c.assignedToUid === user?.uid;
                const lockedByOther = !!c.assignedToUid && !assignedToMe;
                const showNew = isNewForMe(c, isActive, !!assignedToMe);

                return (
                  <div
                    key={c.id}
                    className={
                      "border-t px-3 py-3 transition-colors border-[#E3EFE7] " +
                      (isActive ? "bg-[#E8F5E9] " : "bg-white hover:bg-[#F1FAF3] ") +
                      (lockedByOther ? "opacity-60 cursor-not-allowed " : "") +
                      (showNew ? " new-reply " : "")
                    }
                    role="button"
                    tabIndex={0}
                    onClick={() => tryOpen(c)}
                    onKeyDown={(e) => {
                      if ((e.key === "Enter" || e.key === " ") && canOpen(c))
                        tryOpen(c);
                    }}
                    title={
                      lockedByOther
                        ? `Asignada a ${c.assignedToName || "otro agente"}`
                        : c.id
                    }
                  >
                    <div className="flex gap-3 justify-between items-center">
                      <div className="min-w-0">
                        <div className="flex gap-2 items-center font-mono text-sm truncate">
                          {c.contact?.name || c.id}
                          {showNew && <span className="ping-badge" title="Nuevo mensaje entrante" />}
                        </div>
                        {c.lastMessageText && (
                          <div className="mt-1 text-xs text-gray-600 truncate">
                            {c.lastMessageText}
                          </div>
                        )}
                        <div className="text-[11px] text-gray-500">
                          {formatShort(c.lastMessageAt)}
                        </div>
                        <div className="mt-1">
                          <LabelChips slugs={slugs} />
                        </div>
                      </div>

                      <div className="flex gap-2 items-center shrink-0">
                        {assignedToMe ? (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              unassign(c);
                            }}
                            className="border-0 btn btn-xs md:btn-sm"
                            style={{ backgroundColor: "var(--color-error, #ef4444)", color: "#fff" }}
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
                            style={{ backgroundColor: "#2E7D32", borderColor: "#2E7D32", color: "#fff" }}
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
                          <b>{c.assignedToUid === user?.uid ? "mí" : c.assignedToName || c.assignedToUid}</b>
                        </span>
                      ) : (
                        <span className="italic text-gray-400">
                          {c.assignedToName || (c.assignedToUid ? "Asignado" : "No asignado")}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}

            {/* Loader infinito / fin de lista */}
            {!loading && (
              <div className="py-4">
                {isLoadingMore && (
                  <div className="px-3 text-sm text-center text-gray-500">Cargando más…</div>
                )}
                {!isLoadingMore && hasMore && (
                  <div ref={sentinelRef} className="h-6" aria-hidden />
                )}
                {!hasMore && (
                  <div className="px-3 text-xs text-center text-gray-400">Fin de la lista</div>
                )}
              </div>
            )}

            {!loading && filtered.length === 0 && (
              <div className="px-4 py-8 text-sm text-center text-gray-500">
                No hay conversaciones para estos filtros.
              </div>
            )}
          </>
        ) : (
          // ===== Vista por etiqueta (TODAS, SIN paginar) =====
          <div className="overflow-x-hidden w-full md:flex md:min-h-0">
            {/* Sidebar desktop */}
            <aside className="hidden md:block w-64 overflow-y-auto border-r shrink-0 border-[#CDEBD6]">
  <div className="p-2 border-b border-[#CDEBD6] bg-[#EAF7EE]">
    <button
      onClick={() => setSelectedLabel("__all__")}
      className={
        "w-full rounded px-3 py-2 text-left transition-colors " +
        (selectedLabel === "__all__"
          ? "bg-[#2E7D32] text-white"
          : "hover:bg-[#E8F5E9]")
      }
      title="Mis etiquetas (todas agrupadas)"
    >
      Mis etiquetas
    </button>
  </div>

  {/* GRID de etiquetas */}
  <div className="grid grid-cols-1 gap-2 p-3">
    {sortedGroups.map(({ key, display, items }) => {
      const isActive = normSlug(selectedLabel) === key;
      const isNone = display === "__none__";
      return (
        <button
          key={key}
          onClick={() => setSelectedLabel(display)}
          className={[
            "w-full card shadow-sm border transition-colors px-3 py-2 text-left",
            isActive
              ? "bg-[#2E7D32] text-white border-[#2E7D32]"
              : "bg-base-200 hover:bg-base-300 border-base-300",
          ].join(" ")}
          title={isNone ? "Sin etiqueta" : display}
        >
          <div className="flex gap-2 justify-between items-center">
            <div className="truncate">
              {isNone ? (
                <span className="badge badge-neutral">Sin etiqueta</span>
              ) : (
                <span className="font-medium">{display}</span>
              )}
            </div>
            <span className={isActive ? "badge badge-outline" : "badge badge-ghost"}>
              {items.length}
            </span>
          </div>
        </button>
      );
    })}
    {sortedGroups.length === 0 && !labelsLoading && (
      <div className="text-sm text-gray-500">(No tenés conversaciones asignadas)</div>
    )}
  </div>
</aside>


            {/* Selector mobile */}
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
            <section className="overflow-y-auto w-full min-w-0 md:flex-1">
              {labelsLoading ? (
                <div className="p-3 space-y-2">
                  <RowSkeleton />
                  <RowSkeleton />
                  <RowSkeleton />
                </div>
              ) : selectedLabel === "__all__" ? (
                <div className="divide-y">
                  {sortedGroups.map(({ key, display, items }) => {
                    const isNone = display === "__none__";
                    return (
                      <details key={key} className="group">
                        <summary className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-[#EAF7EE]">
                          <div className="truncate">
  {isNone ? (
    <span className="badge badge-neutral">Sin etiqueta</span>
  ) : (
    <LabelChips slugs={[display]} />
  )}
</div>

                          <span className="text-xs text-gray-500">{items.length}</span>
                        </summary>
                        <div className="p-2 space-y-1">
                          {items.map((c) => {
                            const isActive = String(c.id) === String(activeId || "");
                            const slugs = Array.isArray(c.labels) ? c.labels : [];
                            const assignedToMe = user?.uid && c.assignedToUid === user?.uid;
                            const lockedByOther = !!c.assignedToUid && !assignedToMe;
                            const showNew = isNewForMe(c, isActive, !!assignedToMe);

                            return (
                              <div
                                key={c.id}
                                className={
                                  "rounded border bg-white px-3 py-2 transition-colors border-[#E3EFE7] " +
                                  (isActive ? "bg-[#E8F5E9] " : "hover:bg-[#F1FAF3] ") +
                                  (lockedByOther ? "opacity-60 cursor-not-allowed " : "") +
                                  (showNew ? " new-reply " : "")
                                }
                                role="button"
                                tabIndex={0}
                                onClick={() => tryOpen(c)}
                                onKeyDown={(e) => {
                                  if ((e.key === "Enter" || e.key === " ") && canOpen(c))
                                    tryOpen(c);
                                }}
                                title={
                                  lockedByOther
                                    ? `Asignada a ${c.assignedToName || "otro agente"}`
                                    : c.id
                                }
                              >
                                <div className="flex gap-2 justify-between items-center">
                                  <div className="min-w-0">
                                    <div className="flex gap-2 items-center font-mono text-sm truncate">
                                      {c.contact?.name || c.id}
                                      {showNew && <span className="ping-badge" title="Nuevo mensaje entrante" />}
                                    </div>
                                    <div className="text-[11px] text-gray-500">
                                      {formatShort(c.lastMessageAt)}
                                    </div>
                                    <div className="mt-1">
                                      <LabelChips slugs={slugs} />
                                    </div>
                                  </div>
                                  <div className="flex gap-2 items-center shrink-0">
                                    {assignedToMe ? (
                                      <button
                                        onClick={(e) => { e.stopPropagation(); unassign(c); }}
                                        className="border-0 btn btn-xs md:btn-sm"
                                        style={{ backgroundColor: "var(--color-error, #ef4444)", color: "#fff" }}
                                        title="Desasignarme"
                                      >
                                        Yo ✓
                                      </button>
                                    ) : c.assignedToUid ? (
                                      <button
                                        className="btn btn-xs md:btn-sm btn-disabled"
                                        disabled
                                        onClick={(e) => e.stopPropagation()}
                                        title={`Asignada a ${c.assignedToName || "otro agente"}`}
                                      >
                                        Ocupada
                                      </button>
                                    ) : (
                                      <button
                                        onClick={(e) => { e.stopPropagation(); assignToMe(c); }}
                                        className="btn btn-xs md:btn-sm"
                                        style={{ backgroundColor: "#2E7D32", borderColor: "#2E7D32", color: "#fff" }}
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
                                      onClick={(e) => { e.stopPropagation(); softDelete(c); }}
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
                                      <b>{c.assignedToUid === user?.uid ? "mí" : c.assignedToName || c.assignedToUid}</b>
                                    </span>
                                  ) : (
                                    <span className="italic text-gray-400">
                                      {c.assignedToName || (c.assignedToUid ? "Asignado" : "No asignado")}
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
                  {(labelsIndex.get(normSlug(selectedLabel))?.items || []).map((c) => {
                    const isActive = String(c.id) === String(activeId || "");
                    const slugs = Array.isArray(c.labels) ? c.labels : [];
                    const assignedToMe = user?.uid && c.assignedToUid === user?.uid;
                    const lockedByOther = !!c.assignedToUid && !assignedToMe;
                    const showNew = isNewForMe(c, isActive, !!assignedToMe);

                    return (
                      <div
                        key={c.id}
                        className={
                          "rounded border bg-white px-3 py-2 transition-colors border-[#E3EFE7] " +
                          (isActive ? "bg-[#E8F5E9] " : "hover:bg-[#F1FAF3] ") +
                          (lockedByOther ? "opacity-60 cursor-not-allowed " : "") +
                          (showNew ? " new-reply " : "")
                        }
                        role="button"
                        tabIndex={0}
                        onClick={() => tryOpen(c)}
                        onKeyDown={(e) => {
                          if ((e.key === "Enter" || e.key === " ") && canOpen(c)) tryOpen(c);
                        }}
                        title={
                          lockedByOther
                            ? `Asignada a ${c.assignedToName || "otro agente"}`
                            : c.id
                        }
                      >
                        <div className="flex gap-2 justify-between items-center">
                          <div className="min-w-0">
                            <div className="flex gap-2 items-center font-mono text-sm truncate">
                              {c.contact?.name || c.id}
                              {showNew && <span className="ping-badge" title="Nuevo mensaje entrante" />}
                            </div>
                            <div className="text-[11px] text-gray-500">
                              {formatShort(c.lastMessageAt)}
                            </div>
                            <div className="mt-1">
                              <LabelChips slugs={slugs} />
                            </div>
                          </div>
                          <div className="flex gap-2 items-center shrink-0">
                            {assignedToMe ? (
                              <button
                                onClick={(e) => { e.stopPropagation(); unassign(c); }}
                                className="border-0 btn btn-xs md:btn-sm"
                                style={{ backgroundColor: "var(--color-error, #ef4444)", color: "#fff" }}
                                title="Desasignarme"
                              >
                                Yo ✓
                              </button>
                            ) : c.assignedToUid ? (
                              <button
                                className="btn btn-xs md:btn-sm btn-disabled"
                                disabled
                                onClick={(e) => e.stopPropagation()}
                                title={`Asignada a ${c.assignedToName || "otro agente"}`}
                              >
                                Ocupada
                              </button>
                            ) : (
                              <button
                                onClick={(e) => { e.stopPropagation(); assignToMe(c); }}
                                className="btn btn-xs md:btn-sm"
                                style={{ backgroundColor: "#2E7D32", borderColor: "#2E7D32", color: "#fff" }}
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
                              onClick={(e) => { e.stopPropagation(); softDelete(c); }}
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
                              <b>{c.assignedToUid === user?.uid ? "mí" : c.assignedToName || c.assignedToUid}</b>
                            </span>
                          ) : (
                            <span className="italic text-gray-400">
                              {c.assignedToName || (c.assignedToUid ? "Asignado" : "No asignado")}
                            </span>
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
