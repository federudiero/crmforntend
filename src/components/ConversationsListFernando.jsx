// src/components/ConversationsListFernando.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { db } from "../firebase";
import {
  arrayRemove,
  arrayUnion,
  collection,
  doc,
  documentId,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  setDoc,
  startAfter,
  updateDoc,
  where,
} from "firebase/firestore";
import { useAuthState } from "../hooks/useAuthState.js";
import LabelChips from "./LabelChips.jsx";

/* =========================
   Utils
========================= */
function formatShort(ts) {
  const d = ts?.toDate ? ts.toDate() : ts ? new Date(ts) : null;
  return d ? d.toLocaleString() : "";
}

function chunk(array, size = 10) {
  const out = [];
  for (let i = 0; i < array.length; i += size) out.push(array.slice(i, i + size));
  return out;
}

function tsToMillis(ts) {
  if (!ts) return 0;
  if (typeof ts?.toMillis === "function") return ts.toMillis();
  if (ts instanceof Date) return +ts;
  if (typeof ts === "string") return +new Date(ts);
  return +new Date(ts);
}

function normSlug(s) {
  return String(s || "").trim().toLowerCase();
}

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

function getAvatarText(c) {
  const name = String(getDisplayName(c) || "").trim();
  if (name) {
    const words = name.split(/\s+/).filter(Boolean);
    if (words.length >= 2) {
      return `${words[0][0] || ""}${words[1][0] || ""}`.toUpperCase();
    }
    if (words[0]) return words[0].slice(0, 2).toUpperCase();
  }

  const phone = String(c?.contact?.phone || c?.contactId || c?.id || "").replace(/\D+/g, "");
  return phone.slice(-2) || "WA";
}

function avatarHue(seed) {
  const s = String(seed || "");
  let hash = 0;
  for (let i = 0; i < s.length; i += 1) {
    hash = s.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash) % 360;
}

function Avatar({ c }) {
  const text = getAvatarText(c);
  const hue = avatarHue(c?.id || c?.contactId || text);
  const style = {
    backgroundColor: `hsl(${hue} 55% 45%)`,
    color: "white",
  };

  return (
    <div
      className="flex items-center justify-center w-10 h-10 text-sm font-bold rounded-full shrink-0"
      style={style}
      title={getDisplayName(c)}
    >
      {text}
    </div>
  );
}

function RowSkeleton() {
  return (
    <div className="px-3 py-3 border-b border-base-300 bg-base-100 animate-pulse">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start flex-1 min-w-0 gap-3">
          <div className="w-10 h-10 rounded-full bg-base-300 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="w-40 h-4 rounded bg-base-300" />
            <div className="w-56 h-3 mt-2 rounded bg-base-300" />
            <div className="w-24 h-3 mt-2 rounded bg-base-300" />
          </div>
        </div>
        <div className="w-20 rounded-full h-7 bg-base-300 shrink-0" />
      </div>
    </div>
  );
}

/* =========================
   Component
========================= */
export default function ConversationsListFernando({
  activeId,
  onSelect,
  waPhoneId: waPhoneIdProp,
  title = "Inbox privado",
}) {
  const { user } = useAuthState();

  const currentUid = String(user?.uid || "").trim();
  const currentEmail = String(user?.email || "").trim().toLowerCase();

  const [waPhoneId, setWaPhoneId] = useState(
    waPhoneIdProp ? String(waPhoneIdProp) : null
  );
  const [waLoading, setWaLoading] = useState(!waPhoneIdProp);

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const lastDocRef = useRef(null);
  const unsubRef = useRef(null);

  const [tab, setTab] = useState("all"); // all | mine | favorites | labels
  const [search, setSearch] = useState("");
  const [showOnlyUnread, setShowOnlyUnread] = useState(false);
  const [showOnlyUnassigned, setShowOnlyUnassigned] = useState(false);
  const [selectedLabel, setSelectedLabel] = useState("__all__");

  const listScrollRef = useRef(null);
  const sentinelRef = useRef(null);

  // No leídos
  const SEEN_KEY = "convSeenInbound_v1";
  const seenInboundRef = useRef({});
  const [seenTick, setSeenTick] = useState(0);

  /* =========================
     waPhoneId desde users/{uid}
  ========================= */
  useEffect(() => {
    if (waPhoneIdProp) {
      setWaPhoneId(String(waPhoneIdProp));
      setWaLoading(false);
      return;
    }

    if (!user?.uid) {
      setWaPhoneId(null);
      setWaLoading(false);
      return;
    }

    setWaLoading(true);

    const unsub = onSnapshot(
      doc(db, "users", String(user.uid)),
      (snap) => {
        const d = snap.data() || {};
        setWaPhoneId(d?.waPhoneId ? String(d.waPhoneId) : null);
        setWaLoading(false);
      },
      (err) => {
        console.error("Error cargando waPhoneId del usuario:", err);
        setWaPhoneId(null);
        setWaLoading(false);
      }
    );

    return () => unsub();
  }, [user?.uid, waPhoneIdProp]);

  /* =========================
     Seen state
  ========================= */
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
      console.error("saveSeen error:", e);
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

  const inboundMillisOf = (c) => {
    const a = tsToMillis(c.lastInboundAt);
    if (a) return a;
    if (c.lastMessageDirection === "in") return tsToMillis(c.lastMessageAt);
    return 0;
  };

  const isUnread = (c) => {
    const inboundMillis = inboundMillisOf(c);
    if (!inboundMillis) return false;
    const seen = seenInboundRef.current[String(c.id)] || 0;
    return inboundMillis > seen;
  };

  const markSeen = async (c) => {
    const id = String(c.id);
    const inboundMillis = inboundMillisOf(c);
    if (!inboundMillis) return;

    seenInboundRef.current[id] = Math.max(
      inboundMillis,
      seenInboundRef.current[id] || 0
    );
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

  /* =========================
     Helpers de visibilidad privada
  ========================= */
  function isVisibleForPrivateUser(c) {
    const assignedUid = String(c?.assignedToUid || "").trim();
    const assignedEmail = String(c?.assignedToEmail || "").trim().toLowerCase();

    if (!assignedUid && !assignedEmail) return true;
    if (assignedUid && assignedUid === currentUid) return true;
    if (assignedEmail && assignedEmail === currentEmail) return true;

    return false;
  }

  const isMine = (c) =>
    String(c?.assignedToUid || "").trim() === currentUid ||
    String(c?.assignedToEmail || "").trim().toLowerCase() === currentEmail;

  const isStarred = (c) =>
    Array.isArray(c?.stars) && user?.uid ? c.stars.includes(user.uid) : false;

  const isAdmin = !!user?.email &&
    ["federudiero@gmail.com", "fede_rudiero@gmail.com"].includes(currentEmail);

  const canDelete = (c) => {
    if (!user?.uid) return false;
    if (!isVisibleForPrivateUser(c)) return false;
    if (isAdmin) return true;
    return isMine(c);
  };

  const applyLocalPatch = (id, patch) => {
    setItems((prev) =>
      prev.map((x) => (String(x.id) === String(id) ? { ...x, ...patch } : x))
    );
  };

  /* =========================
     Acciones
  ========================= */
  const toggleStar = async (c) => {
    if (!user?.uid) return;
    if (!isVisibleForPrivateUser(c)) return;

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
    if (!isVisibleForPrivateUser(c)) return;

    const ref = doc(db, "conversations", c.id);
    try {
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error("La conversación no existe.");

        const cur = snap.data() || {};
        const assignedUid = cur.assignedToUid || null;
        const assignedEmail = String(cur.assignedToEmail || "").trim().toLowerCase();

        if ((assignedUid && assignedUid !== user.uid) || (assignedEmail && assignedEmail !== currentEmail)) {
          throw new Error("Esta conversación ya está asignada a otro agente.");
        }

        tx.update(ref, {
          assignedToUid: user.uid,
          assignedToEmail: user.email || null,
          assignedToName: user.displayName || user.email || "Agente",
        });
      });

      applyLocalPatch(c.id, {
        assignedToUid: user.uid,
        assignedToEmail: user.email || null,
        assignedToName: user.displayName || user.email || "Agente",
      });
    } catch (e) {
      console.error("assignToMe error", e);
      alert(e?.message || "No se pudo asignar.");
    }
  };

  const unassign = async (c) => {
    if (!user?.uid) return;
    if (!isVisibleForPrivateUser(c)) return;

    const ref = doc(db, "conversations", c.id);

    try {
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error("La conversación no existe.");

        const cur = snap.data() || {};
        const assignedUid = cur.assignedToUid || null;
        const assignedEmail = String(cur.assignedToEmail || "").trim().toLowerCase();

        const mine =
          (assignedUid && assignedUid === user.uid) ||
          (assignedEmail && assignedEmail === currentEmail);

        if (!mine) {
          throw new Error("Solo podés desasignar una conversación que está asignada a vos.");
        }

        tx.update(ref, {
          assignedToUid: null,
          assignedToEmail: null,
          assignedToName: null,
        });
      });

      applyLocalPatch(c.id, {
        assignedToUid: null,
        assignedToEmail: null,
        assignedToName: null,
      });
    } catch (e) {
      console.error("unassign error", e);
      alert(e?.message || "No se pudo desasignar.");
    }
  };

  const softDelete = async (c) => {
    if (!canDelete(c)) return;
    const ok = window.confirm("¿Querés ocultar esta conversación de la lista?");
    if (!ok) return;

    try {
      await updateDoc(doc(db, "conversations", c.id), {
        deletedAt: Date.now(),
        deletedByUid: user?.uid || null,
        deletedByName: user?.displayName || user?.email || "Agente",
      });

      applyLocalPatch(c.id, {
        deletedAt: Date.now(),
        deletedByUid: user?.uid || null,
        deletedByName: user?.displayName || user?.email || "Agente",
      });
    } catch (e) {
      console.error("softDelete error", e);
      alert("No se pudo ocultar la conversación.");
    }
  };

  /* =========================
     Base query privada
  ========================= */
  useEffect(() => {
    if (!waPhoneId) {
      setItems([]);
      setLoading(false);
      setHasMore(false);
      lastDocRef.current = null;
      return;
    }

    setLoading(true);
    setHasMore(true);
    lastDocRef.current = null;

    const pageSize = 30;

    const qRef = query(
      collection(db, "conversations"),
      where("lastInboundPhoneId", "==", String(waPhoneId)),
      orderBy("lastMessageAt", "desc"),
      orderBy(documentId()),
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
          if (lastVisible) lastDocRef.current = lastVisible;

          const rows = docs.map((d) => ({ id: d.id, ...d.data(), contact: null }));
          const ids = rows.map((r) => r.id);

          let contactsById = {};
          if (ids.length > 0) {
            const results = await Promise.all(
              chunk(ids, 10).map((ids10) =>
                getDocs(
                  query(collection(db, "contacts"), where(documentId(), "in", ids10))
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

          withContacts.sort(
            (a, b) => tsToMillis(b.lastMessageAt) - tsToMillis(a.lastMessageAt)
          );

          const visibleRows = withContacts.filter(isVisibleForPrivateUser);

          setItems(visibleRows);
          await loadSeenFor(visibleRows.map((r) => r.id));

          if (docs.length < pageSize) setHasMore(false);
        } catch (e) {
          console.error("onSnapshot inbox-privado error:", e);
        } finally {
          setLoading(false);
        }
      },
      (err) => {
        console.error("onSnapshot(conversations inbox-privado) error:", err);
        setLoading(false);
      }
    );

    return () => {
      if (unsubRef.current) {
        unsubRef.current();
        unsubRef.current = null;
      }
    };
  }, [waPhoneId, currentUid, currentEmail]);

  /* =========================
     Load more
  ========================= */
  const loadMore = async () => {
    if (isLoadingMore || !hasMore) return;
    if (search.trim()) return;
    if (!waPhoneId) return;

    const pageSize = 30;
    const cursor = lastDocRef.current;
    if (!cursor) return;

    setIsLoadingMore(true);

    try {
      const qBase = query(
        collection(db, "conversations"),
        where("lastInboundPhoneId", "==", String(waPhoneId)),
        orderBy("lastMessageAt", "desc"),
        orderBy(documentId()),
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

      const visibleRows = withContacts.filter(isVisibleForPrivateUser);

      setItems((prev) => {
        const existingIds = new Set(prev.map((x) => String(x.id)));
        const appended = [...prev];
        for (const r of visibleRows) {
          if (!existingIds.has(String(r.id))) appended.push(r);
        }
        appended.sort((a, b) => tsToMillis(b.lastMessageAt) - tsToMillis(a.lastMessageAt));
        return appended;
      });

      lastDocRef.current = snap.docs[snap.docs.length - 1] || lastDocRef.current;

      await loadSeenFor(visibleRows.map((r) => r.id));

      if (snap.size < pageSize) setHasMore(false);
    } catch (e) {
      console.error("loadMore error:", e);
    } finally {
      setIsLoadingMore(false);
    }
  };

  /* =========================
     IntersectionObserver
  ========================= */
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || loading) return;

    const rootEl = listScrollRef.current || null;
    const io = new IntersectionObserver(
      (entries) => {
        const first = entries[0];
        if (first?.isIntersecting) loadMore();
      },
      { root: rootEl, rootMargin: "1000px 0px 1000px 0px", threshold: 0.01 }
    );

    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasMore, isLoadingMore, search, loading, waPhoneId]);

  /* =========================
     Filtros / tabs
  ========================= */
  const baseVisibleItems = useMemo(() => {
    return items.filter((c) => !c.deletedAt);
  }, [items]);

  const availableLabels = useMemo(() => {
    const set = new Set();
    for (const c of baseVisibleItems) {
      if (Array.isArray(c.labels)) {
        for (const slug of c.labels) set.add(String(slug));
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "es"));
  }, [baseVisibleItems]);

  const filteredByText = useMemo(() => {
    const qText = search.trim().toLowerCase();
    if (!qText) return baseVisibleItems;

    return baseVisibleItems.filter((c) => {
      const name = String(getDisplayName(c) || "").toLowerCase();
      const id = String(c.id || "").toLowerCase();
      const phone = String(c.contact?.phone || c.contactId || "").toLowerCase();
      const lastText = String(c.lastMessageText || "").toLowerCase();
      const labels = Array.isArray(c.labels) ? c.labels.join(" ").toLowerCase() : "";

      return (
        name.includes(qText) ||
        id.includes(qText) ||
        phone.includes(qText) ||
        lastText.includes(qText) ||
        labels.includes(qText)
      );
    });
  }, [baseVisibleItems, search]);

  const displayItems = useMemo(() => {
    let out = [...filteredByText];

    if (tab === "mine") {
      out = out.filter((c) => isMine(c));
    } else if (tab === "favorites") {
      out = out.filter((c) => isStarred(c));
    } else if (tab === "labels") {
      if (selectedLabel !== "__all__") {
        out = out.filter((c) =>
          Array.isArray(c.labels) &&
          c.labels.map(normSlug).includes(normSlug(selectedLabel))
        );
      }
    }

    if (showOnlyUnassigned) {
      out = out.filter((c) => !c.assignedToUid && !c.assignedToEmail);
    }

    if (showOnlyUnread) {
      out = out.filter((c) => isUnread(c));
    }

    out.sort((a, b) => tsToMillis(b.lastMessageAt) - tsToMillis(a.lastMessageAt));
    return out;
  }, [
    filteredByText,
    tab,
    selectedLabel,
    showOnlyUnassigned,
    showOnlyUnread,
    seenTick,
  ]);

  const unreadCount = useMemo(
    () => filteredByText.filter((c) => isUnread(c)).length,
    [filteredByText, seenTick]
  );

  const unassignedCount = useMemo(
    () => filteredByText.filter((c) => !c.assignedToUid && !c.assignedToEmail).length,
    [filteredByText]
  );

  const favoritesCount = useMemo(
    () => filteredByText.filter((c) => isStarred(c)).length,
    [filteredByText, user?.uid]
  );

  const myCount = useMemo(
    () => filteredByText.filter((c) => isMine(c)).length,
    [filteredByText, currentUid, currentEmail]
  );

  const tryOpen = (c) => {
    markSeen(c);
    onSelect?.(c.id);
  };

  /* =========================
     Render
  ========================= */
  if (waLoading) {
    return (
      <div className="flex items-center justify-center h-full text-sm opacity-70">
        Cargando inbox…
      </div>
    );
  }

  if (!waPhoneId) {
    return (
      <div className="flex items-center justify-center h-full px-4 text-sm text-center opacity-70">
        No hay <b className="mx-1">waPhoneId</b> configurado para este usuario.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 border-r border-base-300 bg-base-200">
      <div className="sticky top-0 z-10 border-b border-base-300 bg-base-200/95 backdrop-blur-sm">
        <div className="px-2 py-2 border-b border-base-300">
          <div className="text-sm font-semibold">
            {title} — WABA: <span className="font-mono">{String(waPhoneId)}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 px-2 pt-2">
          <button
            onClick={() => setTab("all")}
            className={
              "px-4 py-2 rounded-2xl text-sm font-semibold transition-colors " +
              (tab === "all"
                ? "bg-primary text-primary-content"
                : "bg-base-100 text-base-content hover:bg-base-300")
            }
          >
            Todos
          </button>

          <button
            onClick={() => setTab("mine")}
            className={
              "px-4 py-2 rounded-2xl text-sm font-semibold transition-colors " +
              (tab === "mine"
                ? "bg-primary text-primary-content"
                : "bg-base-100 text-base-content hover:bg-base-300")
            }
          >
            Mis chats
          </button>

          <button
            onClick={() => setTab("favorites")}
            className={
              "px-4 py-2 rounded-2xl text-sm font-semibold transition-colors " +
              (tab === "favorites"
                ? "bg-primary text-primary-content"
                : "bg-base-100 text-base-content hover:bg-base-300")
            }
          >
            Favoritos
          </button>

          <button
            onClick={() => setTab("labels")}
            className={
              "px-4 py-2 rounded-2xl text-sm font-semibold transition-colors " +
              (tab === "labels"
                ? "bg-primary text-primary-content"
                : "bg-base-100 text-base-content hover:bg-base-300")
            }
          >
            Por etiqueta
          </button>

          <div className="flex-1 min-w-[180px]">
            <div className="relative">
              <span className="absolute inset-y-0 flex items-center text-sm left-3 opacity-70">
                🔍
              </span>
              <input
                className="w-full py-2 pl-8 pr-3 text-sm border shadow-sm rounded-2xl border-base-300 bg-base-100 focus:outline-none focus:ring-2 focus:ring-primary/40"
                placeholder="Buscar nombre o número…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 px-2 py-2">
          <button
            onClick={() => setShowOnlyUnassigned((v) => !v)}
            className={
              "px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors " +
              (showOnlyUnassigned
                ? "bg-primary text-primary-content border-primary"
                : "bg-base-100 text-base-content border-base-300 hover:bg-base-300")
            }
          >
            Sin asignar
            <span className="ml-2 px-2 py-0.5 rounded-full bg-base-300/40">
              {unassignedCount}
            </span>
          </button>

          <button
            onClick={() => setShowOnlyUnread((v) => !v)}
            className={
              "px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors " +
              (showOnlyUnread
                ? "bg-primary text-primary-content border-primary"
                : "bg-base-100 text-base-content border-base-300 hover:bg-base-300")
            }
          >
            No leídos
            <span className="ml-2 px-2 py-0.5 rounded-full bg-base-300/40">
              {unreadCount}
            </span>
          </button>

          {tab === "mine" && (
            <span className="px-1 text-xs opacity-70">
              {myCount} asignadas a vos
            </span>
          )}

          {tab === "favorites" && (
            <span className="px-1 text-xs opacity-70">
              {favoritesCount} favoritas
            </span>
          )}
        </div>

        {tab === "labels" && (
          <div className="px-2 pb-2">
            <select
              className="w-full select select-sm select-bordered bg-base-100"
              value={selectedLabel}
              onChange={(e) => setSelectedLabel(e.target.value)}
            >
              <option value="__all__">Todas las etiquetas</option>
              {availableLabels.map((slug) => (
                <option key={slug} value={slug}>
                  {slug}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div ref={listScrollRef} className="flex-1 overflow-y-auto">
        {loading && (
          <>
            <RowSkeleton />
            <RowSkeleton />
            <RowSkeleton />
          </>
        )}

        {!loading &&
          displayItems.map((c) => {
            const rowIsActive = String(c.id) === String(activeId || "");
            const showNew = !rowIsActive && isUnread(c);
            const assignedToMe = isMine(c);
            const slugs = Array.isArray(c.labels) ? c.labels : [];

            return (
              <div
                key={c.id}
                onClick={() => tryOpen(c)}
                title={c.id}
                className={
                  "px-3 py-3 border-b border-base-300 cursor-pointer transition-colors " +
                  (rowIsActive
                    ? "bg-primary/10 border-l-4 border-l-primary"
                    : "bg-base-100 hover:bg-base-200")
                }
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start flex-1 min-w-0 gap-3">
                    <Avatar c={c} />

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center min-w-0 gap-2">
                        <div
                          className={
                            "font-mono text-sm truncate " +
                            (assignedToMe
                              ? "font-extrabold text-primary"
                              : "font-semibold text-base-content")
                          }
                        >
                          {getDisplayName(c)}
                        </div>

                        {assignedToMe && (
                          <span
                            className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-primary text-primary-content"
                            title="Asignado a mí"
                          >
                            MÍO
                          </span>
                        )}

                        {!assignedToMe && (c.assignedToUid || c.assignedToEmail) && (
                          <span
                            className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-base-300 text-base-content"
                            title={`Asignado a ${c.assignedToName || c.assignedToEmail || c.assignedToUid}`}
                          >
                            OCUPADA
                          </span>
                        )}

                        {showNew && (
                          <span
                            className="inline-block w-2.5 h-2.5 rounded-full bg-primary animate-pulse"
                            title="No leído"
                          />
                        )}
                      </div>

                      {c.lastMessageText && (
                        <div
                          className={
                            "mt-1 text-xs line-clamp-2 " +
                            (assignedToMe ? "text-base-content font-medium" : "opacity-70")
                          }
                        >
                          {c.lastMessageText}
                        </div>
                      )}

                      <div className="flex flex-wrap items-center mt-1 gap-x-2 gap-y-1">
                        <span
                          className={
                            "text-[11px] " + (showNew ? "text-primary font-semibold" : "opacity-70")
                          }
                        >
                          {formatShort(c.lastMessageAt)}
                        </span>

                        {(c.contact?.phone || c.contactId) && (
                          <span
                            className="px-2 py-0.5 text-[10px] rounded-full border border-base-300 bg-base-100"
                            title="Número"
                          >
                            {c.contact?.phone || c.contactId}
                          </span>
                        )}
                      </div>

                      <div className="mt-1">
                        <LabelChips slugs={slugs} />
                      </div>

                      <div className="mt-1 text-[11px] opacity-70">
                        {c.assignedToUid || c.assignedToEmail ? (
                          <span>
                            Asignado a{" "}
                            <b className="text-base-content">
                              {assignedToMe
                                ? "mí"
                                : c.assignedToName || c.assignedToEmail || c.assignedToUid}
                            </b>
                          </span>
                        ) : (
                          <span className="italic opacity-70">Sin asignar</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <div className="flex items-center gap-2">
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
                      ) : c.assignedToUid || c.assignedToEmail ? (
                        <button
                          className="px-3 py-1 text-[11px] font-semibold rounded-full bg-base-200 opacity-60 border border-base-300 cursor-not-allowed"
                          disabled
                          onClick={(e) => e.stopPropagation()}
                          title={`Asignada a ${c.assignedToName || c.assignedToEmail || "otro agente"}`}
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

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleStar(c);
                        }}
                        className="w-8 h-8 text-sm border rounded-full border-base-300 bg-base-100 hover:bg-base-200"
                        title={isStarred(c) ? "Quitar de favoritos" : "Agregar a favoritos"}
                      >
                        {isStarred(c) ? "★" : "☆"}
                      </button>
                    </div>

                    {canDelete(c) && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          softDelete(c);
                        }}
                        className="px-2 py-1 text-[10px] rounded-full border border-error/40 text-error hover:bg-error/10"
                        title="Ocultar conversación"
                      >
                        Ocultar
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

        {!loading && displayItems.length === 0 && (
          <div className="px-4 py-8 text-sm text-center opacity-70">
            No hay conversaciones para este inbox.
          </div>
        )}

        {!loading && <div ref={sentinelRef} className="h-8" />}

        {!loading && (
          <div className="py-3 text-xs text-center opacity-70">
            {isLoadingMore && <div>Cargando más…</div>}
            {!isLoadingMore && !hasMore && <div>Fin de la lista</div>}
          </div>
        )}
      </div>
    </div>
  );
}