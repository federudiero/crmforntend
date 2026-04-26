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
  startAt,
  endAt,
  serverTimestamp,
} from "firebase/firestore";
import { useAuthState } from "../hooks/useAuthState.js";
import LabelChips from "./LabelChips.jsx";
import {
  getAssignedEmail,
  getAssignedUid,
  getConversationAssigneeLabel,
  getConversationPhoneId,
  isConversationAssignedToUser,
  isConversationUnassigned,
} from "../lib/inboxRegion.js";

/** Fecha corta */
function formatShort(ts) {
  const d = ts?.toDate ? ts.toDate() : ts ? new Date(ts) : null;
  return d ? d.toLocaleString() : "";
}


/** Normaliza texto para búsqueda: lower + sin tildes + espacios colapsados */
const foldText = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

/** "rodolfo carlos paz" -> "Rodolfo Carlos Paz" */
const toTitleCase = (s) =>
  String(s ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : ""))
    .join(" ");


/** Normaliza slugs */
const normSlug = (s) => String(s ?? "").trim().toLowerCase();

/** ======== Región configurable ======== */
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

/** Skeleton (DaisyUI) */
function RowSkeleton() {
  return (
    <div className="px-4 py-3 border-b border-base-300 bg-base-100 animate-pulse">
      <div className="w-40 h-3 rounded skeleton" />
      <div className="w-56 h-2 mt-2 rounded skeleton" />
      <div className="w-24 h-2 mt-2 rounded skeleton" />
    </div>
  );
}

export default function ConversationsList({
  activeId,
  onSelect,
  allowedPhoneIds = [],
  allowedEmails = [],
  title = "Conversaciones",
}) {
  const { user } = useAuthState();

  const currentEmail = useMemo(
    () => String(user?.email || "").trim().toLowerCase(),
    [user?.email]
  );

  const allowedPhoneIdsSet = useMemo(
    () => new Set((allowedPhoneIds || []).map((item) => String(item || "").trim()).filter(Boolean)),
    [allowedPhoneIds]
  );

  const allowedEmailsSet = useMemo(
    () => new Set((allowedEmails || []).map((item) => String(item || "").trim().toLowerCase()).filter(Boolean)),
    [allowedEmails]
  );

  const isBlockedForMe = (c) => {
    if (allowedEmailsSet.size > 0 && !allowedEmailsSet.has(currentEmail)) return true;
    if (allowedPhoneIdsSet.size === 0) return false;
    return !allowedPhoneIdsSet.has(getConversationPhoneId(c));
  };

  // ======= Estilos locales (ahora por tokens del theme) =======
  const AttentionStyles = (
    <style>{`
      /* ====== nuevo entrante ====== */
      .new-reply { position: relative; }
      .new-reply::before {
        content: "";
        position: absolute; left: 0; top: 0; bottom: 0; width: 4px;
        background: var(--color-primary);
        animation: pulseBar 1.15s ease-in-out infinite;
        border-top-left-radius: 9999px; border-bottom-left-radius: 9999px;
      }
      @keyframes pulseBar { 0%,100% { opacity: .35; } 50% { opacity: 1; } }

      .ping-badge {
        position: relative; width: 10px; height: 10px; border-radius: 9999px;
        background: var(--color-primary);
        box-shadow: 0 0 0 2px color-mix(in oklab, var(--color-primary) 18%, var(--color-base-100));
      }
      .ping-badge::after {
        content: ""; position: absolute; inset: 0; border-radius: 9999px;
        animation: ping 1.25s cubic-bezier(0,0,.2,1) infinite;
        border: 2px solid color-mix(in oklab, var(--color-primary) 45%, var(--color-base-100));
      }
      @keyframes ping {
        0% { transform: scale(1); opacity: .85; }
        75% { transform: scale(1.9); opacity: 0; }
        100% { transform: scale(2.1); opacity: 0; }
      }

      /* ====== Shell / borders (theme-aware) ====== */
      .wa-shell { background: var(--root-bg, var(--color-base-200)); }
      .wa-border { border-color: var(--color-base-300); }
      .wa-row-border { border-color: color-mix(in oklab, var(--color-base-300) 70%, transparent); }

      /* ====== Rows ====== */
      .wa-row { background: var(--color-base-100); color: var(--color-base-content); position: relative; }
      .wa-row:hover { background: var(--color-base-200); }
      .wa-row.wa-active {
        background: color-mix(in oklab, var(--color-primary) 18%, var(--color-base-100));
      }

      /* ✅ Mis chats (asignados a mí): más notorios */
      .wa-row.wa-mine {
        background: color-mix(in oklab, var(--color-success) 14%, var(--color-base-100));
      }
      .wa-row.wa-mine:hover {
        background: color-mix(in oklab, var(--color-success) 18%, var(--color-base-200));
      }
      .wa-row.wa-mine::after{
        content:"";
        position:absolute; right:0; top:0; bottom:0; width:3px;
        background: var(--color-primary);
        opacity:.9;
        border-top-left-radius:9999px; border-bottom-left-radius:9999px;
      }

      .wa-time {
        color: color-mix(in oklab, var(--color-base-content) 58%, var(--color-base-100));
        font-size: 11px;
      }
      .wa-time.wa-unread { color: var(--color-primary); font-weight: 800; }

      .wa-pill {
        font-size: 10px;
        padding: 2px 8px;
        border-radius: 9999px;
        border: 1px solid var(--color-base-300);
        color: color-mix(in oklab, var(--color-base-content) 88%, var(--color-base-100));
        background: var(--color-base-100);
        line-height: 1.2;
        white-space: nowrap;
      }
      .wa-pill-mine{
        border-color: var(--color-primary);
        background: color-mix(in oklab, var(--color-primary) 16%, var(--color-base-100));
        color: var(--color-base-content);
        font-weight: 800;
      }
      .wa-pill-other{
        background: var(--color-base-200);
        color: color-mix(in oklab, var(--color-base-content) 60%, var(--color-base-100));
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
  //   ETIQUETAS (carga progresiva)
  // ==========================================
  const [labelsAll, setLabelsAll] = useState([]);
  const [labelsLoading, setLabelsLoading] = useState(false); // solo "initial blocking" (mientras está vacío)
  const [labelsBackfilling, setLabelsBackfilling] = useState(false); // sigue cargando en background
  const [labelsError, setLabelsError] = useState("");

  // caches internos para backfill (no afectan otras lógicas)
  const labelsLoadedIdsRef = useRef(new Set());
  const labelsContactsCacheRef = useRef({});

  // ==========================================
  // ✅ BUSCADOR GLOBAL (remote Firestore)
  // ==========================================
  const [searchDebounced, setSearchDebounced] = useState("");
  const [remoteSearchItems, setRemoteSearchItems] = useState([]);
  const [remoteSearchLoading, setRemoteSearchLoading] = useState(false);
  const [remoteSearchError, setRemoteSearchError] = useState("");
  const searchReqIdRef = useRef(0);
  const searchContactsCacheRef = useRef({}); // cache de contacts para resultados remotos

  useEffect(() => {
    const s = String(search || "").trim();
    if (!s) {
      setSearchDebounced("");
      return;
    }
    const t = setTimeout(() => setSearchDebounced(s), 220);
    return () => clearTimeout(t);
  }, [search]);

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
      } catch (e){console.error("Error saving scroll state on unmount:", e);}
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

    // si estás buscando remoto, también parchea ahí (no rompe nada)
    setRemoteSearchItems((prev) => {
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
              chunksArr.map((ids10) => getDocs(query(collection(db, "contacts"), where(documentId(), "in", ids10))))
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

  const isAdmin = !!user?.email && ["federudiero@gmail.com", "fede_rudiero@gmail.com"].includes(user.email);

  const isAssignedToMe = (c) =>
    isConversationAssignedToUser(c, { uid: user?.uid, email: currentEmail });

  const isUnassignedConversation = (c) => isConversationUnassigned(c);

  const isLockedByOther = (c) => !isUnassignedConversation(c) && !isAssignedToMe(c);

  const canDelete = (c) => {
    if (!user?.uid) return false;
    if (isBlockedForMe(c)) return false;
    if (isAdmin) return true;
    return isAssignedToMe(c);
  };

  const toggleStar = async (c) => {
    if (!user?.uid) return;
    if (isBlockedForMe(c)) return;
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
    if (isBlockedForMe(c)) return;
    const ref = doc(db, "conversations", c.id);
    try {
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error("La conversación no existe.");
        const cur = snap.data() || {};
        const currentAssignedUid = getAssignedUid(cur);
        const currentAssignedEmail = getAssignedEmail(cur);
        const meEmail = String(user.email || "").trim().toLowerCase();

        if (
          (currentAssignedUid && currentAssignedUid !== user.uid) ||
          (currentAssignedEmail && currentAssignedEmail !== meEmail)
        ) {
          throw new Error("Esta conversación ya está asignada a otro agente.");
        }
        tx.update(ref, {
          assignedToUid: user.uid,
          assignedToEmail: user.email || null,
          assignedToName: user.displayName || user.email || "Agente",
          assignedAt: serverTimestamp(),
        });
        // ❌ NO marcamos visto acá
      });

      applyLocalPatch(c.id, {
        assignedToUid: user.uid,
        assignedToEmail: user.email || null,
        assignedToName: user.displayName || user.email || "Agente",
      });
    } catch (e) {
      console.error("assignToMe error", e);
      alert(e.message || "No se pudo asignar.");
    }
  };

  const unassign = async (c) => {
    if (!user?.uid) return;
    if (isBlockedForMe(c)) return;
    const ref = doc(db, "conversations", c.id);

    try {
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error("La conversación no existe.");

        const cur = snap.data() || {};
        const assignedUid = getAssignedUid(cur);
        const assignedEmail = getAssignedEmail(cur);
        const meEmail = String(user.email || "").trim().toLowerCase();

        if (
          (assignedUid && assignedUid !== user.uid) ||
          (assignedEmail && assignedEmail !== meEmail)
        ) {
          throw new Error(`Esta conversación ya está asignada a ${getConversationAssigneeLabel(cur)}.`);
        }

        tx.update(ref, {
          assignedToUid: null,
          assignedToEmail: null,
          assignedToName: null,
          assignedAt: null,
        });
      });

      applyLocalPatch(c.id, {
        assignedToUid: null,
        assignedToEmail: null,
        assignedToName: null,
        assignedAt: null,
      });
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

  const canOpen = (c) => !isBlockedForMe(c) && (isUnassignedConversation(c) || isAssignedToMe(c));

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
      <div className="flex items-center justify-center w-10 h-10 overflow-hidden border rounded-full shrink-0 wa-border bg-base-100">
        {src && ok ? (
          <img
            src={src}
            alt={String(display)}
            className="object-cover w-full h-full"
            onError={() => setOk(false)}
          />
        ) : (
          <div className="flex items-center justify-center w-full h-full" style={{ background: theme.bg }}>
            <span className="text-xs font-bold" style={{ color: theme.fg }}>
              {getInitials(display)}
            </span>
          </div>
        )}
      </div>
    );
  };

  // ==========================================
  // ✅ BUSCADOR GLOBAL (remote Firestore)
  // ==========================================
  useEffect(() => {
    let cancelled = false;

    async function fetchContactsByIds(ids) {
      const missing = ids.filter((id) => !searchContactsCacheRef.current[String(id)]);
      if (missing.length === 0) return;

      for (const ids10 of chunk(missing, 10)) {
        const res = await getDocs(query(collection(db, "contacts"), where(documentId(), "in", ids10)));
        res.forEach((docSnap) => {
          searchContactsCacheRef.current[String(docSnap.id)] = docSnap.data();
        });
        if (cancelled) return;
      }
    }

    async function fetchConversationsByIds(ids) {
      const out = [];
      for (const ids10 of chunk(ids, 10)) {
        const res = await getDocs(query(collection(db, "conversations"), where(documentId(), "in", ids10)));
        res.forEach((d) => out.push({ id: d.id, ...d.data(), contact: null }));
        if (cancelled) return [];
      }
      return out;
    }

    function buildPhonePrefixes(raw, digits) {
      const prefixes = new Set();
      const s = String(raw || "").trim();
      if (!s) return [];

      const cleanedPlus = s.startsWith("+") ? "+" + s.slice(1).replace(/\D+/g, "") : null;
      if (cleanedPlus && cleanedPlus.length >= 4) prefixes.add(cleanedPlus);

      const d = String(digits || "");
      if (d.length >= 3) {
        // si ya incluye país (54...), probamos +digits
        if (d.startsWith("54")) prefixes.add("+" + d);

        // heurísticas comunes AR
        prefixes.add("+54" + d);
        prefixes.add("+549" + d);

        // si el usuario ya pegó algo tipo 549...
        if (d.startsWith("549")) prefixes.add("+" + d);

        // último fallback: "+" + digits a secas
        prefixes.add("+" + d);
      }

      // filtrar basura (muy cortos)
      return Array.from(prefixes).filter((p) => typeof p === "string" && p.length >= 5).slice(0, 5);
    }

    async function queryConversationsByIdPrefix(prefix, lim = 30) {
      const qRef = query(
        collection(db, "conversations"),
        orderBy(documentId()),
        startAt(prefix),
        endAt(prefix + "\uf8ff"),
        limit(lim)
      );
      const snap = await getDocs(qRef);
      return snap.docs.map((d) => ({ id: d.id, ...d.data(), contact: null }));
    }

    async function queryContactsByNamePrefix(field, prefix, lim = 40) {
      const qRef = query(
        collection(db, "contacts"),
        orderBy(field),
        startAt(prefix),
        endAt(prefix + "\uf8ff"),
        limit(lim)
      );
      const snap = await getDocs(qRef);
      const ids = [];
      snap.forEach((d) => {
        ids.push(d.id);
        searchContactsCacheRef.current[String(d.id)] = d.data(); // cachear
      });
      return ids;
    }

    async function runRemoteSearch() {
      if (tab === "etiquetas") return;
      if (!user?.uid) return;

      const qRaw = String(searchDebounced || "").trim();
      if (!qRaw) {
        setRemoteSearchItems([]);
        setRemoteSearchError("");
        setRemoteSearchLoading(false);
        return;
      }

      const reqId = ++searchReqIdRef.current;
      setRemoteSearchLoading(true);
      setRemoteSearchError("");

      try {
        const qRawTrim = String(qRaw || "").trim();
        const qLower = qRawTrim.toLowerCase();
        const qFold = foldText(qRawTrim);
        const qTitle = toTitleCase(qRawTrim);
        const digits = onlyDigits(qRawTrim);

        const wantPhone = digits.length >= 3;
        const wantName = qFold.length >= 2;

        const map = new Map();

        // 1) Buscar por teléfono / docId prefix (conversations)
        if (wantPhone) {
          const prefixes = buildPhonePrefixes(qRaw, digits);
          const phoneSnaps = await Promise.all(prefixes.map((p) => queryConversationsByIdPrefix(p, 35)));
          for (const arr of phoneSnaps) {
            for (const c of arr) map.set(String(c.id), c);
          }
        }

        // 2) Buscar por nombre (contacts -> ids -> conversations)
        // Recomendado: contacts.nameLower (case-insensitive)
        if (wantName) {
          let contactIds = [];

          // 2.a) Mejor opción (si existe): nameLower
          try {
            const idsLower = await queryContactsByNamePrefix("nameLower", qLower, 45);
            contactIds.push(...idsLower);
          } catch (e) {
            console.warn("remote search nameLower failed:", e);
          }

          // 2.b) Opcional (si lo tenés): nameFold (sin tildes)
          try {
            const idsFold = await queryContactsByNamePrefix("nameFold", qFold, 45);
            contactIds.push(...idsFold);
          } catch (e) {console.warn("remote search nameFold failed:", e);
            // si no existe el campo, no pasa nada
            // console.warn("remote search nameFold failed:", e);
          }

          // 2.c) Fallback: contacts.name (CASE-SENSITIVE) pero probamos variantes
          // Esto soluciona el caso: "rodolfo" -> "Rodolfo ..."
          try {
            const variants = Array.from(new Set([qRawTrim, qTitle].filter(Boolean))).slice(0, 2);
            for (const v of variants) {
              const idsName = await queryContactsByNamePrefix("name", v, 35);
              contactIds.push(...idsName);
            }
          } catch (e) {
            console.warn("remote search name failed:", e);
          }

          // dedupe + cap
          contactIds = Array.from(new Set(contactIds)).slice(0, 60);

          if (contactIds.length > 0) {
            const convs = await fetchConversationsByIds(contactIds);
            for (const c of convs) map.set(String(c.id), c);
          }
        }

        // armar lista final
        let list = Array.from(map.values());

        // filtro seguridad + deleted
        list = list.filter((c) => !c.deletedAt && !isBlockedForMe(c));

        // cargar contactos para los ids (por si vinieron de conversations)
        const ids = list.map((c) => String(c.id));
        await fetchContactsByIds(ids);
        if (cancelled || reqId !== searchReqIdRef.current) return;

        // adjuntar contactos
        list = list.map((c) => ({
          ...c,
          contact: searchContactsCacheRef.current[String(c.id)] || c.contact || null,
        }));

        // vistos
        await loadSeenFor(ids);

        // ordenar
        list.sort((a, b) => tsToMillis(b.lastMessageAt) - tsToMillis(a.lastMessageAt));

        if (cancelled || reqId !== searchReqIdRef.current) return;
        setRemoteSearchItems(list);
      } catch (err) {
        console.error("remote search error:", err);
        if (!cancelled) setRemoteSearchError("No se pudo buscar en la base completa.");
      } finally {
        if (!cancelled) setRemoteSearchLoading(false);
      }
    }

    runRemoteSearch();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchDebounced, tab, user?.uid]);

  // =========================
  // Buscar por texto + excluir eliminados
  // =========================
  const baseItemsForSearch = useMemo(() => {
    if (tab === "etiquetas") return items; // no aplica
    if (!searchDebounced.trim()) return items;
    return remoteSearchItems;
  }, [tab, searchDebounced, remoteSearchItems, items]);

  const filteredByText = useMemo(() => {
    const qText = foldText(searchDebounced);
    const qDigits = onlyDigits(searchDebounced);

    const base = baseItemsForSearch.filter((c) => !c.deletedAt && !isBlockedForMe(c));
    if (!qText) return base;

    return base.filter((c) => {
      const name = foldText(getDisplayName(c) || "");
      const id = foldText(c.id || "");
      const phone = foldText(c.contact?.phone || c.contactId || "");
      const lastText = foldText(c.lastMessageText || "");
      const labels = foldText(Array.isArray(c.labels) ? c.labels.join(" ") : "");
      const assigned = foldText(c.assignedToName || c.assignedToEmail || c.assignedToUid || "");

      const phoneDigits = onlyDigits(c.contact?.phone || c.contactId || "");
      const idDigits = onlyDigits(c.id || "");
      return (
        name.includes(qText) ||
        id.includes(qText) ||
        phone.includes(qText) ||
        lastText.includes(qText) ||
        labels.includes(qText) ||
        assigned.includes(qText) ||
        (qDigits.length >= 3 && (phoneDigits.includes(qDigits) || idDigits.includes(qDigits)))
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseItemsForSearch, searchDebounced]);

  // Filtros por tab
  const filtered = useMemo(() => {
    const base = filteredByText;
    if (tab === "mios" && user) return base.filter((c) => isAssignedToMe(c));
    if (tab === "fav" && user?.uid) return base.filter((c) => Array.isArray(c.stars) && c.stars.includes(user.uid));
    return base;
  }, [filteredByText, tab, user?.uid]);

  // ✅ Conteos para chips
  const unassignedCount = useMemo(() => {
    if (tab !== "todos") return 0;
    return filtered.filter((c) => isUnassignedConversation(c)).length;
  }, [filtered, tab]);

  const unreadCount = useMemo(() => {
    return filtered.filter((c) => isUnread(c)).length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, seenTick, user?.uid, tab]);

  // ✅ Lista final según quickFilter
  const displayItems = useMemo(() => {
    let list = filtered;

    if (quickFilter === "unassigned" && tab === "todos") list = list.filter((c) => isUnassignedConversation(c));
    else if (quickFilter === "unread") list = list.filter((c) => isUnread(c));

    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, quickFilter, tab, seenTick, user?.uid]);

  // ==========================================
  //   ETIQUETAS (carga rápida 10 días + backfill incremental)
  // ==========================================
  useEffect(() => {
    let cancelled = false;

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    async function fetchContactsIntoCache(ids) {
      if (!Array.isArray(ids) || ids.length === 0) return;
      for (const ids10 of chunk(ids, 10)) {
        const res = await getDocs(query(collection(db, "contacts"), where(documentId(), "in", ids10)));
        res.forEach((docSnap) => {
          labelsContactsCacheRef.current[String(docSnap.id)] = docSnap.data();
        });
        if (cancelled) return;
      }
    }

    function mergeLabelsBatch(rowsWithContacts) {
      setLabelsAll((prev) => {
        const map = new Map(prev.map((x) => [String(x.id), x]));
        for (const r of rowsWithContacts) {
          const id = String(r.id);
          map.set(id, { ...(map.get(id) || {}), ...r });
        }
        const arr = Array.from(map.values());
        arr.sort((a, b) => tsToMillis(b.lastMessageAt) - tsToMillis(a.lastMessageAt));
        return arr;
      });
    }

    async function processSnapDocs(docs) {
      if (!docs || docs.length === 0) return { last: null, addedIds: [] };

      const rows = docs.map((d) => ({ id: d.id, ...d.data(), contact: null }));
            const mine = rows.filter((c) => !c.deletedAt && isAssignedToMe(c) && !isBlockedForMe(c));

      // dedupe global (solo para etiquetas)
      const added = [];
      const addedIds = [];
      for (const c of mine) {
        const id = String(c.id);
        if (!labelsLoadedIdsRef.current.has(id)) {
          labelsLoadedIdsRef.current.add(id);
          added.push(c);
          addedIds.push(id);
        }
      }

      if (addedIds.length === 0) return { last: docs[docs.length - 1] || null, addedIds: [] };

      // contactos (solo nuevos)
      const needContacts = addedIds.filter((id) => !labelsContactsCacheRef.current[id]);
      if (needContacts.length > 0) await fetchContactsIntoCache(needContacts);
      if (cancelled) return { last: docs[docs.length - 1] || null, addedIds: [] };

      const withContacts = added.map((r) => ({
        ...r,
        contact: labelsContactsCacheRef.current[String(r.id)] || null,
      }));

      mergeLabelsBatch(withContacts);

      // vistos (solo nuevos)
      await loadSeenFor(addedIds);

      return { last: docs[docs.length - 1] || null, addedIds };
    }

    async function loadAllForLabelsProgressive() {
      if (tab !== "etiquetas" || !user?.uid) return;

      // reset
      setLabelsError("");
      setLabelsLoading(true);
      setLabelsBackfilling(false);
      setLabelsAll([]);
      labelsLoadedIdsRef.current = new Set();
      labelsContactsCacheRef.current = {};

      const PAGE_LIM = 200;
      const RECENT_DAYS = 10;
      const RECENT_LIM = 300;
      const maxTotal = 10000;

      const baseColl = collection(db, "conversations");

      let cursor = null;

      try {
        // 1) PRIMERO: solo últimos 10 días (rápido)
        const cutoff = new Date(Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000);
        try {
          const qRecent = query(
            baseColl,
            where("lastMessageAt", ">=", cutoff),
            orderBy("lastMessageAt", "desc"),
            limit(RECENT_LIM)
          );
          const snapRecent = await getDocs(qRecent);
          if (cancelled) return;

          if (!snapRecent.empty) {
            const res = await processSnapDocs(snapRecent.docs);
            cursor = res.last;
          } else {
            cursor = null;
          }
        } catch (e) {
          // Si falta índice para where+orderBy, caemos a un "primer page" sin where (igual mejora porque mostramos rápido)
          console.warn("labels recent query fallback:", e);
          cursor = null;
        }

        // si no llegó nada por el query reciente (o falló), al menos cargamos la primer page YA
        if (!cursor && labelsLoadedIdsRef.current.size === 0) {
          const qFirst = query(baseColl, orderBy("lastMessageAt", "desc"), limit(PAGE_LIM));
          const snapFirst = await getDocs(qFirst);
          if (cancelled) return;
          const res = await processSnapDocs(snapFirst.docs);
          cursor = res.last;
        }

        // ya hay algo (o ya intentamos), liberamos la UI
        if (!cancelled) setLabelsLoading(false);

        // 2) DESPUÉS: backfill incremental (sin bloquear)
        if (!cancelled) setLabelsBackfilling(true);

        while (!cancelled) {
          if (labelsLoadedIdsRef.current.size > maxTotal) break;

          const qPage = cursor
            ? query(baseColl, orderBy("lastMessageAt", "desc"), startAfter(cursor), limit(PAGE_LIM))
            : query(baseColl, orderBy("lastMessageAt", "desc"), limit(PAGE_LIM));

          const snap = await getDocs(qPage);
          if (cancelled) return;
          if (snap.empty) break;

          const res = await processSnapDocs(snap.docs);
          cursor = res.last;

          if (snap.size < PAGE_LIM) break;

          // ceder el hilo para que el UI respire (clave)
          await sleep(0);
        }
      } catch (err) {
        console.error("labels progressive load error:", err);
        if (!cancelled) setLabelsError("No se pudieron cargar todas las etiquetas.");
      } finally {
        if (!cancelled) {
          setLabelsLoading(false);
          setLabelsBackfilling(false);
        }
      }
    }

    loadAllForLabelsProgressive();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, user?.uid]);

  const baseForLabels =
    tab === "etiquetas" ? labelsAll : user ? filtered.filter((c) => isAssignedToMe(c)) : [];

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
      <div className="sticky top-0 z-10 border-b wa-border bg-base-200/95 backdrop-blur-sm">
        <div className="px-3 pt-2 text-[11px] font-semibold uppercase tracking-wide opacity-60">{title}</div>
        <div className="flex flex-wrap items-center gap-3 px-3 py-2">
          {/* Tabs */}
          <div className="flex max-w-full overflow-x-auto border shadow-sm rounded-2xl bg-base-100 wa-border">
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
                  (tab === key ? "bg-primary text-primary-content shadow-sm" : "text-base-content hover:bg-base-200")
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
              <span className="absolute inset-y-0 flex items-center text-sm left-3 opacity-70">🔍</span>
              <input
                className="w-full pl-8 pr-3 py-1.5 text-sm rounded-xl border wa-border bg-base-100 text-base-content shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
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
                      ? "bg-primary text-primary-content border-primary"
                      : "bg-base-100 text-base-content border-base-300 hover:bg-base-200")
                  }
                  title="Mostrar solo las conversaciones sin asignar"
                >
                  Sin asignar
                  <span className="ml-2 px-2 py-0.5 rounded-full bg-base-300 bg-opacity-40">{unassignedCount}</span>
                </button>
              )}

              {/* No leídos */}
              <button
                onClick={() => setQuickFilter((q) => (q === "unread" ? "all" : "unread"))}
                className={
                  "px-3 py-1 text-[11px] font-semibold rounded-full border shadow-sm transition-colors " +
                  (quickFilter === "unread"
                    ? "bg-primary text-primary-content border-primary"
                    : "bg-base-100 text-base-content border-base-300 hover:bg-base-200")
                }
                title="Mostrar solo conversaciones con mensajes no leídos"
              >
                No leídos
                <span className="ml-2 px-2 py-0.5 rounded-full bg-base-300 bg-opacity-40">{unreadCount}</span>
              </button>

              {quickFilter !== "all" && (
                <button
                  onClick={() => setQuickFilter("all")}
                  className="px-3 py-1 text-[11px] font-semibold rounded-full border border-base-300 bg-base-100 hover:bg-base-200"
                  title="Quitar filtro"
                >
                  ✕
                </button>
              )}
            </div>
          )}

          {/* Estado búsqueda global */}
          {tab !== "etiquetas" && searchDebounced.trim() && (
            <div className="ml-auto text-[11px]">
              {remoteSearchError ? (
                <span className="badge badge-error badge-outline">{remoteSearchError}</span>
              ) : remoteSearchLoading ? (
                <span className="badge badge-warning badge-outline">Buscando en la base…</span>
              ) : (
                <span className="badge badge-success badge-outline">Resultados ({remoteSearchItems.length})</span>
              )}
            </div>
          )}

          {/* Estado etiquetas */}
          {tab === "etiquetas" && (
            <div className="ml-auto text-[11px]">
              {labelsError ? (
                <span className="badge badge-error badge-outline">{labelsError}</span>
              ) : labelsLoading && labelsAll.length === 0 ? (
                <span className="badge badge-warning badge-outline">Cargando etiquetas…</span>
              ) : labelsBackfilling ? (
                <span className="badge badge-warning badge-outline">Cargando más etiquetas… ({labelsAll.length})</span>
              ) : (
                <span className="badge badge-success badge-outline">Etiquetas cargadas ({labelsAll.length})</span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Contenido scrollable */}
      <div ref={listScrollRef} onScroll={onListScroll} className="flex-1 overflow-y-auto">
        {tab !== "etiquetas" ? (
          <>
            {(loading || (searchDebounced.trim() && remoteSearchLoading && remoteSearchItems.length === 0)) && (
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
                const assignedToMe = isAssignedToMe(c);
                const isMine = !!assignedToMe;
                const lockedByOther = isLockedByOther(c);

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
                    title={lockedByOther ? `Asignada a ${getConversationAssigneeLabel(c)}` : c.id}
                  >
                    <div className="flex items-start justify-between gap-3">
                      {/* info cliente */}
                      <div className="flex items-start flex-1 min-w-0 gap-3">
                        <Avatar c={c} />

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center min-w-0 gap-2">
                            <div
                              className={
                                "font-mono text-sm truncate " +
                                (isMine ? "font-extrabold text-primary" : "font-semibold text-base-content")
                              }
                            >
                              {getDisplayName(c)}
                            </div>

                            {isMine && (
                              <span className="wa-pill wa-pill-mine" title="Asignado a mí">
                                MÍO
                              </span>
                            )}

                            {!isMine && !isUnassignedConversation(c) && (
                              <span className="wa-pill wa-pill-other" title={`Asignado a ${getConversationAssigneeLabel(c)}`}>
                                OCUPADA
                              </span>
                            )}

                            {showNew && <span className="ping-badge" title="No leído" />}
                          </div>

                          {c.lastMessageText && (
                            <div className={"mt-1 text-xs line-clamp-2 " + (isMine ? "text-base-content font-medium" : "opacity-70")}>
                              {c.lastMessageText}
                            </div>
                          )}

                          <div className="flex flex-wrap items-center mt-1 gap-x-2 gap-y-1">
                            <span className={"wa-time " + (showNew ? "wa-unread" : "")}>{formatShort(c.lastMessageAt)}</span>

                            {(c.contact?.phone || c.contactId) && (
                              <span className="wa-pill" title="Número">
                                {c.contact?.phone || c.contactId}
                              </span>
                            )}
                          </div>

                          <div className="mt-1">
                            <LabelChips slugs={slugs} />
                          </div>

                          <div className="mt-1 text-[11px] opacity-70">
                            {isLockedByOther(c) || assignedToMe ? (
                              <span>
                                Asignado a{" "}
                                <b className="text-base-content">
                                  {assignedToMe ? "mí" : getConversationAssigneeLabel(c)}
                                </b>
                              </span>
                            ) : (
                              <span className="italic opacity-70">Sin asignar</span>
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
                              className="px-3 py-1 text-[11px] font-semibold rounded-full bg-primary text-primary-content shadow-sm hover:brightness-95 border border-primary"
                              title="Desasignarme"
                            >
                              Yo ✓
                            </button>
                          ) : isLockedByOther(c) ? (
                            <button
                              className="px-3 py-1 text-[11px] font-semibold rounded-full bg-base-200 opacity-60 border border-base-300 cursor-not-allowed"
                              disabled
                              onClick={(e) => e.stopPropagation()}
                              title={`Asignada a ${getConversationAssigneeLabel(c)}`}
                            >
                              Ocupada
                            </button>
                          ) : (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                assignToMe(c);
                              }}
                              className="px-3 py-1 text-[11px] font-semibold rounded-full bg-primary text-primary-content border border-primary shadow-sm hover:brightness-95"
                              title="Asignarme esta conversación"
                            >
                              Asignarme
                            </button>
                          )}
                        </div>

                        {/* ✅ ACCIONES SECUNDARIAS SOLO EN HOVER (PC) */}
                        <div className="flex items-center gap-2 wa-actions">
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
                                  : "opacity-70 hover:opacity-100")
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
                                ? "border-base-300 opacity-30 cursor-not-allowed"
                                : "border-red-400 text-red-500 hover:bg-red-500/10")
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
              <div className="py-3 text-xs text-center opacity-70">
                {isLoadingMore && <div>Cargando más…</div>}
                {!isLoadingMore && hasMore && !search.trim() && <div ref={sentinelRef} className="h-6" aria-hidden />}
                {!hasMore && !search.trim() && <div>Fin de la lista</div>}
              </div>
            )}

            {!loading && displayItems.length === 0 && (
              <div className="px-4 py-8 text-sm text-center opacity-70">
                {searchDebounced.trim() ? "No hay resultados para esa búsqueda." : "No hay conversaciones para estos filtros."}
              </div>
            )}
          </>
        ) : (
          // ===== Vista por etiqueta =====
          <div className="w-full md:flex md:min-h-0">
            <aside className="hidden w-64 overflow-y-auto border-r md:block wa-border bg-base-200 shrink-0">
              <div className="p-3 border-b wa-border bg-base-200">
                <button
                  onClick={() => setSelectedLabel("__all__")}
                  className={
                    "w-full rounded-xl px-3 py-2 text-left text-sm font-semibold transition-colors border wa-border shadow-sm " +
                    (selectedLabel === "__all__" ? "bg-primary text-primary-content" : "bg-base-100 hover:bg-base-200")
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
                        (isActive ? "bg-primary text-primary-content" : "bg-base-100 hover:bg-base-200")
                      }
                      title={isNone ? "Sin etiqueta" : display}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="truncate">
                          {isNone ? <span className="wa-pill wa-pill-other">Sin etiqueta</span> : <span className="font-medium">{display}</span>}
                        </div>
                        <span className={"wa-pill " + (isActive ? "wa-pill-mine" : "wa-pill-other")}>{items.length}</span>
                      </div>
                    </button>
                  );
                })}
                {sortedGroups.length === 0 && !(labelsLoading && labelsAll.length === 0) && (
                  <div className="text-xs opacity-70">(No tenés conversaciones asignadas)</div>
                )}
              </div>
            </aside>

            <div className="sticky top-0 z-10 w-full p-2 border-b md:hidden wa-border bg-base-200/95 backdrop-blur-sm">
              <label className="block mb-1 text-[11px] opacity-70">Etiqueta</label>
              <select
                className="w-full select select-sm bg-base-100 border-base-300 focus:border-primary focus:outline-none"
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
              {labelsLoading && labelsAll.length === 0 ? (
                <div className="p-3 space-y-2">
                  <RowSkeleton />
                  <RowSkeleton />
                  <RowSkeleton />
                </div>
              ) : (
                <div className="p-2">
                  {(selectedLabel === "__all__" ? labelsAll : labelsIndex.get(normSlug(selectedLabel))?.items || []).map((c) => {
                    const isActive = String(c.id) === String(activeId || "");
                    const slugs = Array.isArray(c.labels) ? c.labels : [];
                    const assignedToMe = isAssignedToMe(c);
                    const isMine = !!assignedToMe;
                    const lockedByOther = isLockedByOther(c);
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
                        title={lockedByOther ? `Asignada a ${getConversationAssigneeLabel(c)}` : c.id}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-start min-w-0 gap-2">
                            <Avatar c={c} />
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 font-mono text-sm truncate">
                                <span className={isMine ? "font-extrabold text-primary" : "font-semibold text-base-content"}>
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
                                className="px-3 py-1 text-[11px] font-semibold rounded-full bg-primary text-primary-content border border-primary"
                                title="Desasignarme"
                              >
                                Yo ✓
                              </button>
                            ) : isLockedByOther(c) ? (
                              <button
                                className="px-3 py-1 text-[11px] font-semibold rounded-full bg-base-200 opacity-60 border border-base-300 cursor-not-allowed"
                                disabled
                                onClick={(e) => e.stopPropagation()}
                                title={`Asignada a ${getConversationAssigneeLabel(c)}`}
                              >
                                Ocupada
                              </button>
                            ) : (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  assignToMe(c);
                                }}
                                className="px-3 py-1 text-[11px] font-semibold rounded-full bg-primary text-primary-content border border-primary"
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

                  {labelsBackfilling && (
                    <div className="py-3 text-xs text-center opacity-70">Cargando más etiquetas en segundo plano…</div>
                  )}

                  {selectedLabel !== "__all__" && (labelsIndex.get(normSlug(selectedLabel))?.items || []).length === 0 && (
                    <div className="px-4 py-8 text-sm text-center opacity-70">No hay conversaciones en esta etiqueta.</div>
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