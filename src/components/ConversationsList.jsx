// src/components/ConversationsList.jsx
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  where,
  documentId,
  startAfter,
  setDoc,
} from "firebase/firestore";
import { useAuthState } from "../hooks/useAuthState.js";
import LabelChips from "./LabelChips.jsx";

/** Fecha corta */
function formatShort(ts) {
  const d = ts?.toDate ? ts.toDate() : ts ? new Date(ts) : null;
  return d ? d.toLocaleString() : "";
}

/** Normaliza slugs */
const normSlug = (s) => String(s ?? "").trim().toLowerCase();

/** Chunk helper */
function chunk(array, size = 10) {
  const out = [];
  for (let i = 0; i < array.length; i += size) out.push(array.slice(i, i + size));
  return out;
}

/** Timestamp/ISO/Date/null -> millis */
function tsToMillis(ts) {
  if (!ts) return 0;
  if (typeof ts?.toMillis === "function") return ts.toMillis();
  if (ts instanceof Date) return +ts;
  if (typeof ts === "string") return +new Date(ts);
  return +new Date(ts);
}

/** ===== Avatar deterministic helpers (sin webhook) ===== */
const onlyDigits = (s) => String(s || "").replace(/\D/g, "");

function hash32(str) {
  // FNV-1a 32-bit
  let h = 2166136261;
  const s = String(str || "");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function avatarTheme(seed) {
  const h = hash32(seed);
  const hue1 = h % 360;
  const hue2 = (hue1 + 35) % 360;
  return {
    bg: `linear-gradient(135deg, hsl(${hue1} 70% 92%), hsl(${hue2} 70% 88%))`,
    fg: `hsl(${hue1} 45% 28%)`,
  };
}

/** Skeleton */
function RowSkeleton() {
  return (
    <div className="px-4 py-3 border-b border-[#e9edef] bg-white animate-pulse">
      <div className="w-40 h-3 rounded bg-slate-200" />
      <div className="w-56 h-2 mt-2 rounded bg-slate-200" />
      <div className="w-24 h-2 mt-2 rounded bg-slate-200" />
    </div>
  );
}

export default function ConversationsList({ activeId, onSelect }) {
  const { user } = useAuthState();

  // ======= Estilos locales (WhatsApp-ish) =======
  const AttentionStyles = (
    <style>{`
      /* ====== nuevo entrante ====== */
      .new-reply { position: relative; }
      .new-reply::before {
        content: "";
        position: absolute; left: 0; top: 0; bottom: 0; width: 4px;
        background: #25D366; animation: pulseBar 1.15s ease-in-out infinite;
        border-top-left-radius: 9999px; border-bottom-left-radius: 9999px;
      }
      @keyframes pulseBar { 0%,100% { opacity: .35; } 50% { opacity: 1; } }

      .ping-badge {
        position: relative; width: 10px; height: 10px; border-radius: 9999px;
        background: #25D366; box-shadow: 0 0 0 2px #e6f9ec;
      }
      .ping-badge::after {
        content: ""; position: absolute; inset: 0; border-radius: 9999px;
        animation: ping 1.25s cubic-bezier(0,0,.2,1) infinite;
        border: 2px solid rgba(37, 211, 102, .45);
      }
      @keyframes ping {
        0% { transform: scale(1); opacity: .85; }
        75% { transform: scale(1.9); opacity: 0; }
        100% { transform: scale(2.1); opacity: 0; }
      }

      /* ====== WhatsApp-ish ====== */
      .wa-shell { background: #f0f2f5; }
      .wa-border { border-color: #d1d7db; }
      .wa-row-border { border-color: #e9edef; }

      .wa-row { background: #ffffff; position: relative; }
      .wa-row:hover { background: #f5f6f6; }
      .wa-row.wa-active { background: #d9fdd3; }

      /* ✅ Mis chats (asignados a mí): más notorios */
      .wa-row.wa-mine { background: #ecfff2; }
      .wa-row.wa-mine:hover { background: #e3ffec; }
      .wa-row.wa-mine::after{
        content:"";
        position:absolute; right:0; top:0; bottom:0; width:3px;
        background:#25D366; opacity:.9;
        border-top-left-radius:9999px; border-bottom-left-radius:9999px;
      }

      .wa-time { color: #667781; font-size: 11px; }
      .wa-time.wa-unread { color: #25D366; font-weight: 800; }

      .wa-pill {
        font-size: 10px;
        padding: 2px 8px;
        border-radius: 9999px;
        border: 1px solid #d1d7db;
        color: #111b21;
        background: #ffffff;
        line-height: 1.2;
        white-space: nowrap;
      }
      .wa-pill-mine{
        border-color:#25D366;
        color:#0b3d1f;
        background:#d9fdd3;
        font-weight:800;
      }
      .wa-pill-other{
        color:#667781;
        background:#f0f2f5;
      }

      /* ✅ Acciones secundarias: aparecen al hover en desktop */
      .wa-actions { opacity: 0; transition: opacity .15s ease; }
      .wa-row:hover .wa-actions { opacity: 1; }
      @media (max-width: 768px) {
        .wa-actions { opacity: 1; }
      }
    `}</style>
  );

  // ======================
  // Estado base (feed)
  // ======================
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const lastDocRef = useRef(null);

  // Tabs
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("todos"); // todos | mios | fav | etiquetas
  const [selectedLabel, setSelectedLabel] = useState("__all__");

  // ✅ Filtros rápidos arriba (WhatsApp-like)
  // all | unassigned | unread
  const [quickFilter, setQuickFilter] = useState("all");

  // ==========================================
  //   ETIQUETAS (TODAS, SIN PAGINACIÓN)
  // ==========================================
  const [labelsAll, setLabelsAll] = useState([]);
  const [labelsLoading, setLabelsLoading] = useState(false);
  const [labelsError, setLabelsError] = useState("");

  // ==================================================
  // ✅ Scroll restore tipo WhatsApp
  // ==================================================
  const listScrollRef = useRef(null);
  const scrollSaveRafRef = useRef(0);

  const restoreStateRef = useRef({
    key: null,
    done: false,
    tries: 0,
    anchorId: null,
    offset: 0,
    top: 0,
    ts: 0,
  });

  const pendingPreserveRef = useRef(null);
  const SCROLL_TTL_MS = 6 * 60 * 60 * 1000;

  const activeIdRef = useRef(activeId);
  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  // ✅ si cambiás a etiquetas, resetea filtros rápidos
  useEffect(() => {
    if (tab === "etiquetas") setQuickFilter("all");
    if (tab !== "todos" && quickFilter === "unassigned") setQuickFilter("all");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // 👇 IMPORTANTE: el scrollKey incluye quickFilter para que cada vista recuerde su scroll
  const scrollKey = useMemo(() => {
    const me = (user?.uid || user?.email || "anon").toString();
    const s = (search || "").trim().toLowerCase();
    return `crm:convlist:scroll:v4:${me}:${tab}:${quickFilter}:${selectedLabel}:${s}`;
  }, [user?.uid, user?.email, tab, quickFilter, selectedLabel, search]);

  const cssEscapeAttr = (v) => {
    try {
      return window?.CSS?.escape ? window.CSS.escape(String(v)) : String(v).replace(/"/g, '\\"');
    } catch {
      return String(v).replace(/"/g, '\\"');
    }
  };

  const getNodeTopInScroll = (container, node) => {
    if (!container || !node) return 0;
    const cRect = container.getBoundingClientRect();
    const nRect = node.getBoundingClientRect();
    return (container.scrollTop || 0) + (nRect.top - cRect.top);
  };

  const captureAnchorState = () => {
    const el = listScrollRef.current;
    if (!el) return null;

    const top = el.scrollTop || 0;
    const rows = Array.from(el.querySelectorAll('[data-conv-row="1"]'));
    const cRect = el.getBoundingClientRect();

    let anchor = null;
    for (const r of rows) {
      const rr = r.getBoundingClientRect();
      if (rr.bottom >= cRect.top + 1) {
        anchor = r;
        break;
      }
    }

    const anchorId = anchor?.getAttribute("data-conv-id") || "";
    const anchorTop = anchor ? getNodeTopInScroll(el, anchor) : 0;
    const offset = anchor ? Math.max(0, top - anchorTop) : 0;

    return { anchorId, offset, top };
  };

  const restoreToAnchorState = (st) => {
    const el = listScrollRef.current;
    if (!el || !st) return;

    if (st.anchorId) {
      const selector = `[data-conv-id="${cssEscapeAttr(st.anchorId)}"]`;
      const node = el.querySelector(selector);
      if (node) {
        const baseTop = getNodeTopInScroll(el, node);
        const target = baseTop + (Number.isFinite(st.offset) ? st.offset : 0);
        el.scrollTop = target;

        requestAnimationFrame(() => {
          const node2 = el.querySelector(selector);
          if (node2) {
            const baseTop2 = getNodeTopInScroll(el, node2);
            const target2 = baseTop2 + (Number.isFinite(st.offset) ? st.offset : 0);
            if (Math.abs((el.scrollTop || 0) - target2) > 2) el.scrollTop = target2;
          }
        });
        return;
      }
    }

    if (Number.isFinite(st.top)) el.scrollTop = st.top;
  };

  const saveScrollState = () => {
    const el = listScrollRef.current;
    if (!el) return;

    const st = captureAnchorState();
    if (!st) return;

    sessionStorage.setItem(scrollKey, String(st.top || 0));
    sessionStorage.setItem(scrollKey + ":anchor", st.anchorId || "");
    sessionStorage.setItem(scrollKey + ":offset", String(st.offset || 0));
    sessionStorage.setItem(scrollKey + ":ts", String(Date.now()));
  };

  const onListScroll = () => {
    if (scrollSaveRafRef.current) cancelAnimationFrame(scrollSaveRafRef.current);
    scrollSaveRafRef.current = requestAnimationFrame(saveScrollState);
  };

  useEffect(() => {
    return () => {
      try {
        saveScrollState();
      } catch { }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollKey]);

  useEffect(() => {
    return () => {
      if (scrollSaveRafRef.current) cancelAnimationFrame(scrollSaveRafRef.current);
    };
  }, []);

  useEffect(() => {
    const ts = Number(sessionStorage.getItem(scrollKey + ":ts") || 0);
    const tooOld = !ts || Date.now() - ts > SCROLL_TTL_MS;

    restoreStateRef.current = {
      key: scrollKey,
      done: false,
      tries: 0,
      anchorId: tooOld ? null : sessionStorage.getItem(scrollKey + ":anchor") || null,
      offset: tooOld ? 0 : parseFloat(sessionStorage.getItem(scrollKey + ":offset") || "0"),
      top: tooOld ? 0 : parseFloat(sessionStorage.getItem(scrollKey) || "0"),
      ts,
    };
  }, [scrollKey]);

  const preserveScrollIfChatOpen = () => {
    if (!activeIdRef.current) return;
    const st = captureAnchorState();
    if (st) pendingPreserveRef.current = st;
  };

  useLayoutEffect(() => {
    const st = pendingPreserveRef.current;
    if (!st) return;
    pendingPreserveRef.current = null;
    restoreToAnchorState(st);
  }, [items.length, tab, search, selectedLabel, quickFilter]);

  useLayoutEffect(() => {
    if (tab === "etiquetas") return;
    if (loading) return;

    const st = restoreStateRef.current;
    if (st.done || st.key !== scrollKey) return;

    const el = listScrollRef.current;
    if (!el) return;

    const tryRestore = () => {
      if (st.anchorId) {
        const selector = `[data-conv-id="${cssEscapeAttr(st.anchorId)}"]`;
        const node = el.querySelector(selector);
        if (node) {
          const baseTop = getNodeTopInScroll(el, node);
          const target = baseTop + (Number.isFinite(st.offset) ? st.offset : 0);

          el.scrollTop = target;

          requestAnimationFrame(() => {
            const node2 = el.querySelector(selector);
            if (node2) {
              const baseTop2 = getNodeTopInScroll(el, node2);
              const target2 = baseTop2 + (Number.isFinite(st.offset) ? st.offset : 0);
              if (Math.abs((el.scrollTop || 0) - target2) > 2) el.scrollTop = target2;
            }
            st.done = true;
          });

          return true;
        }
      }

      if (Number.isFinite(st.top)) {
        el.scrollTop = st.top;
        requestAnimationFrame(() => {
          st.done = true;
        });
        return true;
      }

      st.done = true;
      return false;
    };

    requestAnimationFrame(() => {
      const ok = tryRestore();

      if (!ok && st.anchorId && hasMore && !isLoadingMore && !search.trim() && st.tries < 10) {
        st.tries += 1;
        loadMore();
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, loading, items.length, hasMore, isLoadingMore, search, scrollKey]);

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
          query(collection(db, "users", String(user.uid), "convSeen"), where(documentId(), "in", ids10))
        );
        snap.forEach((docSnap) => {
          const id = String(docSnap.id);
          const data = docSnap.data() || {};
          const lastInboundSeen = Number(data.lastInboundSeen || 0);
          if (!Number.isNaN(lastInboundSeen) && lastInboundSeen > 0) {
            seenInboundRef.current[id] = Math.max(lastInboundSeen, seenInboundRef.current[id] || 0);
          }
        });
      }
      saveSeen();
      setSeenTick((t) => t + 1);
    } catch (e) {
      console.error("loadSeenFor error:", e);
    }
  };

  // ✅ inboundMillis SOLO si es inbound real (así no marca no-leído por mensajes tuyos)
  const inboundMillisOf = (c) => {
    const a = tsToMillis(c.lastInboundAt);
    if (a) return a;
    if (c.lastMessageDirection === "in") return tsToMillis(c.lastMessageAt);
    return 0;
  };

  const markSeen = async (c) => {
    const id = String(c.id);
    const inboundMillis = inboundMillisOf(c);
    if (!inboundMillis) return;

    seenInboundRef.current[id] = Math.max(inboundMillis, seenInboundRef.current[id] || 0);
    saveSeen();
    setSeenTick((t) => t + 1);

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

  // ✅ Helper para parchear estado local
  const applyLocalPatch = (id, patch) => {
    const convId = String(id);
    preserveScrollIfChatOpen();

    setItems((prev) => {
      const next = prev.map((c) => (String(c.id) === convId ? { ...c, ...patch } : c));
      next.sort((a, b) => tsToMillis(b.lastMessageAt) - tsToMillis(a.lastMessageAt));
      return next;
    });

    setLabelsAll((prev) => {
      if (!Array.isArray(prev) || prev.length === 0) return prev;
      const next = prev.map((c) => (String(c.id) === convId ? { ...c, ...patch } : c));
      next.sort((a, b) => tsToMillis(b.lastMessageAt) - tsToMillis(a.lastMessageAt));
      return next;
    });
  };

  // =========================
  //  Suscripción (primer lote en tiempo real)
  // =========================
  const unsubRef = useRef(null);
  useEffect(() => {
    if (tab === "etiquetas") return;
    setLoading(true);
    setHasMore(true);
    lastDocRef.current = null;

    const pageSize = 25;
    const qRef = query(collection(db, "conversations"), orderBy("lastMessageAt", "desc"), limit(pageSize));

    if (unsubRef.current) {
      unsubRef.current();
      unsubRef.current = null;
    }

    unsubRef.current = onSnapshot(
      qRef,
      async (snap) => {
        try {
          preserveScrollIfChatOpen();

          const docs = snap.docs;
          const lastVisible = docs[docs.length - 1] || null;
          if (lastVisible && !lastDocRef.current) lastDocRef.current = lastVisible;

          const rows = docs.map((d) => ({
            id: d.id,
            ...d.data(),
            contact: null,
          }));
          const ids = rows.map((r) => r.id);

          // Contactos por docId
          let contactsById = {};
          if (ids.length > 0) {
            const chunksArr = chunk(ids, 10);
            const results = await Promise.all(
              chunksArr.map((ids10) =>
                getDocs(query(collection(db, "contacts"), where(documentId(), "in", ids10)))
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

          setItems((prev) => {
            const map = new Map(prev.map((x) => [String(x.id), x]));
            for (const r of withContacts) {
              map.set(String(r.id), { ...(map.get(String(r.id)) || {}), ...r });
            }
            const arr = Array.from(map.values());
            arr.sort((a, b) => tsToMillis(b.lastMessageAt) - tsToMillis(a.lastMessageAt));
            return arr;
          });

          await loadSeenFor(ids);
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
  //  Cargar MÁS
  // =========================
  const loadMore = async () => {
    if (isLoadingMore || !hasMore || tab === "etiquetas") return;
    if (search.trim()) return;

    const pageSize = 25;
    const cursor = lastDocRef.current;
    if (!cursor) return;

    setIsLoadingMore(true);
    try {
      preserveScrollIfChatOpen();

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
        const res = await getDocs(query(collection(db, "contacts"), where(documentId(), "in", ids10)));
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
        for (const r of withContacts) if (!existingIds.has(String(r.id))) appended.push(r);
        appended.sort((a, b) => tsToMillis(b.lastMessageAt) - tsToMillis(a.lastMessageAt));
        return appended;
      });

      lastDocRef.current = snap.docs[snap.docs.length - 1] || lastDocRef.current;

      await loadSeenFor(ids);

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

    const rootEl = listScrollRef.current || null;

    const io = new IntersectionObserver(
      (entries) => {
        const first = entries[0];
        if (first?.isIntersecting) loadMore();
      },
      { root: rootEl, rootMargin: "1200px 0px 1200px 0px", threshold: 0.01 }
    );

    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, hasMore, isLoadingMore, search, loading]);

  // =========================
  // Helpers
  // =========================
  const isStarred = (c) => (Array.isArray(c.stars) && user?.uid ? c.stars.includes(user.uid) : false);

  const isAdmin =
    !!user?.email && ["federudiero@gmail.com", "fede_rudiero@gmail.com"].includes(user.email);

  const canDelete = (c) => {
    if (!user?.uid) return false;
    if (isAdmin) return true;
    return c.assignedToUid === user.uid;
  };

  const toggleStar = async (c) => {
    if (!user?.uid) return;
    const ref = doc(db, "conversations", c.id);
    try {
      if (isStarred(c)) await updateDoc(ref, { stars: arrayRemove(user.uid) });
      else await updateDoc(ref, { stars: arrayUnion(user.uid) });
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
        // ❌ NO marcamos visto acá
      });

      applyLocalPatch(c.id, {
        assignedToUid: user.uid,
        assignedToName: user.displayName || user.email || "Agente",
      });
    } catch (e) {
      console.error("assignToMe error", e);
      alert(e.message || "No se pudo asignar.");
    }
  };

  const unassign = async (c) => {
    if (!user?.uid) return;
    const ref = doc(db, "conversations", c.id);

    try {
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error("La conversación no existe.");

        const cur = snap.data() || {};
        const assignedUid = cur.assignedToUid || null;

        if (assignedUid && assignedUid !== user.uid) {
          throw new Error(`Esta conversación ya está asignada a ${cur.assignedToName || "otro agente"}.`);
        }

        tx.update(ref, { assignedToUid: null, assignedToName: null });
      });

      applyLocalPatch(c.id, { assignedToUid: null, assignedToName: null });
    } catch (e) {
      console.error("unassign error", e);
      alert(e?.message || "No se pudo desasignar.");
    }
  };

  const softDelete = async (c) => {
    if (!canDelete(c)) return;
    const ref = doc(db, "conversations", c.id);
    const who = user?.displayName || user?.email || "Agente";
    if (
      !window.confirm(
        `¿Eliminar esta conversación?\n\nCliente: ${getDisplayName(c)}\n\nNo se borran los mensajes del servidor, solo se ocultará de tu lista.`
      )
    )
      return;

    try {
      await updateDoc(ref, {
        deletedAt: new Date().toISOString(),
        deletedByUid: user?.uid || "",
        deletedByName: who,
      });
    } catch (e) {
      console.error("softDelete error:", e);
      alert("No se pudo eliminar.");
    }
  };

  const canOpen = (c) => !c.assignedToUid || c.assignedToUid === user?.uid;

  const isUnread = (c) => {
    if (!canOpen(c)) return false;
    const inboundMillis = inboundMillisOf(c);
    if (!inboundMillis) return false;
    const seen = seenInboundRef.current[String(c.id)] || 0;
    return inboundMillis > seen;
  };

  const tryOpen = (c) => {
    saveScrollState();
    if (canOpen(c)) {
      markSeen(c);
      onSelect?.(c.id);
    }
  };

  // =========================
  // Contact/Avatar helpers
  // =========================
  function getDisplayName(c) {
    return (
      c?.contact?.name ||
      c?.contactName ||
      c?.profileName ||
      c?.displayName ||
      c?.name ||
      c?.contact?.displayName ||
      c?.id
    );
  }

  // =========================
  //  Avatar fallback (SVG data-uri)
  // =========================
  const autoAvatarCacheRef = useRef(new Map());

  const escapeXml = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");

  const stableHash = (str) => {
    let h = 0;
    const s = String(str ?? "");
    for (let i = 0; i < s.length; i++) {
      h = (h << 5) - h + s.charCodeAt(i);
      h |= 0;
    }
    return Math.abs(h);
  };

  const makeSvgAvatarDataUri = ({ key, text }) => {
    const h = stableHash(key);
    const hue = h % 360;
    const bg = `hsl(${hue} 55% 42%)`;
    const fg = "#ffffff";

    const safeText = escapeXml(text).slice(0, 3);

    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">
        <defs>
          <clipPath id="c"><circle cx="32" cy="32" r="32"/></clipPath>
        </defs>
        <g clip-path="url(#c)">
          <rect width="64" height="64" fill="${bg}"/>
          <text x="50%" y="52%"
            text-anchor="middle"
            dominant-baseline="middle"
            font-family="ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto"
            font-size="26"
            font-weight="800"
            fill="${fg}">${safeText}</text>
        </g>
      </svg>
    `.trim();

    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  };

  const getInitials = (nameOrId) => {
    const s = String(nameOrId || "").trim();
    if (!s) return "?";

    const digits = s.replace(/[^\d]/g, "");
    const looksPhone = digits.length >= 7 && (s.startsWith("+") || /^\d/.test(s));

    if (looksPhone) return (digits.slice(-2) || "??").toUpperCase();

    const parts = s.split(/\s+/).filter(Boolean);
    if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
    return (parts[0].slice(0, 1) + parts[1].slice(0, 1)).toUpperCase();
  };

  const getAutoAvatarSrc = (c) => {
    const display = getDisplayName(c);
    const phoneOrId = String(c?.contact?.phone || c?.contactId || c?.id || "");

    const key = phoneOrId || display || "unknown";
    const cache = autoAvatarCacheRef.current;
    if (cache.has(key)) return cache.get(key);

    let text = getInitials(display);
    const digits = phoneOrId.replace(/[^\d]/g, "");
    const looksPhone = digits.length >= 7 && (phoneOrId.startsWith("+") || /^\d/.test(phoneOrId));
    if (looksPhone) text = digits.slice(-2) || "WA";

    const uri = makeSvgAvatarDataUri({ key, text });
    cache.set(key, uri);
    return uri;
  };

  const getAvatarSrc = (c) => {
    const contact = c?.contact || {};
    return (
      // contacts/*
      contact.photoURL ||
      contact.photoUrl ||
      contact.avatarUrl ||
      contact.avatarURL ||
      contact.avatar ||
      contact.profilePic ||
      contact.profilePicUrl ||
      contact.profilePicture ||
      contact.profilePictureUrl ||
      contact.whatsappProfilePic ||
      contact.whatsappProfilePicUrl ||
      contact.waProfilePic ||
      contact.waProfilePicUrl ||
      contact.picture ||
      contact.pictureUrl ||
      contact.imageUrl ||
      contact.image ||
      contact.img ||
      // conversations/*
      c.photoURL ||
      c.photoUrl ||
      c.avatarUrl ||
      c.profilePic ||
      c.profilePicUrl ||
      c.profilePicture ||
      c.profilePictureUrl ||
      c.whatsappProfilePic ||
      c.whatsappProfilePicUrl ||
      c.waProfilePic ||
      c.waProfilePicUrl ||
      c.picture ||
      c.pictureUrl ||
      c.imageUrl ||
      c.image ||
      c.img ||
      // ✅ fallback
      getAutoAvatarSrc(c)
    );
  };

  const Avatar = ({ c }) => {
    const display = getDisplayName(c);
    const src = getAvatarSrc(c);
    const [ok, setOk] = useState(true);

    useEffect(() => {
      setOk(true);
    }, [src]);

    const seed = useMemo(() => {
      const raw = c?.contact?.phone || c?.contactId || c?.id || display || "x";
      const d = onlyDigits(raw);
      return d || String(raw);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [c?.id, c?.contactId, c?.contact?.phone, display]);

    const theme = useMemo(() => avatarTheme(seed), [seed]);

    return (
      <div className="w-10 h-10 rounded-full shrink-0 overflow-hidden border wa-border flex items-center justify-center bg-white">
        {src && ok ? (
          <img
            src={src}
            alt={String(display)}
            className="w-full h-full object-cover"
            onError={() => setOk(false)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center" style={{ background: theme.bg }}>
            <span className="text-xs font-bold" style={{ color: theme.fg }}>
              {getInitials(display)}
            </span>
          </div>
        )}
      </div>
    );
  };

  // =========================
  // Buscar por texto + excluir eliminados
  // =========================
  const filteredByText = useMemo(() => {
    const qText = search.trim().toLowerCase();
    const base = items.filter((c) => !c.deletedAt);
    if (!qText) return base;

    return base.filter((c) => {
      const name = String(getDisplayName(c) || "").toLowerCase();
      const id = String(c.id || "").toLowerCase();
      const phone = String(c.contact?.phone || c.contactId || "").toLowerCase();
      const lastText = String(c.lastMessageText || "").toLowerCase();
      const labels = Array.isArray(c.labels) ? c.labels.join(" ").toLowerCase() : "";
      const assigned = String(c.assignedToName || c.assignedToUid || "").toLowerCase();

      return (
        name.includes(qText) ||
        id.includes(qText) ||
        phone.includes(qText) ||
        lastText.includes(qText) ||
        labels.includes(qText) ||
        assigned.includes(qText)
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, search]);

  // Filtros por tab
  const filtered = useMemo(() => {
    const base = filteredByText;
    if (tab === "mios" && user?.uid) return base.filter((c) => c.assignedToUid === user.uid);
    if (tab === "fav" && user?.uid) return base.filter((c) => Array.isArray(c.stars) && c.stars.includes(user.uid));
    return base;
  }, [filteredByText, tab, user?.uid]);

  // ✅ Conteos para chips
  const unassignedCount = useMemo(() => {
    if (tab !== "todos") return 0;
    return filtered.filter((c) => !c.assignedToUid).length;
  }, [filtered, tab]);

  const unreadCount = useMemo(() => {
    return filtered.filter((c) => isUnread(c)).length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, seenTick, user?.uid, tab]);

  // ✅ Lista final según quickFilter
  const displayItems = useMemo(() => {
    let list = filtered;

    if (quickFilter === "unassigned" && tab === "todos") list = list.filter((c) => !c.assignedToUid);
    else if (quickFilter === "unread") list = list.filter((c) => isUnread(c));

    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, quickFilter, tab, seenTick, user?.uid]);

  // ==========================================
  //   ETIQUETAS (TODAS, SIN PAGINACIÓN)
  // ==========================================
  useEffect(() => {
    let cancelled = false;
    async function loadAllForLabels() {
      if (tab !== "etiquetas" || !user?.uid) return;
      setLabelsLoading(true);
      setLabelsError("");
      try {
        const pageLim = 200;
        const qBase = query(collection(db, "conversations"), orderBy("lastMessageAt", "desc"), limit(pageLim));

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

        const ids = out.map((r) => r.id);
        let contactsById = {};
        for (const ids10 of chunk(ids, 10)) {
          const res = await getDocs(query(collection(db, "contacts"), where(documentId(), "in", ids10)));
          res.forEach((docSnap) => {
            contactsById[docSnap.id] = docSnap.data();
          });
          if (cancelled) return;
        }

        const withContacts = out.map((r) => ({ ...r, contact: contactsById[r.id] || null }));

        await loadSeenFor(ids);

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
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      const slugs = Array.isArray(c.labels) && c.labels.length ? c.labels : ["__none__"];
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

  // =========================
  // Render
  // =========================
  return (
    <div className="flex flex-col h-full min-h-0 border-r wa-border wa-shell">
      {AttentionStyles}

      {/* Header superior */}
      <div className="sticky top-0 z-10 border-b wa-border bg-[#f0f2f5]/95 backdrop-blur-sm">
        <div className="flex flex-wrap items-center gap-3 px-3 py-2">
          {/* Tabs */}
          <div className="flex overflow-x-auto max-w-full rounded-2xl bg-white border wa-border shadow-sm">
            {[
              ["todos", "Todos"],
              ["mios", "Mis chats"],
              ["fav", "Favoritos"],
              ["etiquetas", "Por etiqueta"],
            ].map(([key, label]) => (
              <button
                key={key}
                className={
                  "px-3 sm:px-4 py-1.5 text-xs sm:text-sm font-semibold whitespace-nowrap rounded-2xl transition-all " +
                  (tab === key ? "bg-[#25D366] text-[#0b3d1f] shadow-sm" : "text-[#111b21] hover:bg-[#f0f2f5]")
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
              <span className="absolute inset-y-0 flex items-center text-sm left-3 text-[#667781]">🔍</span>
              <input
                className="w-full pl-8 pr-3 py-1.5 text-sm rounded-xl border wa-border bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-[#25D366]/60"
                placeholder="Buscar nombre o número…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          {/* ✅ Filtros rápidos arriba */}
          {tab !== "etiquetas" && (
            <div className="flex items-center gap-2">
              {/* Sin asignar solo en Todos */}
              {tab === "todos" && (
                <button
                  onClick={() => setQuickFilter((q) => (q === "unassigned" ? "all" : "unassigned"))}
                  className={
                    "px-3 py-1 text-[11px] font-semibold rounded-full border shadow-sm transition-colors " +
                    (quickFilter === "unassigned"
                      ? "bg-[#25D366] text-[#0b3d1f] border-[#25D366]"
                      : "bg-white text-[#111b21] border-[#d1d7db] hover:bg-[#f0f2f5]")
                  }
                  title="Mostrar solo las conversaciones sin asignar"
                >
                  Sin asignar
                  <span className="ml-2 px-2 py-0.5 rounded-full bg-black/10">{unassignedCount}</span>
                </button>
              )}

              {/* No leídos */}
              <button
                onClick={() => setQuickFilter((q) => (q === "unread" ? "all" : "unread"))}
                className={
                  "px-3 py-1 text-[11px] font-semibold rounded-full border shadow-sm transition-colors " +
                  (quickFilter === "unread"
                    ? "bg-[#25D366] text-[#0b3d1f] border-[#25D366]"
                    : "bg-white text-[#111b21] border-[#d1d7db] hover:bg-[#f0f2f5]")
                }
                title="Mostrar solo conversaciones con mensajes no leídos"
              >
                No leídos
                <span className="ml-2 px-2 py-0.5 rounded-full bg-black/10">{unreadCount}</span>
              </button>

              {quickFilter !== "all" && (
                <button
                  onClick={() => setQuickFilter("all")}
                  className="px-3 py-1 text-[11px] font-semibold rounded-full border border-[#d1d7db] bg-white hover:bg-[#f0f2f5]"
                  title="Quitar filtro"
                >
                  ✕
                </button>
              )}
            </div>
          )}

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
      <div ref={listScrollRef} onScroll={onListScroll} className="flex-1 overflow-y-auto">
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
              displayItems.map((c) => {
                const isActive = String(c.id) === String(activeId || "");
                const slugs = Array.isArray(c.labels) ? c.labels : [];
                const assignedToMe = user?.uid && c.assignedToUid === user?.uid;
                const isMine = !!assignedToMe;
                const lockedByOther = !!c.assignedToUid && !assignedToMe;

                // ✅ No leído (WhatsApp-like)
                const showNew = !isActive && isUnread(c);

                return (
                  <div
                    key={c.id}
                    data-conv-row="1"
                    data-conv-id={String(c.id)}
                    className={
                      "wa-row px-3 sm:px-4 py-2 sm:py-3 border-b wa-row-border transition-colors " +
                      (isActive ? "wa-active " : "") +
                      (isMine ? "wa-mine " : "") +
                      (lockedByOther ? "opacity-70 cursor-not-allowed " : "") +
                      (showNew ? "new-reply " : "")
                    }
                    role="button"
                    tabIndex={0}
                    onClick={() => tryOpen(c)}
                    onKeyDown={(e) => {
                      if ((e.key === "Enter" || e.key === " ") && canOpen(c)) tryOpen(c);
                    }}
                    title={lockedByOther ? `Asignada a ${c.assignedToName || "otro agente"}` : c.id}
                  >
                    <div className="flex items-start justify-between gap-3">
                      {/* info cliente */}
                      <div className="flex items-start gap-3 flex-1 min-w-0">
                        <Avatar c={c} />

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 min-w-0">
                            <div
                              className={
                                "font-mono text-sm truncate " +
                                (isMine ? "font-extrabold text-[#0b3d1f]" : "font-semibold text-[#111b21]")
                              }
                            >
                              {getDisplayName(c)}
                            </div>

                            {isMine && (
                              <span className="wa-pill wa-pill-mine" title="Asignado a mí">
                                MÍO
                              </span>
                            )}

                            {!isMine && c.assignedToUid && (
                              <span
                                className="wa-pill wa-pill-other"
                                title={`Asignado a ${c.assignedToName || c.assignedToUid}`}
                              >
                                OCUPADA
                              </span>
                            )}

                            {showNew && <span className="ping-badge" title="No leído" />}
                          </div>

                          {c.lastMessageText && (
                            <div
                              className={
                                "mt-1 text-xs line-clamp-2 " +
                                (isMine ? "text-[#111b21] font-medium" : "text-[#667781]")
                              }
                            >
                              {c.lastMessageText}
                            </div>
                          )}

                          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className={"wa-time " + (showNew ? "wa-unread" : "")}>
                              {formatShort(c.lastMessageAt)}
                            </span>

                            {(c.contact?.phone || c.contactId) && (
                              <span className="wa-pill" title="Número">
                                {c.contact?.phone || c.contactId}
                              </span>
                            )}
                          </div>

                          <div className="mt-1">
                            <LabelChips slugs={slugs} />
                          </div>

                          <div className="mt-1 text-[11px] text-[#667781]">
                            {c.assignedToUid ? (
                              <span>
                                Asignado a{" "}
                                <b className="text-[#111b21]">
                                  {c.assignedToUid === user?.uid ? "mí" : c.assignedToName || c.assignedToUid}
                                </b>
                              </span>
                            ) : (
                              <span className="italic text-[#667781]">Sin asignar</span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* acciones */}
                      <div className="flex flex-col items-end gap-2 shrink-0">
                        {/* ✅ ASIGNACIÓN SIEMPRE VISIBLE (PC y móvil) */}
                        <div className="flex items-center gap-2">
                          {assignedToMe ? (
                            <button
                              onClick={async (e) => {
                                e.stopPropagation();
                                await unassign(c);
                              }}
                              className="px-3 py-1 text-[11px] font-semibold rounded-full bg-[#25D366] text-[#0b3d1f] shadow-sm hover:brightness-95 border border-[#25D366]"
                              title="Desasignarme"
                            >
                              Yo ✓
                            </button>
                          ) : c.assignedToUid ? (
                            <button
                              className="px-3 py-1 text-[11px] font-semibold rounded-full bg-[#f0f2f5] text-[#667781] border border-[#d1d7db] cursor-not-allowed"
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
                              className="px-3 py-1 text-[11px] font-semibold rounded-full bg-[#25D366] text-[#0b3d1f] border border-[#25D366] shadow-sm hover:brightness-95"
                              title="Asignarme esta conversación"
                            >
                              Asignarme
                            </button>
                          )}
                        </div>

                        {/* ✅ ACCIONES SECUNDARIAS SOLO EN HOVER (PC) */}
                        <div className="wa-actions flex items-center gap-2">
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
                                  ? "text-yellow-500"
                                  : "text-[#667781] hover:text-[#111b21]")
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

                          {/* 🗑️ */}
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
                            title={canDelete(c) ? "Eliminar conversación (soft delete)" : "Solo puede eliminarla el agente asignado"}
                          >
                            🗑️
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}

            {!loading && (
              <div className="py-3 text-xs text-center text-[#667781]">
                {isLoadingMore && <div>Cargando más…</div>}
                {!isLoadingMore && hasMore && <div ref={sentinelRef} className="h-6" aria-hidden />}
                {!hasMore && <div>Fin de la lista</div>}
              </div>
            )}

            {!loading && displayItems.length === 0 && (
              <div className="px-4 py-8 text-sm text-center text-[#667781]">No hay conversaciones para estos filtros.</div>
            )}
          </>
        ) : (
          // ===== Vista por etiqueta =====
          <div className="w-full md:flex md:min-h-0">
            <aside className="hidden md:block w-64 border-r wa-border bg-[#f0f2f5] overflow-y-auto shrink-0">
              <div className="p-3 border-b wa-border bg-[#f0f2f5]">
                <button
                  onClick={() => setSelectedLabel("__all__")}
                  className={
                    "w-full rounded-xl px-3 py-2 text-left text-sm font-semibold transition-colors border wa-border shadow-sm " +
                    (selectedLabel === "__all__" ? "bg-[#25D366] text-[#0b3d1f]" : "bg-white hover:bg-[#f5f6f6]")
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
                        "w-full rounded-xl border wa-border px-3 py-2 text-left text-sm transition-colors shadow-sm " +
                        (isActive ? "bg-[#25D366] text-[#0b3d1f]" : "bg-white hover:bg-[#f5f6f6]")
                      }
                      title={isNone ? "Sin etiqueta" : display}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="truncate">
                          {isNone ? (
                            <span className="wa-pill wa-pill-other">Sin etiqueta</span>
                          ) : (
                            <span className="font-medium">{display}</span>
                          )}
                        </div>
                        <span className={"wa-pill " + (isActive ? "wa-pill-mine" : "wa-pill-other")}>{items.length}</span>
                      </div>
                    </button>
                  );
                })}
                {sortedGroups.length === 0 && !labelsLoading && (
                  <div className="text-xs text-[#667781]">(No tenés conversaciones asignadas)</div>
                )}
              </div>
            </aside>

            <div className="w-full md:hidden sticky top-0 z-10 border-b wa-border bg-[#f0f2f5]/95 backdrop-blur-sm p-2">
              <label className="block mb-1 text-[11px] text-[#667781]">Etiqueta</label>
              <select
                className="w-full select select-sm bg-white border-[#d1d7db] focus:border-[#25D366] focus:outline-none"
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

            <section className="w-full min-w-0 overflow-y-auto md:flex-1">
              {labelsLoading ? (
                <div className="p-3 space-y-2">
                  <RowSkeleton />
                  <RowSkeleton />
                  <RowSkeleton />
                </div>
              ) : (
                <div className="p-2">
                  {(
                    selectedLabel === "__all__" ? labelsAll : labelsIndex.get(normSlug(selectedLabel))?.items || []
                  ).map((c) => {
                    const isActive = String(c.id) === String(activeId || "");
                    const slugs = Array.isArray(c.labels) ? c.labels : [];
                    const assignedToMe = user?.uid && c.assignedToUid === user?.uid;
                    const isMine = !!assignedToMe;
                    const lockedByOther = !!c.assignedToUid && !assignedToMe;
                    const showNew = !isActive && isUnread(c);

                    return (
                      <div
                        key={c.id}
                        className={
                          "wa-row rounded-xl border wa-border px-3 py-2 transition-colors mb-2 " +
                          (isActive ? "wa-active " : "") +
                          (isMine ? "wa-mine " : "") +
                          (lockedByOther ? "opacity-70 cursor-not-allowed " : "") +
                          (showNew ? "new-reply " : "")
                        }
                        role="button"
                        tabIndex={0}
                        onClick={() => tryOpen(c)}
                        onKeyDown={(e) => {
                          if ((e.key === "Enter" || e.key === " ") && canOpen(c)) tryOpen(c);
                        }}
                        title={lockedByOther ? `Asignada a ${c.assignedToName || "otro agente"}` : c.id}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex items-start gap-2">
                            <Avatar c={c} />
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 font-mono text-sm truncate">
                                <span className={isMine ? "font-extrabold text-[#0b3d1f]" : "font-semibold text-[#111b21]"}>
                                  {getDisplayName(c)}
                                </span>
                                {isMine && <span className="wa-pill wa-pill-mine">MÍO</span>}
                                {showNew && <span className="ping-badge" title="No leído" />}
                              </div>
                              <div className={"wa-time " + (showNew ? "wa-unread" : "")}>{formatShort(c.lastMessageAt)}</div>
                              <div className="mt-1">
                                <LabelChips slugs={slugs} />
                              </div>
                            </div>
                          </div>

                          {/* ✅ ASIGNACIÓN SIEMPRE VISIBLE TAMBIÉN EN VISTA ETIQUETAS */}
                          <div className="flex items-center gap-2 shrink-0">
                            {assignedToMe ? (
                              <button
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  await unassign(c);
                                }}
                                className="px-3 py-1 text-[11px] font-semibold rounded-full bg-[#25D366] text-[#0b3d1f] border border-[#25D366]"
                                title="Desasignarme"
                              >
                                Yo ✓
                              </button>
                            ) : c.assignedToUid ? (
                              <button
                                className="px-3 py-1 text-[11px] font-semibold rounded-full bg-[#f0f2f5] text-[#667781] border border-[#d1d7db] cursor-not-allowed"
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
                                className="px-3 py-1 text-[11px] font-semibold rounded-full bg-[#25D366] text-[#0b3d1f] border border-[#25D366]"
                                title="Asignarme esta conversación"
                              >
                                Asignarme
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {selectedLabel !== "__all__" &&
                    (labelsIndex.get(normSlug(selectedLabel))?.items || []).length === 0 && (
                      <div className="px-4 py-8 text-sm text-center text-[#667781]">
                        No hay conversaciones en esta etiqueta.
                      </div>
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
