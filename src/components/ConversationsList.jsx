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
import LabelChips from "./LabelChips.jsx";

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
    <div className="px-4 py-3 border-b border-[#E3EFE7] bg-white animate-pulse">
      <div className="w-40 h-3 rounded bg-slate-200" />
      <div className="w-56 h-2 mt-2 rounded bg-slate-200" />
      <div className="w-24 h-2 mt-2 rounded bg-slate-200" />
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
        border-top-left-radius: 9999px; border-bottom-left-radius: 9999px;
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
  // eslint-disable-next-line no-unused-vars
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
    try {
      localStorage.setItem(SEEN_KEY, JSON.stringify(seenInboundRef.current));
    } catch (e) {
      console.error(e);
    }
  };
  const loadSeenFor = async (ids) => {
    try {
      if (!user?.uid || !Array.isArray(ids) || ids.length === 0) return;
      for (const ids10 of chunk(ids, 10)) {
        const snap = await getDocs(
          query(
            collection(db, "users", String(user.uid), "convSeen"),
            where(documentId(), "in", ids10)
          )
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

          const rows = docs.map((d) => ({
            id: d.id,
            ...d.data(),
            contact: null,
          }));
          const ids = rows.map((r) => r.id);

          // Contactos
          let contactsById = {};
          if (ids.length > 0) {
            const chunksArr = chunk(ids, 10);
            const results = await Promise.all(
              chunksArr.map((ids10) =>
                getDocs(
                  query(
                    collection(db, "contacts"),
                    where(documentId(), "in", ids10)
                  )
                )
              )
            );
            for (const res of results) {
              res.forEach((docSnap) => {
                contactsById[docSnap.id] = docSnap.data();
              });
            }
          }
          const withContacts = rows.map((r) => ({
            ...r,
            contact: contactsById[r.id] || null,
          }));

          // Merge
          setItems((prev) => {
            const map = new Map(prev.map((x) => [String(x.id), x]));
            for (const r of withContacts) {
              map.set(String(r.id), {
                ...(map.get(String(r.id)) || {}),
                ...r,
              });
            }
            const arr = Array.from(map.values());
            arr.sort(
              (a, b) => tsToMillis(b.lastMessageAt) - tsToMillis(a.lastMessageAt)
            );
            return arr;
          });

          try {
            await loadSeenFor(ids);
          } catch (e) {
            console.error("loadSeenFor(realtime) error:", e);
          }
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
    if (search.trim()) return;

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

      const rows = snap.docs.map((d) => ({
        id: d.id,
        ...d.data(),
        contact: null,
      }));
      const ids = rows.map((r) => r.id);

      let contactsById = {};
      for (const ids10 of chunk(ids, 10)) {
        const res = await getDocs(
          query(collection(db, "contacts"), where(documentId(), "in", ids10))
        );
        res.forEach((docSnap) => {
          contactsById[docSnap.id] = docSnap.data();
        });
      }

      const withContacts = rows.map((r) => ({
        ...r,
        contact: contactsById[r.id] || null,
      }));

      setItems((prev) => {
        const existingIds = new Set(prev.map((x) => String(x.id)));
        const appended = [...prev];
        for (const r of withContacts) {
          if (!existingIds.has(String(r.id))) appended.push(r);
        }
        appended.sort(
          (a, b) => tsToMillis(b.lastMessageAt) - tsToMillis(a.lastMessageAt)
        );
        return appended;
      });

      const newLast = snap.docs[snap.docs.length - 1] || null;
      lastDocRef.current = newLast || lastDocRef.current;

      try {
        await loadSeenFor(ids);
      } catch (e) {
        console.error("loadSeenFor(more) error:", e);
      }

      if (snap.size < pageSize) setHasMore(false);
    } catch (e) {
      console.error("loadMore error:", e);
    } finally {
      setIsLoadingMore(false);
    }
  };

  // IntersectionObserver
  const sentinelRef = useRef(null);
  useEffect(() => {
    if (tab === "etiquetas" || loading) return;
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
    return c.assignedToUid === user.uid;
  };

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

  // Buscar por texto + excluir eliminados
  const filteredByText = useMemo(() => {
  const qText = search.trim().toLowerCase();
  const base = items.filter((c) => !c.deletedAt);
  if (!qText) return base;

  return base.filter((c) => {
    const name = String(c.contact?.name || "").toLowerCase();
    const id = String(c.id || "").toLowerCase();
    const phone = String(c.contact?.phone || "").toLowerCase();
    const lastText = String(c.lastMessageText || "").toLowerCase();
    const labels = Array.isArray(c.labels)
      ? c.labels.join(" ").toLowerCase()
      : "";
    const assigned = String(
      c.assignedToName || c.assignedToUid || ""
    ).toLowerCase();

    // Si qText aparece en cualquiera de estos campos, la conversación entra
    return (
      name.includes(qText) ||
      id.includes(qText) ||
      phone.includes(qText) ||
      lastText.includes(qText) ||
      labels.includes(qText) ||
      assigned.includes(qText)
    );
  });
}, [items, search]);


  // Filtros por pestaña
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
        const pageLim = 200;
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

          const rows = snap.docs.map((d) => ({
            id: d.id,
            ...d.data(),
            contact: null,
          }));
          const mine = rows.filter(
            (c) => !c.deletedAt && c.assignedToUid === user.uid
          );
          out.push(...mine);

          last = snap.docs[snap.docs.length - 1];
          if (snap.size < pageLim) break;
          if (out.length > 10000) break;
          if (cancelled) return;
        }

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

        const withContacts = out.map((r) => ({
          ...r,
          contact: contactsById[r.id] || null,
        }));

        try {
          await loadSeenFor(ids);
        } catch (e) {
          console.error("loadSeenFor(labels) error:", e);
        }

        withContacts.sort(
          (a, b) => tsToMillis(b.lastMessageAt) - tsToMillis(a.lastMessageAt)
        );

        if (!cancelled) setLabelsAll(withContacts);
      } catch (err) {
        console.error("labels loadAll error:", err);
        if (!cancelled)
          setLabelsError("No se pudieron cargar todas las etiquetas.");
      } finally {
        if (!cancelled) setLabelsLoading(false);
      }
    }
    loadAllForLabels();
    return () => {
      cancelled = true;
    };
  }, [tab, user?.uid]);

  const baseForLabels =
    tab === "etiquetas"
      ? labelsAll
      : user?.uid
      ? filtered.filter((c) => c.assignedToUid === user?.uid)
      : [];

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
      entry.items.sort(
        (a, b) => tsToMillis(b.lastMessageAt) - tsToMillis(a.lastMessageAt)
      );
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
    <div className="flex flex-col h-full min-h-0 border-r bg-gradient-to-b from-[#F1F8F4] to-[#E2F3E7] border-[#CDEBD6]">
      {AttentionStyles}

      {/* Header superior */}
      <div className="sticky top-0 z-10 border-b border-[#CDEBD6] bg-[#E6F5EC]/95 backdrop-blur-sm">
        <div className="flex flex-wrap items-center gap-3 px-3 py-2">
          {/* Tabs */}
          <div className="flex overflow-x-auto max-w-full rounded-2xl bg-white/80 border border-[#CDEBD6] shadow-sm">
            {[
              ["todos", "Todos"],
              ["mios", "Mis chats"],
              ["fav", "Favoritos"],
              ["etiquetas", "Por etiqueta"],
            ].map(([key, label]) => (
              <button
                key={key}
                className={
                  "px-3 sm:px-4 py-1.5 text-xs sm:text-sm font-medium whitespace-nowrap rounded-2xl transition-all " +
                  (tab === key
                    ? "bg-[#2E7D32] text-white shadow-sm"
                    : "text-slate-700 hover:bg-[#E8F5E9]")
                }
                onClick={() => setTab(key)}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Búsqueda */}
          <div className="flex items-center flex-1 min-w-[150px]">
            <div className="relative w-full">
              <span className="absolute inset-y-0 flex items-center text-sm left-3 text-slate-400">
                🔍
              </span>
              <input
                className="w-full pl-8 pr-3 py-1.5 text-sm rounded-xl border border-[#CDEBD6] bg-white/90 shadow-sm focus:outline-none focus:ring-2 focus:ring-[#2E7D32]/60"
                placeholder="Buscar nombre o número…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          {/* Estado etiquetas */}
          {tab === "etiquetas" && (
            <div className="ml-auto text-[11px]">
              {labelsLoading ? (
                <span className="px-2 py-1 border rounded-full bg-amber-50 text-amber-700 border-amber-200">
                  Cargando etiquetas…
                </span>
              ) : labelsError ? (
                <span className="text-red-600">{labelsError}</span>
              ) : (
                <span className="px-2 py-1 border rounded-full bg-emerald-50 text-emerald-700 border-emerald-200">
                  Etiquetas cargadas ({labelsAll.length})
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Contenido scrollable */}
      <div className="flex-1 overflow-y-auto">
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
                      "px-3 sm:px-4 py-2 sm:py-3 border-b border-[#E3EFE7] transition-colors " +
                      (isActive
                        ? "bg-[#DFF3E5]"
                        : "bg-white/95 hover:bg-[#F3FAF6]") +
                      " " +
                      (lockedByOther ? "opacity-70 cursor-not-allowed" : "") +
                      (showNew ? " new-reply" : "")
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
                    <div className="flex items-start justify-between gap-3">
                      {/* info cliente */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <div className="font-mono text-sm font-semibold truncate text-slate-800">
                            {c.contact?.name || c.id}
                          </div>
                          {showNew && (
                            <span
                              className="ping-badge"
                              title="Nuevo mensaje entrante"
                            />
                          )}
                        </div>

                        {c.lastMessageText && (
                          <div className="mt-1 text-xs text-slate-600 line-clamp-2">
                            {c.lastMessageText}
                          </div>
                        )}

                        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500">
                          <span>{formatShort(c.lastMessageAt)}</span>
                          {c.contact?.phone && (
                            <span className="px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600">
                              {c.contact.phone}
                            </span>
                          )}
                        </div>

                        <div className="mt-1">
                          <LabelChips slugs={slugs} />
                        </div>

                        <div className="mt-1 text-[11px] text-slate-600">
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
                            <span className="italic text-slate-400">
                              {c.assignedToName ||
                                (c.assignedToUid ? "Asignado" : "Sin asignar")}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* acciones */}
                      <div className="flex flex-col items-end gap-2 shrink-0">
                        <div className="flex items-center gap-2">
                          {assignedToMe ? (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                unassign(c);
                              }}
                              className="px-3 py-1 text-[11px] font-semibold rounded-full bg-emerald-600 text-white shadow-sm hover:bg-emerald-500 border border-emerald-700"
                              title="Desasignarme"
                            >
                              Yo ✓
                            </button>
                          ) : c.assignedToUid ? (
                            <button
                              className="px-3 py-1 text-[11px] font-semibold rounded-full bg-rose-200 text-rose-800 border border-rose-300 cursor-not-allowed"
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
                              className="px-3 py-1 text-[11px] font-semibold rounded-full bg-emerald-600 text-white border border-emerald-700 shadow-sm hover:bg-emerald-500"
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
                              "text-lg leading-none " +
                              (lockedByOther
                                ? "opacity-30 cursor-not-allowed"
                                : isStarred(c)
                                ? "text-yellow-400"
                                : "text-slate-400 hover:text-slate-600")
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
                              "px-2 py-1 rounded-full text-[11px] border " +
                              (!canDelete(c)
                                ? "border-slate-200 text-slate-300 cursor-not-allowed"
                                : "border-red-400 text-red-500 hover:bg-red-50")
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
                    </div>
                  </div>
                );
              })}

            {/* Loader infinito / fin de lista */}
            {!loading && (
              <div className="py-3 text-xs text-center text-slate-500">
                {isLoadingMore && <div>Cargando más…</div>}
                {!isLoadingMore && hasMore && (
                  <div ref={sentinelRef} className="h-6" aria-hidden />
                )}
                {!hasMore && <div>Fin de la lista</div>}
              </div>
            )}

            {!loading && filtered.length === 0 && (
              <div className="px-4 py-8 text-sm text-center text-slate-500">
                No hay conversaciones para estos filtros.
              </div>
            )}
          </>
        ) : (
          // ===== Vista por etiqueta (TODAS, SIN paginar) =====
          <div className="w-full md:flex md:min-h-0">
            {/* Sidebar desktop */}
            <aside className="hidden md:block w-64 border-r border-[#CDEBD6] bg-[#F2FAF5] overflow-y-auto shrink-0">
              <div className="p-3 border-b border-[#CDEBD6] bg-[#E6F5EC]">
                <button
                  onClick={() => setSelectedLabel("__all__")}
                  className={
                    "w-full rounded-xl px-3 py-2 text-left text-sm font-semibold transition-colors " +
                    (selectedLabel === "__all__"
                      ? "bg-[#2E7D32] text-white shadow-sm"
                      : "bg-white/80 hover:bg-[#E8F5E9]")
                  }
                  title="Mis etiquetas (todas agrupadas)"
                >
                  Mis etiquetas
                </button>
              </div>

              <div className="p-3 space-y-2">
                {sortedGroups.map(({ key, display, items }) => {
                  const isActive = normSlug(selectedLabel) === key;
                  const isNone = display === "__none__";
                  return (
                    <button
                      key={key}
                      onClick={() => setSelectedLabel(display)}
                      className={
                        "w-full rounded-xl border px-3 py-2 text-left text-sm transition-colors shadow-sm " +
                        (isActive
                          ? "bg-[#2E7D32] text-white border-[#2E7D32]"
                          : "bg-white hover:bg-[#F2FAF5] border-[#D6EDE0]")
                      }
                      title={isNone ? "Sin etiqueta" : display}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="truncate">
                          {isNone ? (
                            <span className="px-2 py-0.5 text-[11px] rounded-full bg-slate-100 text-slate-500">
                              Sin etiqueta
                            </span>
                          ) : (
                            <span className="font-medium">{display}</span>
                          )}
                        </div>
                        <span
                          className={
                            "px-2 py-0.5 text-[11px] rounded-full border " +
                            (isActive
                              ? "bg-white/20 border-white/60"
                              : "bg-slate-50 border-slate-200 text-slate-600")
                          }
                        >
                          {items.length}
                        </span>
                      </div>
                    </button>
                  );
                })}
                {sortedGroups.length === 0 && !labelsLoading && (
                  <div className="text-xs text-slate-500">
                    (No tenés conversaciones asignadas)
                  </div>
                )}
              </div>
            </aside>

            {/* Selector mobile */}
            <div className="w-full md:hidden sticky top-0 z-10 border-b border-[#CDEBD6] bg-[#E6F5EC]/95 backdrop-blur-sm p-2">
              <label className="block mb-1 text-[11px] text-slate-600">
                Etiqueta
              </label>
              <select
                className="w-full select select-sm bg-white border-[#CDEBD6] focus:border-[#2E7D32] focus:outline-none"
                value={selectedLabel}
                onChange={(e) => setSelectedLabel(e.target.value)}
              >
                <option value="__all__">Mis etiquetas (agrupadas)</option>
                {sortedGroups.map(({ key, display, items }) => (
                  <option key={key} value={display}>
                    {display === "__none__" ? "Sin etiqueta" : display} (
                    {items.length})
                  </option>
                ))}
              </select>
            </div>

            {/* Contenido derecha */}
            <section className="w-full min-w-0 overflow-y-auto md:flex-1">
              {labelsLoading ? (
                <div className="p-3 space-y-2">
                  <RowSkeleton />
                  <RowSkeleton />
                  <RowSkeleton />
                </div>
              ) : selectedLabel === "__all__" ? (
                <div className="divide-y divide-[#E3EFE7]">
                  {sortedGroups.map(({ key, display, items }) => {
                    const isNone = display === "__none__";
                    return (
                      <details key={key} className="group">
                        <summary className="flex items-center justify-between px-3 py-2 cursor-pointer bg-white/90 hover:bg-[#F2FAF5]">
                          <div className="truncate">
                            {isNone ? (
                              <span className="px-2 py-0.5 text-[11px] rounded-full bg-slate-100 text-slate-500">
                                Sin etiqueta
                              </span>
                            ) : (
                              <LabelChips slugs={[display]} />
                            )}
                          </div>
                          <span className="ml-3 text-xs text-slate-500">
                            {items.length}
                          </span>
                        </summary>
                        <div className="px-3 pb-3 space-y-2 bg-[#F7FBF9]">
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
                            const showNew = isNewForMe(
                              c,
                              isActive,
                              !!assignedToMe
                            );

                            return (
                              <div
                                key={c.id}
                                className={
                                  "rounded-xl border px-3 py-2 bg-white/95 transition-colors " +
                                  (isActive
                                    ? "bg-[#DFF3E5]"
                                    : "hover:bg-[#F3FAF6]") +
                                  " " +
                                  (lockedByOther
                                    ? "opacity-70 cursor-not-allowed"
                                    : "") +
                                  (showNew ? " new-reply" : "")
                                }
                                role="button"
                                tabIndex={0}
                                onClick={() => tryOpen(c)}
                                onKeyDown={(e) => {
                                  if (
                                    (e.key === "Enter" || e.key === " ") &&
                                    canOpen(c)
                                  )
                                    tryOpen(c);
                                }}
                                title={
                                  lockedByOther
                                    ? `Asignada a ${
                                        c.assignedToName || "otro agente"
                                      }`
                                    : c.id
                                }
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-2 font-mono text-sm truncate">
                                      {c.contact?.name || c.id}
                                      {showNew && (
                                        <span
                                          className="ping-badge"
                                          title="Nuevo mensaje entrante"
                                        />
                                      )}
                                    </div>
                                    <div className="text-[11px] text-slate-500">
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
                                        className="px-3 py-1 text-[11px] font-semibold rounded-full bg-emerald-600 text-white border border-emerald-700"
                                        title="Desasignarme"
                                      >
                                        Yo ✓
                                      </button>
                                    ) : c.assignedToUid ? (
                                      <button
                                        className="px-3 py-1 text-[11px] font-semibold rounded-full bg-rose-200 text-rose-800 border border-rose-300 cursor-not-allowed"
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
                                        className="px-3 py-1 text-[11px] font-semibold rounded-full bg-emerald-600 text-white border border-emerald-700"
                                        title="Asignarme esta conversación"
                                      >
                                        Asignarme
                                      </button>
                                    )}

                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (lockedByOther) return;
                                        toggleStar(c);
                                      }}
                                      disabled={lockedByOther}
                                      className={
                                        "text-lg leading-none " +
                                        (lockedByOther
                                          ? "opacity-30 cursor-not-allowed"
                                          : isStarred(c)
                                          ? "text-yellow-400"
                                          : "text-slate-400 hover:text-slate-600")
                                      }
                                      title={
                                        lockedByOther
                                          ? `No podés marcar favoritos: asignada a ${
                                              c.assignedToName || "otro agente"
                                            }`
                                          : isStarred(c)
                                          ? "Quitar de favoritos"
                                          : "Agregar a favoritos"
                                      }
                                    >
                                      {isStarred(c) ? "★" : "☆"}
                                    </button>

                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        softDelete(c);
                                      }}
                                      disabled={!canDelete(c)}
                                      className={
                                        "px-2 py-1 rounded-full text-[11px] border " +
                                        (!canDelete(c)
                                          ? "border-slate-200 text-slate-300 cursor-not-allowed"
                                          : "border-red-400 text-red-500 hover:bg-red-50")
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
                                <div className="mt-1 text-[11px] text-slate-600">
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
                                    <span className="italic text-slate-400">
                                      {c.assignedToName ||
                                        (c.assignedToUid
                                          ? "Asignado"
                                          : "No asignado")}
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
                <div className="p-3 space-y-2">
                  {(labelsIndex.get(normSlug(selectedLabel))?.items || []).map(
                    (c) => {
                      const isActive =
                        String(c.id) === String(activeId || "");
                      const slugs = Array.isArray(c.labels) ? c.labels : [];
                      const assignedToMe =
                        user?.uid && c.assignedToUid === user?.uid;
                      const lockedByOther =
                        !!c.assignedToUid && !assignedToMe;
                      const showNew = isNewForMe(c, isActive, !!assignedToMe);

                      return (
                        <div
                          key={c.id}
                          className={
                            "rounded-xl border px-3 py-2 bg-white/95 transition-colors " +
                            (isActive
                              ? "bg-[#DFF3E5]"
                              : "hover:bg-[#F3FAF6]") +
                            " " +
                            (lockedByOther
                              ? "opacity-70 cursor-not-allowed"
                              : "") +
                            (showNew ? " new-reply" : "")
                          }
                          role="button"
                          tabIndex={0}
                          onClick={() => tryOpen(c)}
                          onKeyDown={(e) => {
                            if (
                              (e.key === "Enter" || e.key === " ") &&
                              canOpen(c)
                            )
                              tryOpen(c);
                          }}
                          title={
                            lockedByOther
                              ? `Asignada a ${
                                  c.assignedToName || "otro agente"
                                }`
                              : c.id
                          }
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 font-mono text-sm truncate">
                                {c.contact?.name || c.id}
                                {showNew && (
                                  <span
                                    className="ping-badge"
                                    title="Nuevo mensaje entrante"
                                  />
                                )}
                              </div>
                              <div className="text-[11px] text-slate-500">
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
                                  className="px-3 py-1 text-[11px] font-semibold rounded-full bg-emerald-600 text-white border border-emerald-700"
                                  title="Desasignarme"
                                >
                                  Yo ✓
                                </button>
                              ) : c.assignedToUid ? (
                                <button
                                  className="px-3 py-1 text-[11px] font-semibold rounded-full bg-rose-200 text-rose-800 border border-rose-300 cursor-not-allowed"
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
                                  className="px-3 py-1 text-[11px] font-semibold rounded-full bg-emerald-600 text-white border border-emerald-700"
                                  title="Asignarme esta conversación"
                                >
                                  Asignarme
                                </button>
                              )}

                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (lockedByOther) return;
                                  toggleStar(c);
                                }}
                                disabled={lockedByOther}
                                className={
                                  "text-lg leading-none " +
                                  (lockedByOther
                                    ? "opacity-30 cursor-not-allowed"
                                    : isStarred(c)
                                    ? "text-yellow-400"
                                    : "text-slate-400 hover:text-slate-600")
                                }
                                title={
                                  lockedByOther
                                    ? `No podés marcar favoritos: asignada a ${
                                        c.assignedToName || "otro agente"
                                      }`
                                    : isStarred(c)
                                    ? "Quitar de favoritos"
                                    : "Agregar a favoritos"
                                }
                              >
                                {isStarred(c) ? "★" : "☆"}
                              </button>

                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  softDelete(c);
                                }}
                                disabled={!canDelete(c)}
                                className={
                                  "px-2 py-1 rounded-full text-[11px] border " +
                                  (!canDelete(c)
                                    ? "border-slate-200 text-slate-300 cursor-not-allowed"
                                    : "border-red-400 text-red-500 hover:bg-red-50")
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
                          <div className="mt-1 text-[11px] text-slate-600">
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
                              <span className="italic text-slate-400">
                                {c.assignedToName ||
                                  (c.assignedToUid
                                    ? "Asignado"
                                    : "No asignado")}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    }
                  )}
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
