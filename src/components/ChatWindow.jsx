// src/components/ChatWindow.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  arrayRemove,
  arrayUnion,
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  deleteDoc, // << añadido
} from "firebase/firestore";
import { db } from "../firebase";
import { useAuthState } from "../hooks/useAuthState.js";
import { sendMessage } from "../services/api";
import { uploadFile } from "../services/storage";

import TemplatesPicker from "./TemplatesPicker.jsx";
import StagePicker from "./StagePicker.jsx";
import QuickRepliesBar from "./QuickRepliesBar.jsx";
import ClientProfile from "./ClientProfile.jsx";
import TagsMenu from "./TagsMenu.jsx";
import AudioRecorderButton from "./AudioRecorderButton.jsx";
import StarButton from "./StarButton.jsx";
import ChatDestacadosPanel from "./ChatDestacadosPanel.jsx";
import { listLabels } from "../lib/labels";

// Íconos
import {
  FileText,
  Image as ImageIcon,
  FileAudio2,
  Paperclip,
  Send as SendIcon,
  Tags as TagsIcon,
  UserRound,
  Smile,
  ExternalLink,
  Edit3,   // << añadidos
  Trash2,  // << añadidos
  Check,   // << añadidos
  X,       // << añadidos
  CornerUpLeft,
} from "lucide-react";

// === DEBUG WhatsApp ===
function logWaSendOutcome(label, apiResp, payload, extra = {}) {
  const r = apiResp?.results?.[0] || {};
  const code = r?.error?.error?.code ?? r?.error?.code ?? null;
  const err  = r?.error?.error ?? r?.error ?? null;

  console.groupCollapsed(
    `%c[WA DEBUG] ${label} — ok:${apiResp?.ok ? "✅" : "❌"} code:${code ?? "-"}`,
    "color:#0aa"
  );
  console.log("→ payload.template", payload?.template);
  console.log("→ apiResp", apiResp);
  console.log("→ result", r);
  console.log("→ error.code", code, "error.obj", err);
  console.log("→ extras", extra);
  if (code === 131042) {
    console.warn("⚠️ Problema de pago (131042): revisar Pagos en Business Manager (producto WhatsApp).");
  }
  console.groupEnd();
}

// =========================
// PREVIEW FIX — mediaUrl resolver
// Prioridad: media.url → media.link → (top-level) url/fileUrl → mediaUrl → image.link/url → audio.link/url
// =========================
function resolveMediaUrl(m) {
  if (!m || typeof m !== "object") return null;

  let url =
    m?.media?.url ||
    m?.media?.link ||
    m?.url || // salientes (top-level)
    m?.fileUrl || // salientes (top-level alternativo)
    m?.mediaUrl ||
    m?.document?.link ||
    m?.document?.url ||
    m?.image?.link ||
    m?.image?.url ||
    m?.audio?.link ||
    m?.audio?.url ||
    null;

  if (typeof url === "string") {
    // Normalizar string (espacios/line breaks/comillas perdidas)
    url = url.replace(/\s+/g, " ").trim();
    if (
      (url.startsWith('"') && url.endsWith('"')) ||
      (url.startsWith("'") && url.endsWith("'"))
    ) {
      url = url.slice(1, -1);
    }
  }

  // FIX dominio bucket mal formateado detectado en logs anteriores
  if (url && typeof url === "string" && url.includes("crmsistem-d3009.fir")) {
    url = url.replace(
      /crmsistem-d3009\.fir[^/]*/,
      "crmsistem-d3009.firebasestorage.app"
    );
  }

  return url || null;
}

// ---------- helpers ----------
function formatTs(ts) {
  const d = ts?.toDate ? ts.toDate() : ts ? new Date(ts) : null;
  return d ? d.toLocaleString() : "";
}




function emailHandle(v) {
  const s = String(v || "");
  const i = s.indexOf("@");
  return i > 0 ? s.slice(0, i) : s;
}

// Limpia nombres tipo "hola hola", "¡hola!" etc.
function cleanClientName(n) {
  let s = String(n || "").trim();
  // sacamos saludos iniciales repetidos y signos
  s = s.replace(/^[¡!]*\s*hola+\s*/i, ""); // "hola", "¡hola", "hola!"
  s = s.replace(/^\s*hola+\s*/i, "");      // otro intento por si queda doble
  // colapsamos espacios extra
  s = s.replace(/\s+/g, " ").trim();
  return s || "!";
}

// --- helpers locales (no mover a otros archivos) ---
// --- helpers (arriba del archivo) ---
const SELLER_NAME_MAP = {
  "lunacami00@gmail.com": "Camila",
  "escalantefr.p@gmail.com": "Fernando",
  "julicisneros.89@gmail.com": "Juliana",
};

const prettifyLocal = (email = "") =>
  (email.split("@")[0] || "")
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map(w => (w ? w[0].toUpperCase() + w.slice(1) : ""))
    .join(" ");

const getSellerDisplayName = (user = {}) => {
  const email = String(user.email || "").toLowerCase().trim();
  const alias = (user.alias || "").trim();
  const name  = (user.name  || "").trim();
  if (alias) return alias;
  if (name) return name;
  if (email && SELLER_NAME_MAP[email]) return SELLER_NAME_MAP[email];
  if (email) return prettifyLocal(email);
  return "Equipo de Ventas";
};

// evita parámetros vacíos que disparan 131008
const safeParam = (v) => {
  const s = (v ?? "").toString();
  return s.trim() ? s : "\u200B"; // Zero-Width Space
};


// Prioriza nombre del CRM o el de perfil WA que llega en webhooks
const getClientName = (contact = {}, raw = {}) => {
  const crm = (contact.displayName || contact.name || "").trim();
  const waProfile = raw?.entry?.[0]?.changes?.[0]?.value?.contacts?.[0]?.profile?.name || "";
  return (crm || waProfile || "").trim();
};

// Detecta si un mensaje es saliente (mío)
function isOutgoingMessage(m, user) {
  if (typeof m?.direction === "string") return m.direction === "out";
  if (typeof m?.from === "string") {
    const f = m.from.toLowerCase();
    if (
      f === "me" ||
      f === "agent" ||
      f === (user?.uid || "").toLowerCase() ||
      f === (user?.email || "").toLowerCase()
    ) {
      return true;
    }
  }
  if (typeof m?.author === "string") {
    const a = m.author.toLowerCase();
    if (
      a === "me" ||
      a === (user?.uid || "").toLowerCase() ||
      a === (user?.email || "").toLowerCase()
    ) {
      return true;
    }
  }
  return false;
}

// Texto visible robusto (WhatsApp a veces lo guarda en text.body / message.text.body / raw.* / caption)
function getVisibleText(m) {
  if (!m) return "";

  // 1) ¿Es mensaje de plantilla?
  const asTemplate =
    m?.type === "template" ||
    m?.message?.type === "template" ||
    m?.raw?.type === "template" ||
    !!m?.template ||
    !!m?.message?.template ||
    !!m?.raw?.template ||
    !!m?.raw?.messages?.[0]?.template;

  if (asTemplate) {
    // 1.a) Nombre de la plantilla (en varias rutas)
    let name =
      m?.template?.name ||
      m?.message?.template?.name ||
      m?.raw?.template?.name ||
      m?.raw?.messages?.[0]?.template?.name ||
      m?.raw?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.template?.name ||
      "";
    if (!name && typeof m?.template === "string") name = m.template;

    // 1.b) Parámetros del body (varias rutas)
    const params =
      m?.template?.components?.[0]?.parameters ||
      m?.message?.template?.components?.[0]?.parameters ||
      m?.raw?.template?.components?.[0]?.parameters ||
      m?.raw?.messages?.[0]?.template?.components?.[0]?.parameters ||
      m?.raw?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.template?.components?.[0]?.parameters ||
      [];

    const pText = (i) => (typeof params?.[i]?.text === "string" ? params[i].text : "");

    // === igual que tenés hoy: normalizador con mapa por email ===
    const normalizeSeller = (val) => {
      const s = (val || "").toString().trim();
      if (!s) return "Equipo de Ventas";
      if (s.includes("@")) {
        const email = s.toLowerCase();
        if (SELLER_NAME_MAP[email]) return SELLER_NAME_MAP[email];
        return prettifyLocal(email);
      }
      return s;
    };

    // 1.c) Reconstrucción especial para HSM reengage (2–3 vars)
    const looksLikeReengage =
      name === "reengage_free_text" || (params?.length >= 2 && params?.length <= 3);

    if (looksLikeReengage) {
      const cliente  = pText(0) || "";
      const vendedor = normalizeSeller(pText(1)); // ← aplica mapa aquí
      const marca    = "HogarCril";               // fijo

      const saludo = cliente ? `¡Hola ${cliente}!` : `¡Hola!`;
      return (
        `${saludo} Soy ${vendedor} de ${marca}.\n` +
        `Te escribo para retomar tu consulta ya que pasaron más de 24 horas desde el último mensaje.\n` +
        `Respondé a este mensaje para continuar la conversación.`
      );
    }

    // 1.d) Preview genérico para el resto de plantillas
    const parts = params
      .map((p) => (typeof p?.text === "string" ? p.text : ""))
      .filter(Boolean);
    const label = name ? `Plantilla ${name}` : "Plantilla";
    return parts.length ? `[${label}] ${parts.join(" • ")}` : `[${label}]`;
  }

  // 0) Solo si NO es plantilla, usar preview del backend
  if (typeof m?.textPreview === "string" && m.textPreview.trim()) {
    return m.textPreview.trim();
  }

  // 2) Texto normal / caption
  const candidates = [
    typeof m?.text === "string" ? m.text : null,
    m?.text?.body,
    m?.message?.text?.body,
    m?.message?.body,
    m?.body,
    m?.caption,
    m?.raw?.text?.body,
    m?.raw?.message?.text?.body,
  ].filter(Boolean);

  if (candidates.length > 0) return String(candidates[0]);
  if (typeof m?.text === "object") return JSON.stringify(m.text || "");
  return "";
}



// Subcomponente para mensajes de ubicación (entrantes)
// Subcomponente para mensajes de ubicación (entrantes) con fallback a iframe
function LocationBubble({ m }) {
  const [imgError, setImgError] = React.useState(false);
  const loc = m?.location || {};
  const lat = Number(loc.lat ?? loc.latitude);
  const lng = Number(loc.lng ?? loc.longitude);
  const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);

  const mapsUrl =
    loc.url || (hasCoords ? `https://www.google.com/maps?q=${lat},${lng}` : null);

  // 1) Google Static Maps (si hay key)
  const gKey = import.meta?.env?.VITE_GOOGLE_STATIC_MAPS_KEY;
  const size = "480x240";
  const googleStaticUrl =
    hasCoords && gKey
      ? `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=15&size=${size}&markers=${lat},${lng}&key=${gKey}`
      : null;

  // 2) OSM Static como fallback (sin iframe)
  const osmStaticUrl =
    hasCoords
      ? `https://staticmap.openstreetmap.de/staticmap.php?center=${lat},${lng}&zoom=15&size=${size}&maptype=mapnik&markers=${lat},${lng},lightblue1`
      : null;

  // decidimos qué imagen intentar
  const staticUrl = googleStaticUrl || osmStaticUrl;

  return (
    <div className="rounded-xl border border-[#CDEBD6] bg-white px-3 py-2 text-sm max-w-xs">
      <div className="mb-1 font-medium">📍 Ubicación</div>

      {loc.name && <div className="truncate">{loc.name}</div>}
      {loc.address && <div className="truncate text-black/70">{loc.address}</div>}

      {hasCoords && (
        <div className="mt-1 text-xs text-black/60">
          {lat.toFixed(5)}, {lng.toFixed(5)}
        </div>
      )}

      {/* Preview SOLO imagen (sin iframe). Si falla, se oculta */}
      {hasCoords && staticUrl && !imgError && (
        <a
          href={mapsUrl || staticUrl}
          target="_blank"
          rel="noreferrer"
          title="Abrir en el mapa"
          className="block mt-2"
        >
          <img
            src={staticUrl}
            alt="Mapa de ubicación"
            className="w-full h-auto rounded-lg border border-black/10"
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setImgError(true)}
          />
        </a>
      )}

      {/* Si no hay imagen o falló, solo dejamos el link */}
      {mapsUrl && (
        <a
          className="inline-flex items-center gap-1 mt-2 text-xs underline text-[#2E7D32]"
          href={mapsUrl}
          target="_blank"
          rel="noreferrer"
          title="Abrir en Google Maps"
        >
          Ver en Maps
        </a>
      )}
    </div>
  );
}

// ===== Ventana 24 h =====
const OUTSIDE_MS = 24 * 60 * 60 * 1000 - 10 * 60 * 1000; // margen 10'
function toMillisMaybe(ts) {
  if (!ts) return 0;
  if (typeof ts === "number") return ts;
  if (typeof ts?.toMillis === "function") return ts.toMillis();
  const d = Date.parse(ts);
  return Number.isFinite(d) ? d : 0;
}
function isOutside24h(lastInboundAt) {
  const ms = toMillisMaybe(lastInboundAt);
  if (!ms) return true; // si no sabemos, asumimos fuera para no fallar
  return Date.now() - ms > OUTSIDE_MS;
}

// === Reengage Template (env) ===
const REENGAGE_TEMPLATE = import.meta.env.VITE_WA_REENGAGE_TEMPLATE || "reengage_free_text";
const REENGAGE_LANG = import.meta.env.VITE_WA_REENGAGE_LANG || "es_AR";
const BRAND_NAME = import.meta.env.VITE_BRAND_NAME || "Tu Comercio";

// Construye payload de plantilla con 3 parámetros: {{1}} cliente, {{2}} vendedor, {{3}} marca
function buildReengageTemplate({ contact, sellerUser, rawWebhookSnapshot /*, freeText*/ }) {
  // {{1}}: si hay nombre → "Andrea", si no → "" (la plantilla debe quedar como "Hola {{1}}!")
  const p1 = (getClientName(contact || {}, rawWebhookSnapshot) || "\u200B").trim();
  // {{2}}: nombre humano del vendedor (alias/name o “cameleado” desde email)
  const p2 = getSellerDisplayName(sellerUser);
  // {{3}}: marca fija
  const p3 = "HogarCril";

  return {
    name: REENGAGE_TEMPLATE,
    language: { code: REENGAGE_LANG },
    components: [
      {
        type: "body",
        parameters: [
          { type: "text", text: p1 }, // {{1}}
          { type: "text", text: p2 }, // {{2}}
          { type: "text", text: p3 }, // {{3}}
          // si más adelante querés volver a usar freeText como {{4}}, lo agregás acá
          // { type: "text", text: (freeText || "").trim() || "¿Seguimos con tu consulta?" }
        ],
      },
    ],
  };
}
export default function ChatWindow({ conversationId, onBack }) {
  const { user } = useAuthState();
  const navigate = useNavigate();

  // ---- state ----
  const [msgs, setMsgs] = useState([]);
  const [sending, setSending] = useState(false);
  const [text, setText] = useState("");

  // Estados para paginación de mensajes
  const [messageLimit, setMessageLimit] = useState(50);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);

  // Estados para archivos seleccionados (envío manual)
  const [selectedImage, setSelectedImage] = useState(null);
  const [selectedAudio, setSelectedAudio] = useState(null);
  const [selectedDoc, setSelectedDoc] = useState(null);

  const [convSlugs, setConvSlugs] = useState([]);
  const [allLabels, setAllLabels] = useState([]);

  const [contact, setContact] = useState(null);
  const [convMeta, setConvMeta] = useState(null);

  const [showProfile, setShowProfile] = useState(false);
  const [showTags, setShowTags] = useState(false);
  const [tab, setTab] = useState("chat");
  const [showAttachMenu, setShowAttachMenu] = useState(false);

  // EMOJI PICKER
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  // Modal imagen
  const [imagePreviewUrl, setImagePreviewUrl] = useState(null);

  // --- edición/eliminación de mensajes (solo salientes) ---
  const [editingMessageId, setEditingMessageId] = useState(null);
  const [editingText, setEditingText] = useState("");

  // --- reply state ---
  const [replyTo, setReplyTo] = useState(null); // { id, type, textPreview, mediaUrl, isOut }

  // UX: prevenir doble click en "Vendido"
  const [savingSold, setSavingSold] = useState(false);

  // ---- refs ----
  const viewportRef = useRef(null);
  const textareaRef = useRef(null);
  const imageInputRef = useRef(null);
  const audioInputRef = useRef(null);
  const docInputRef = useRef(null);
  const attachBtnRef = useRef(null);
  const emojiPickerRef = useRef(null);
  const emojiBtnRef = useRef(null); // ref del botón de emojis

  const didInitialAutoScroll = useRef(false);

  // limpiar al cambiar chat
  useEffect(() => {
    setMsgs([]);
    setConvSlugs([]);
    setContact(null);
    setConvMeta(null);
    setText("");
    setReplyTo(null);
    setTab("chat");
    setShowAttachMenu(false);
    setShowEmojiPicker(false);
    // Resetear estados de paginación
    setMessageLimit(50);
    setHasMoreMessages(false);
    // Limpiar archivos seleccionados
    setSelectedImage(null);
    setSelectedAudio(null);
    setSelectedDoc(null);
    // Cerrar edición
    setEditingMessageId(null);
    setEditingText("");
    didInitialAutoScroll.current = false;
    requestAnimationFrame(() => viewportRef.current?.scrollTo({ top: 0 }));
  }, [conversationId]);

  // etiquetas
  useEffect(() => {
    (async () => {
      try {
        const arr = await listLabels();
        setAllLabels(arr || []);
      } catch {
        setAllLabels([]);
      }
    })();
  }, []);

  const labelBySlug = useMemo(() => {
    const map = new Map();
    for (const l of allLabels) map.set(l.slug, l);
    return map;
  }, [allLabels]);

  const getLabel = (slug) =>
    labelBySlug.get(slug) || { name: slug, slug, color: "neutral" };

  // meta conversación
  useEffect(() => {
    if (!conversationId) return;
    const unsub = onSnapshot(
      doc(db, "conversations", String(conversationId)),
      (snap) => {
        const data = snap.data() || {};
        setConvSlugs(Array.isArray(data.labels) ? data.labels : []);
        setConvMeta(data || null);
      },
      (err) => console.error("onSnapshot(conversation) error:", err)
    );
    return () => unsub();
  }, [conversationId]);

  // contacto
  useEffect(() => {
    (async () => {
      try {
        if (!conversationId) {
          setContact(null);
          return;
        }
        const c = await getDoc(doc(db, "contacts", String(conversationId)));
        setContact(c.exists() ? c.data() : null);
      } catch (e) {
        console.error("get contact error:", e);
      }
    })();
  }, [conversationId]);

  // permisos
  const isAdmin =
    !!user?.email &&
    ["federudiero@gmail.com", "alainismael95@gmail.com", "fede_rudiero@gmail.com"].includes(user.email);

  const canRead = useMemo(() => {
    const assignedToUid = convMeta?.assignedToUid || null;
    const assignedEmail =
      convMeta?.assignedToEmail || convMeta?.assignedEmail || null;
    const assignedList = Array.isArray(convMeta?.assignedTo)
      ? convMeta.assignedTo
      : [];

    if (isAdmin) return true;

    const meUid = user?.uid || "";
    const meEmail = (user?.email || "").toLowerCase();

    if (!assignedToUid && !assignedEmail && assignedList.length === 0)
      return false;

    const emailMatches =
      typeof assignedEmail === "string" &&
      assignedEmail.toLowerCase() === meEmail;

    const listMatches = assignedList.some((x) => {
      const s = String(x || "");
      return s === meUid || s.toLowerCase() === meEmail;
    });

    return (
      (assignedToUid && assignedToUid === meUid) ||
      emailMatches ||
      listMatches
    );
  }, [
    convMeta?.assignedToUid,
    convMeta?.assignedToEmail,
    convMeta?.assignedEmail,
    convMeta?.assignedTo,
    user?.uid,
    user?.email,
    isAdmin,
  ]);

  const canWrite = useMemo(() => {
    if (!canRead) return false;
    return true;
  }, [canRead]);

  // mensajes (escuchar ambas subcolecciones y mergear)
  useEffect(() => {
    if (!conversationId || !canRead) {
      setMsgs([]);
      return;
    }

    const colA = collection(db, "conversations", String(conversationId), "messages");
    const colB = collection(db, "conversations", String(conversationId), "msgs");

    // Aplicar límite a las queries para optimizar la carga
    const qA = query(colA, orderBy("timestamp", "desc"), limit(messageLimit));
    const qB = query(colB, orderBy("timestamp", "desc"), limit(messageLimit));

    let a = [];
    let b = [];

    const applyMerge = () => {
      // merge + dedupe por id
      const map = new Map();
      for (const m of a) map.set(m.id, m);
      for (const m of b) map.set(m.id, m);

      // ordenar por timestamp asc (tolerante a null) para mostrar cronológicamente
      const arr = Array.from(map.values()).sort((m1, m2) => {
        const t1 = m1?.timestamp?.toMillis?.() ?? (m1?.timestamp ? new Date(m1.timestamp).getTime() : 0);
        const t2 = m2?.timestamp?.toMillis?.() ?? (m2?.timestamp ? new Date(m2.timestamp).getTime() : 0);
        return t1 - t2;
      });

      // Verificar si hay más mensajes disponibles
      const totalMessages = a.length + b.length; // eslint-disable-line @typescript-eslint/no-unused-vars
      const uniqueMessages = arr.length;
      setHasMoreMessages(uniqueMessages >= messageLimit && (a.length === messageLimit || b.length === messageLimit));

      setMsgs(arr);
    };

    const unsubA = onSnapshot(
      qA,
      (snap) => {
        // << añadido __col para saber de qué subcolección viene el doc
        a = snap.docs.map((d) => ({ id: d.id, __col: "messages", ...d.data() }));
        applyMerge();
      },
      (err) => console.error("onSnapshot(messages) error:", err)
    );

    const unsubB = onSnapshot(
      qB,
      (snap) => {
        // << añadido __col para saber de qué subcolección viene el doc
        b = snap.docs.map((d) => ({ id: d.id, __col: "msgs", ...d.data() }));
        applyMerge();
      },
      (err) => console.error("onSnapshot(msgs) error:", err)
    );

    return () => {
      unsubA?.();
      unsubB?.();
    };
  }, [conversationId, canRead, messageLimit]);

  useEffect(() => {
    const onEsc = (e) => e.key === "Escape" && setImagePreviewUrl(null);
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, []);

  // auto-scroll
  const scrollToBottom = (behavior = "auto") => {
    const el = viewportRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight + 9999, behavior });
  };

  // ====== Reply helpers ======
  const beginReplyTo = (m) => {
    try {
      const isOut = isOutgoingMessage(m, user);
      const mediaUrl = resolveMediaUrl(m);
      const type = m?.media?.kind || m?.mediaKind || m?.type || (m?.document ? "document" : m?.image ? "image" : m?.audio ? "audio" : "text");
      const visibleText = getVisibleText(m);
      setReplyTo({
        id: m.id,
        type,
        textPreview: (visibleText || (type === "image" ? "Imagen" : type === "audio" ? "Audio" : type === "document" ? "Documento" : "")) || "",
        mediaUrl: mediaUrl || null,
        isOut,
      });
      requestAnimationFrame(() => textareaRef.current?.focus());
    } catch { /* noop */ }
  };

  const cancelReplyTo = () => setReplyTo(null);

  useEffect(() => {
    if (tab !== "chat") return;
    const el = viewportRef.current;
    if (!el) return;
    if (msgs.length === 0) return;

    const nearBottom =
      el.scrollTop + el.clientHeight >= el.scrollHeight - 120;

    if (!didInitialAutoScroll.current) {
      didInitialAutoScroll.current = true;
      const overflows = el.scrollHeight > el.clientHeight + 8;
      if (overflows) scrollToBottom("auto");
      return;
    }

    if (nearBottom) scrollToBottom("smooth");
  }, [msgs, tab]);

  // Función para cargar más mensajes
  const loadMoreMessages = () => {
    setMessageLimit(prev => prev + 50);
  };

  // UI helpers
  const removeTag = async (slug) => {
    if (!conversationId || !slug) return;
    try {
      await updateDoc(doc(db, "conversations", String(conversationId)), {
        labels: arrayRemove(slug),
      });
    } catch {
      alert("No se pudo quitar la etiqueta.");
    }
  };

  const onMsgKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      doSend();
    }
  };

  // autoresize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    const h = Math.min(160, Math.max(36, el.scrollHeight));
    el.style.height = h + "px";
  }, [text]);

  // contexto plantillas
  const templateContext = {
    nombre: contact?.name || contact?.fullName || "",
    vendedor: user?.displayName || user?.email || "",
    fecha: new Date().toLocaleDateString(),
    link: window?.location?.href || "",
  };

  // quick replies
  const onPickQuick = (t) => {
    if (!t) return;
    setText((prev) => (prev ? prev + (prev.endsWith("\n") ? "" : "\n") + t : t));
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  // =========================
  // EMOJI PICKER — insertar en caret
  // =========================
  const insertEmojiAtCursor = (emoji) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart ?? text.length;
    const end = textarea.selectionEnd ?? text.length;
    const newText = text.slice(0, start) + emoji.native + text.slice(end);
    setText(newText);
    requestAnimationFrame(() => {
      const p = start + emoji.native.length;
      textarea.setSelectionRange(p, p);
      textarea.focus();
    });
  };
  const handleEmojiSelect = (emoji) => {
    insertEmojiAtCursor(emoji);
    setShowEmojiPicker(false);
  };

  // ======= Edición/Eliminación salientes =======
  const beginEditMessage = (m) => {
    if (!isOutgoingMessage(m, user) || !canWrite) return;
    setEditingText(getVisibleText(m));
    setEditingMessageId(m.id);
  };

  const cancelEditMessage = () => {
    setEditingMessageId(null);
    setEditingText("");
  };

  const saveEditMessage = async () => {
    try {
      if (!conversationId || !editingMessageId) return;
      const m = msgs.find((x) => x.id === editingMessageId);
      if (!m) return;
      if (!isOutgoingMessage(m, user) || !canWrite) return;

      const colName = m.__col === "messages" ? "messages" : "msgs";
      const ref = doc(db, "conversations", String(conversationId), colName, String(m.id));
      const newText = (editingText || "").trim();

      await updateDoc(ref, {
        text: newText,                  // modelos simples
        "message.text.body": newText,   // WA nested
        body: newText,                  // fallback
        caption: newText || null,       // si era media con caption
        updatedBy: user?.email || user?.uid || "agent",
        updatedAt: new Date(),
      });

      setEditingMessageId(null);
      setEditingText("");
    } catch (e) {
      alert(e?.message || "No se pudo editar el mensaje.");
    }
  };

  const deleteMessage = async (m) => {
    try {
      if (!conversationId || !m?.id) return;
      if (!isOutgoingMessage(m, user) || !canWrite) return;

      const ok = confirm("¿Eliminar definitivamente este mensaje saliente?");
      if (!ok) return;

      const colName = m.__col === "messages" ? "messages" : "msgs";
      const ref = doc(db, "conversations", String(conversationId), colName, String(m.id));
      await deleteDoc(ref);
    } catch (e) {
      alert(e?.message || "No se pudo eliminar el mensaje.");
    }
  };

  // ======= envío texto y archivos multimedia =======
  const doSend = async () => {
    const body = (text || "").trim();
    const hasText = !!body;
    const hasImage = !!selectedImage;
    const hasAudio = !!selectedAudio;
    const hasDoc = !!selectedDoc;

    // Verificar que hay algo que enviar (texto, imagen o audio)
    if (!conversationId || (!hasText && !hasImage && !hasAudio && !hasDoc) || !canWrite) return;

    // Calcular si estamos fuera de 24 h respecto del último inbound
    const lastInboundAt =
      convMeta?.lastInboundAt ??
      convMeta?.lastInboundMessageAt ??
      convMeta?.lastMessageInboundAt ??
      convMeta?.lastMessageAt; // fallback (menos preciso)

    const outside = isOutside24h(lastInboundAt);
  const sellerUser = {
    alias: convMeta?.assignedToName || "",
    name: user?.displayName || user?.name || "",
    email: user?.email || "",
  };
  const sellerName = getSellerDisplayName(sellerUser);



    // Limpiar estados inmediatamente
    setText("");
    const imageToSend = selectedImage;
    const audioToSend = selectedAudio;
    const docToSend = selectedDoc;
    setSelectedImage(null);
    setSelectedAudio(null);
    setSelectedDoc(null);

    requestAnimationFrame(() => textareaRef.current?.focus());

    try {
      // 1) Enviar TEXT o TEMPLATE (según ventana)
      if (hasText) {
       if (outside) {
  const rawWebhookSnapshot = (() => {
    try {
      for (const m of msgs) {
        if (!isOutgoingMessage(m, user) && m?.raw) return m.raw;
      }
      return null;
    } catch { return null; }
  })();
  const templatePayload = buildReengageTemplate({
    contact,
    sellerUser,
    rawWebhookSnapshot,
  });

          const tplRes = await sendMessage({
            to: String(conversationId),
            conversationId,
            sellerName,
            template: templatePayload,
          });

          logWaSendOutcome("auto-24h", tplRes, { template: templatePayload }, {
            conversationId,
            outside,
            sellerName,
            brandName: "HogarCril",
          });

          const serverConvId = tplRes?.results?.[0]?.to;
          if (serverConvId && serverConvId !== conversationId) {
            navigate(`/app/${encodeURIComponent(serverConvId)}`, { replace: true });
          }
          if (tplRes && tplRes.ok === false) {
            const err = tplRes?.results?.[0]?.error;
            const code = err?.error?.code ?? err?.code ?? "";
            alert(`No se pudo enviar la plantilla.\nCódigo: ${code || "desconocido"}`);
            if (code === 131042) {
              alert("Problema de pago en WhatsApp (131042). Regularizar método de pago de la cuenta.");
            }
          }
        } else {
          // Dentro de ventana: texto normal
          const textResult = await sendMessage({
            to: String(conversationId),
            text: body,
            conversationId,
            sellerName,
            ...(replyTo ? { replyTo: { id: replyTo.id, type: replyTo.type, text: replyTo.textPreview } } : {}),
          });
          const serverConvId = textResult?.results?.[0]?.to;
          if (serverConvId && serverConvId !== conversationId) {
            navigate(`/app/${encodeURIComponent(serverConvId)}`, { replace: true });
          }
          if (textResult && textResult.ok === false) {
            const err = textResult?.results?.[0]?.error;
            const code = err?.error?.code ?? err?.code ?? "";
            alert(`No se pudo enviar el texto.\nCódigo: ${code || "desconocido"}`);
          }
        }
      }

      // 2) Enviar imagen (solo si hay)
      if (hasImage && imageToSend) {
        setSending(true);
        const dest = `uploads/${conversationId}/${Date.now()}_${imageToSend.name}`;
        const { url } = await uploadFile(imageToSend, dest);
        const res = await sendMessage({
          to: String(conversationId),
          conversationId,
          sellerName,
          image: { link: url },
          ...(replyTo ? { replyTo: { id: replyTo.id, type: replyTo.type, text: replyTo.textPreview } } : {}),
        });
        if (res && res.ok === false) {
          const err = res?.results?.[0]?.error;
          const code =
            err?.error?.code ??
            err?.code ??
            (typeof err === "string" ? err : "");
          alert(`No se pudo enviar la imagen.\nCódigo: ${code || "desconocido"}`);
        }
      }

      // 3) Enviar audio (solo si hay)
      if (hasAudio && audioToSend) {
        setSending(true);
        const dest = `uploads/${conversationId}/${Date.now()}_${audioToSend.name}`;
        const { url } = await uploadFile(audioToSend, dest);
        const res = await sendMessage({
          to: String(conversationId),
          conversationId,
          sellerName,
          audio: { link: url },
          ...(replyTo ? { replyTo: { id: replyTo.id, type: replyTo.type, text: replyTo.textPreview } } : {}),
        });
        if (res && res.ok === false) {
          const err = res?.results?.[0]?.error;
          const code =
            err?.error?.code ??
            err?.code ??
            (typeof err === "string" ? err : "");
          alert(`No se pudo enviar el audio.\nCódigo: ${code || "desconocido"}`);
        }
      }

      // 4) Enviar documento (solo si hay)
      if (hasDoc && docToSend) {
        setSending(true);
        const dest = `uploads/${conversationId}/${Date.now()}_${docToSend.name}`;
        const { url } = await uploadFile(docToSend, dest, { allowed: [
          "application/pdf",
          "image/jpeg","image/png","image/webp","image/gif",
          "audio/mpeg","audio/ogg","audio/wav","audio/mp4","audio/aac",
        ] });
        const res = await sendMessage({
          to: String(conversationId),
          conversationId,
          sellerName,
          document: { link: url, filename: docToSend?.name || undefined },
          ...(replyTo ? { replyTo: { id: replyTo.id, type: replyTo.type, text: replyTo.textPreview } } : {}),
        });
        if (res && res.ok === false) {
          const err = res?.results?.[0]?.error;
          const code =
            err?.error?.code ??
            err?.code ??
            (typeof err === "string" ? err : "");
          alert(`No se pudo enviar el documento.\nCódigo: ${code || "desconocido"}`);
        }
      }

      scrollToBottom("smooth");
    } catch (e) {
      alert(e?.message || "No se pudo enviar");
    } finally {
      setSending(false);
      setShowAttachMenu(false);
      setReplyTo(null);
    }
  };

  // adjuntos (atajo de picker → sube y envía)
  const handlePickAndSend = async (file, kind /* "image" | "audio" | "document" */) => {
    if (!file || !conversationId || !canWrite) return;
    try {
      setSending(true);
      const dest = `uploads/${conversationId}/${Date.now()}_${file.name}`;
      const { url } = await uploadFile(file, dest);
      const payload =
        kind === "image"
          ? { image: { link: url } }
          : kind === "audio"
          ? { audio: { link: url } }
          : { document: { link: url, filename: file?.name || undefined } };
      await sendMessage({
        to: String(conversationId),
        conversationId,
        sellerName: emailHandle(user?.email || user?.displayName || "Equipo de Ventas"),
        ...payload,
        ...(replyTo ? { replyTo: { id: replyTo.id, type: replyTo.type, text: replyTo.textPreview } } : {}),
      });
      scrollToBottom("smooth");
    } catch (err) {
      alert(err?.message || `No se pudo enviar el ${kind}`);
    } finally {
      setSending(false);
      setShowAttachMenu(false);
      setReplyTo(null);
    }
  };

  const onPickImage = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) {
      setSelectedImage(file);
      setShowAttachMenu(false);
    }
  };

  const onPickAudio = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) {
      setSelectedAudio(file);
      setShowAttachMenu(false);
    }
  };

  const onPickDocument = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) {
      setSelectedDoc(file);
      setShowAttachMenu(false);
    }
  };

  // cerrar menús
  useEffect(() => {
    if (!showAttachMenu) return;
    const onDocClick = (e) => {
      if (!attachBtnRef.current) return;
      const menu = document.getElementById("attach-menu");
      if (
        !attachBtnRef.current.contains(e.target) &&
        menu &&
        !menu.contains(e.target)
      ) {
        setShowAttachMenu(false);
      }
    };
    const onEsc = (e) => e.key === "Escape" && setShowAttachMenu(false);
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [showAttachMenu]);

  // cerrar emoji picker ignorando el botón del propio picker
  useEffect(() => {
    if (!showEmojiPicker) return;
    const onDocClick = (e) => {
      if (!emojiPickerRef.current) return;
      const clickedInsidePanel = emojiPickerRef.current.contains(e.target);
      const clickedOnButton = emojiBtnRef.current?.contains(e.target);
      if (!clickedInsidePanel && !clickedOnButton) setShowEmojiPicker(false);
    };
    const onEsc = (e) => e.key === "Escape" && setShowEmojiPicker(false);
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [showEmojiPicker]);

  // ---------- render ----------

  if (!canRead) {
    return (
      <div className="flex justify-center items-center h-full text-sm text-gray-600">
        No tenés acceso a este chat. Asignate desde la lista.
      </div>
    );
  }

  const phone =
    convMeta?.clientPhone || contact?.phone || String(conversationId || "");
  const contactId = String(conversationId || phone || "");

  // Toggle "Vendido"
  const isSold = Array.isArray(convMeta?.labels) && convMeta.labels.includes("vendido");
  const toggleSold = async () => {
    if (!conversationId || !canWrite) return;
    try {
      setSavingSold(true);
      if (!isSold) {
        await updateDoc(doc(db, "conversations", String(conversationId)), {
          labels: arrayUnion("vendido"),
          soldAt: new Date(),
          soldByUid: user?.uid || null,
          soldByEmail: user?.email || null,
          soldByName: user?.displayName || user?.email || null,
          updatedAt: new Date(),
        });
      } else {
        await updateDoc(doc(db, "conversations", String(conversationId)), {
          labels: arrayRemove("vendido"),
        });
      }
    } catch {
      alert("No se pudo actualizar el estado 'Vendido'.");
    } finally {
      setSavingSold(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 w-full overflow-x-hidden flex-col text-black bg-[#F6FBF7]">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b bg-[#E8F5E9]/90 border-[#CDEBD6] backdrop-blur">
        <div className="px-3 pt-2 pb-2 md:px-4">
          {/* Fila 1 */}
          <div className="flex flex-wrap gap-2 justify-between items-center">
            <div className="flex gap-2 items-center min-w-0">
              {onBack && (
                <button
                  className="btn btn-xs md:hidden"
                  onClick={onBack}
                  title="Volver a la lista"
                >
                  ← Volver
                </button>
              )}
              <div className="min-w-0">
                <div className="text-[11px] md:text-xs">Conversación</div>
                <h2 className="text-base font-semibold truncate md:text-lg">
                  {contact?.name || String(conversationId || "")}
                </h2>
              </div>
            </div>

            <div className="shrink-0">
              <StagePicker
                conversationId={conversationId}
                value={convMeta?.stage}
                className="md:btn-sm btn-xs"
              />
            </div>
          </div>

          {/* Fila 2: Toolbar */}
          <div className="overflow-x-auto -mx-1 mt-2 no-scrollbar">
            <div className="flex gap-2 items-center px-1 snap-x snap-mandatory">
              {/* Plantillas (icon-only) */}
              <div className="snap-start shrink-0">
                <TemplatesPicker
                  mode="modal"
                  anchorToBody
                  backdrop
                  buttonClassName="btn btn-circle btn-sm bg-white text-black hover:bg-[#F1FAF3] border border-[#CDEBD6]"
                  buttonChildren={<FileText className="w-4 h-4" />}
                  onInsert={(txt) => {
                    setText((prev) => (prev ? prev + "\n" + txt : txt));
                    requestAnimationFrame(() => textareaRef.current?.focus());
                  }}
                  context={templateContext}
                  buttonAriaLabel="Plantillas"
                  disabled={!canWrite}
                />
              </div>

              {/* Etiquetas */}
              <button
                className="snap-start btn btn-xs md:btn-sm bg-white text-black hover:bg-[#F1FAF3] border border-[#CDEBD6] gap-2"
                onClick={() => setShowTags(true)}
                title="Etiquetar conversación"
              >
                <TagsIcon className="w-4 h-4" />
                <span className="hidden xs:inline">Etiquetar</span>
              </button>

              {/* Vendido toggle */}
              <button
                className={
                  "snap-start btn btn-xs md:btn-sm gap-2 border " +
                  (isSold
                    ? "bg-green-600 text-white hover:bg-green-700 border-green-700"
                    : "bg-white text-black hover:bg-[#F1FAF3] border-[#CDEBD6]")
                }
                onClick={toggleSold}
                title={isSold ? "Vendido ✓" : "Marcar vendido"}
                disabled={!canWrite || savingSold}
              >
                <span className="hidden xs:inline">{isSold ? "Vendido ✓" : "Marcar vendido"}</span>
              </button>

              {/* Perfil */}
              <button
                className="snap-start btn btn-xs md:btn-sm bg-white text-black hover:bg-[#F1FAF3] border border-[#CDEBD6] gap-2"
                onClick={() => setShowProfile((v) => !v)}
                title="Ver perfil del cliente"
              >
                <UserRound className="w-4 h-4" />
                <span className="hidden xs:inline">Perfil</span>
              </button>
            </div>
          </div>

          {/* Chips de etiquetas */}
          <div className="flex overflow-x-auto gap-2 items-center px-0.5 pb-1 mt-2 no-scrollbar">
            {convSlugs.map((slug) => {
              const l = getLabel(slug);
              return (
                <span
                  key={slug}
                  className={`badge ${"badge-" + l.color} gap-1 border whitespace-nowrap text-black`}
                  title={l.slug}
                >
                  {l.name}
                  <button
                    className="ml-1 hover:opacity-80"
                    onClick={() => removeTag(slug)}
                    title="Quitar"
                  >
                    ×
                  </button>
                </span>
              );
            })}
          </div>
        </div>
      </header>

      {/* Tabs + contenido */}
      <section className="flex flex-col flex-1 min-h-0">
        {/* Tabs */}
        <div className="px-3 pt-2 md:px-4">
          <div className="flex overflow-hidden rounded border bg-white/70 border-[#CDEBD6]">
            <button
              className={
                "px-3 py-1 text-sm transition-colors " +
                (tab === "chat"
                  ? "bg-[#2E7D32] text-white"
                  : "bg-transparent hover:bg-[#E8F5E9]")
              }
              onClick={() => setTab("chat")}
            >
              Chat
            </button>
            <button
              className={
                "px-3 py-1 text-sm transition-colors " +
                (tab === "destacados"
                  ? "bg-[#2E7D32] text-white"
                  : "bg-transparent hover:bg-[#E8F5E9]")
              }
              onClick={() => setTab("destacados")}
            >
              Destacados
            </button>
          </div>
        </div>

        {/* Contenido */}
        {tab === "chat" ? (
          <main
            ref={viewportRef}
            className="overflow-y-auto overflow-x-hidden flex-1 px-3 py-3 md:px-4 md:py-4"
          >
            {/* Botón para cargar más mensajes antiguos */}
            {hasMoreMessages && msgs.length > 0 && (
              <div className="flex justify-center mb-4">
                <button
                  onClick={loadMoreMessages}
                  className="px-4 py-2 text-sm font-medium text-[#2E7D32] bg-[#E8F5E9] border border-[#2E7D32]/20 rounded-lg hover:bg-[#CDEBD6] transition-colors duration-200"
                >
                  Cargar más antiguos
                </button>
              </div>
            )}

            {msgs.length === 0 && (
              <div className="mx-auto rounded-xl border border-[#CDEBD6] bg-[#EAF7EE] p-4 text-center text-sm">
                Sin mensajes todavía.
              </div>
            )}

            <div className="flex flex-col gap-2 mx-auto w-full max-w-none">
              {msgs.map((m) => {
                const isOut = isOutgoingMessage(m, user);

                // PREVIEW FIX — tipo + mediaUrl
                const mediaUrl = resolveMediaUrl(m);
                const type =
                  m?.media?.kind ||
                  m?.mediaKind ||
                  m?.type ||
                  (m?.image ? "image" : m?.audio ? "audio" : "text");

                const wrapperClass = `flex w-full ${
                  isOut ? "justify-end" : "justify-start"
                }`;
                const bubbleClass = isOut
                  ? "bg-gradient-to-r from-[#2E7D32] to-[#388E3C] text-white rounded-2xl rounded-br-md shadow-sm"
                  : "bg-white border border-[#E0EDE4] text-gray-800 rounded-2xl rounded-bl-md shadow-sm";

                const visibleText = getVisibleText(m);

                // Si WhatsApp marcó image pero no hay URL utilizable, degradamos a texto/caption
                const effectiveType =
                  type === "image" && !mediaUrl
                    ? visibleText
                      ? "text"
                      : "image"
                    : type;

                return (
                  <div key={m.id} className={wrapperClass}>
                    <div className="max-w-[85%] px-4 py-2">
                      {/* Píldora Yo/Cliente */}
                      <div
                        className={`mb-1 text-[10px] font-medium ${
                          isOut ? "text-[#2E7D32]" : "text-gray-500"
                        }`}
                      >
                        <span
                          className={`px-2 py-[2px] rounded-full border ${
                            isOut
                              ? "border-[#2E7D32]/40 bg-[#E6F2E8]"
                              : "border-gray-300 bg-gray-50"
                          }`}
                        >
                          {isOut ? "Yo" : "Cliente"}
                        </span>
                      </div>

                      <div className={`px-4 py-3 ${bubbleClass}`}>
                        {/* Quote (reply) block */}
                        {m.replyTo && (
                          <div className={`mb-2 border-l-4 pl-3 ${isOut ? "border-white/50" : "border-[#CDEBD6]"}`}>
                            <div className={`text-[11px] ${isOut ? "text-white/70" : "text-gray-500"}`}>En respuesta a</div>
                            <div className={`text-sm ${isOut ? "text-white" : "text-gray-800"}`}>
                              {m.replyTo?.text || m.replyTo?.snippet || (
                                m.replyTo?.type === "image"
                                  ? "Imagen"
                                  : m.replyTo?.type === "audio"
                                  ? "Audio"
                                  : m.replyTo?.type === "document"
                                  ? "Documento"
                                  : "Mensaje"
                              )}
                            </div>
                          </div>
                        )}
                        {/* PREVIEW FIX — Render */}
                        {/* Caso: Ubicación */}
                        {(m?.type === "location" || m?.location || m?.media?.kind === "location") ? (
                          <LocationBubble m={m} />
                        ) : effectiveType === "image" && mediaUrl ? (
                          <>
                            <img
                              src={mediaUrl}
                              alt="Imagen"
                              className="object-cover w-44 h-44 rounded-lg md:w-52 md:h-52 cursor-zoom-in"
                              loading="lazy"
                              onClick={() => setImagePreviewUrl(mediaUrl)}
                              onError={(e) => {
                                e.currentTarget.style.display = "none";
                                const fallback = e.currentTarget.nextSibling;
                                if (fallback) fallback.style.display = "block";
                              }}
                            />
                            {/* Fallback visible */}
                            <div style={{ display: "none" }}>
                              <div
                                className={`mt-2 flex flex-col items-center gap-2 p-4 rounded-lg border-2 border-dashed ${
                                  isOut
                                    ? "border-white/30 bg-white/10"
                                    : "bg-gray-50 border-gray-300"
                                }`}
                              >
                                <ImageIcon
                                  className={`w-8 h-8 ${
                                    isOut ? "text-white/60" : "text-gray-400"
                                  }`}
                                />
                                <div
                                  className={`text-sm text-center ${
                                    isOut ? "text-white/80" : "text-gray-600"
                                  }`}
                                >
                                  Imagen no disponible
                                </div>
                                <a
                                  href={mediaUrl || "#"}
                                  target="_blank"
                                  rel="noreferrer"
                                  className={`btn btn-xs ${
                                    isOut ? "text-white bg-white/20" : "bg-white"
                                  } border ${
                                    isOut
                                      ? "border-white/30"
                                      : "border-gray-300"
                                  }`}
                                  title="Abrir en pestaña nueva"
                                >
                                  <ExternalLink className="mr-1 w-3 h-3" />
                                  Abrir
                                </a>
                                {visibleText ? (
                                  <div
                                    className={`text-xs text-center ${
                                      isOut
                                        ? "text-white/80"
                                        : "text-gray-600"
                                    }`}
                                  >
                                    {visibleText}
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          </>
                        ) : effectiveType === "image" &&
                          (m.mediaError === "URL_NOT_AVAILABLE" ||
                            m.mediaError === "MEDIA_EXPIRED" ||
                            m.mediaError === "DOWNLOAD_FAILED_EXPIRED") ? (
                          <div
                            className={`flex flex-col items-center gap-2 p-4 rounded-lg border-2 border-dashed ${
                              isOut
                                ? "border-white/30 bg-white/10"
                                : "bg-gray-50 border-gray-300"
                            }`}
                          >
                            <ImageIcon
                              className={`w-8 h-8 ${
                                isOut ? "text-white/60" : "text-gray-400"
                              }`}
                            />
                            <div
                              className={`text-sm text-center ${
                                isOut ? "text-white/80" : "text-gray-600"
                              }`}
                            >
                              <div>Imagen no disponible</div>
                              <div className="mt-1 text-xs">
                                {m.mediaError === "MEDIA_EXPIRED"
                                  ? "Media expirada (>48h)"
                                  : m.mediaError === "DOWNLOAD_FAILED_EXPIRED"
                                  ? "Descarga falló - Media expirada"
                                  : "ID de media expirado"}
                              </div>
                            </div>
                            {visibleText ? (
                              <div
                                className={`text-xs text-center ${
                                  isOut ? "text-white/80" : "text-gray-600"
                                }`}
                              >
                                {visibleText}
                              </div>
                            ) : null}
                          </div>
                        ) : effectiveType === "sticker" ? (
                          <div className="flex flex-col gap-2 items-center">
                            {resolveMediaUrl(m) ? (
                              <img
                                src={resolveMediaUrl(m)}
                                alt="Sticker"
                                className="max-w-[160px] max-h-[160px] rounded-lg"
                                loading="lazy"
                                onError={(e) => {
                                  e.currentTarget.style.display = "none";
                                  const fallback = e.currentTarget.nextSibling;
                                  if (fallback) fallback.style.display = "block";
                                }}
                              />
                            ) : null}
                            <span
                              className={`text-xs px-2 py-1 rounded-full ${
                                isOut
                                  ? "text-white bg-white/20"
                                  : "text-gray-600 bg-gray-100"
                              }`}
                            >
                              Sticker
                            </span>
                            <div
                              style={{ display: "none" }}
                              className={`text-sm ${
                                isOut ? "text-white/80" : "text-gray-600"
                              }`}
                            >
                              Sticker no disponible
                            </div>
                          </div>
                        ) : effectiveType === "audio" && mediaUrl ? (
                          <audio controls className="max-w-full">
                            <source src={mediaUrl} />
                          </audio>
                        ) : effectiveType === "document" && mediaUrl ? (
                          <div className="flex flex-col gap-2">
                            <a
                              href={mediaUrl}
                              target="_blank"
                              rel="noreferrer"
                              className={`inline-flex items-center gap-2 px-3 py-2 rounded-md border ${
                                isOut ? "text-white border-white/30 bg-white/10" : "text-gray-700 bg-gray-50 border-gray-300"
                              }`}
                              title="Abrir documento"
                            >
                              <FileText className="w-4 h-4" />
                              <span className="truncate max-w-[220px]">
                                {m?.document?.filename || (typeof mediaUrl === "string" ? mediaUrl.split("/").pop()?.split("?")[0] : "Documento")}
                              </span>
                              <ExternalLink className="w-3 h-3 opacity-75" />
                            </a>
                            {visibleText ? (
                              <div className={`text-sm ${isOut ? "text-white/80" : "text-gray-700"}`}>
                                {visibleText}
                              </div>
                            ) : null}
                          </div>
                        ) : (
                          <div className="leading-relaxed whitespace-pre-wrap break-words">
                            {visibleText}
                            {m.status === "error" && (
                              <div
                                className={`mt-2 text-xs flex items-center gap-1 ${
                                  isOut ? "text-red-2 00" : "text-red-500"
                                }`}
                              >
                                <span>⚠️</span>
                                <span>Error al enviar</span>
                                {m.error?.message && (
                                  <span className="opacity-75">
                                    - {m.error.message}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Acciones y timestamp */}
                        <div className="flex gap-2 justify-between items-center mt-2">
                          <div
                            className={`text-xs ${
                              isOut ? "text-white/80" : "text-gray-500"
                            }`}
                          >
                            {formatTs(m.timestamp)}
                          </div>
                          <div className="flex gap-1 items-center">
                            {canWrite && (
                              <StarButton
                                chatId={conversationId}
                                messageId={m.id}
                                texto={visibleText}
                              />
                            )}
                            {canWrite && (
                              <button
                                className={`btn btn-ghost btn-xs ${isOut ? "text-white/90" : "text-gray-700"}`}
                                title="Responder"
                                onClick={() => beginReplyTo(m)}
                              >
                                <CornerUpLeft className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {isOut && canWrite && (
                              <>
                                <button
                                  className={`btn btn-ghost btn-xs ${isOut ? "text-white/90" : "text-gray-700"}`}
                                  title="Editar mensaje"
                                  onClick={() => beginEditMessage(m)}
                                >
                                  <Edit3 className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  className={`btn btn-ghost btn-xs ${isOut ? "text-white/90" : "text-gray-700"}`}
                                  title="Eliminar mensaje"
                                  onClick={() => deleteMessage(m)}
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </>
                            )}
                          </div>
                        </div>

                        {/* Editor inline solo para el mensaje saliente seleccionado */}
                        {isOut && editingMessageId === m.id && (
                          <div
                            className={`mt-2 p-2 rounded-lg border ${isOut ? "border-white/40 bg-white/10" : "bg-gray-50 border-gray-300"}`}
                          >
                            <textarea
                              className={`w-full textarea textarea-xs ${isOut ? "text-white placeholder:text-white/70" : ""}`}
                              rows={3}
                              value={editingText}
                              onChange={(e) => setEditingText(e.target.value)}
                              placeholder="Editar texto/caption…"
                            />
                            <div className="flex gap-2 justify-end mt-2">
                              <button
                                className={`btn btn-xs ${isOut ? "text-white bg-white/20 border-white/40" : ""}`}
                                onClick={cancelEditMessage}
                                title="Cancelar"
                              >
                                <X className="mr-1 w-3.5 h-3.5" /> Cancelar
                              </button>
                              <button
                                className="btn btn-xs btn-success"
                                onClick={saveEditMessage}
                                title="Guardar"
                              >
                                <Check className="mr-1 w-3.5 h-3.5" /> Guardar
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </main>
        ) : (
          <main className="overflow-y-auto flex-1 px-3 py-3 md:px-4 md:py-4">
            <ChatDestacadosPanel chatId={conversationId} />
          </main>
        )}
      </section>

      {/* Input */}
      <div className="border-t border-[#CDEBD6] bg-[#F6FBF7]">
        <div className="px-3 py-3 md:px-4">
          <div className="flex flex-col gap-2 mx-auto w-full max-w-none">
            <QuickRepliesBar onPick={onPickQuick} />

            <div className="relative flex items-end gap-2 rounded-xl border border-[#CDEBD6] bg-white p-2 shadow-sm">
              {/* Mostrar archivos seleccionados */}
              {(selectedImage || selectedAudio || selectedDoc) && (
                <div className="absolute -top-16 left-0 right-0 bg-white border border-[#CDEBD6] rounded-lg p-2 shadow-sm">
                  <div className="flex gap-2 items-center text-sm text-gray-600">
                    {selectedImage && (
                      <div className="flex gap-2 items-center px-2 py-1 bg-blue-50 rounded">
                        <ImageIcon className="w-4 h-4 text-blue-600" />
                        <span className="truncate max-w-32">{selectedImage.name}</span>
                        <button
                          onClick={() => setSelectedImage(null)}
                          className="ml-1 text-red-500 hover:text-red-700"
                          title="Quitar imagen"
                        >
                          ×
                        </button>
                      </div>
                    )}
                    {selectedAudio && (
                      <div className="flex gap-2 items-center px-2 py-1 bg-green-50 rounded">
                        <FileAudio2 className="w-4 h-4 text-green-600" />
                        <span className="truncate max-w-32">{selectedAudio.name}</span>
                        <button
                          onClick={() => setSelectedAudio(null)}
                          className="ml-1 text-red-500 hover:text-red-700"
                          title="Quitar audio"
                        >
                          ×
                        </button>
                      </div>
                    )}
                    {selectedDoc && (
                      <div className="flex gap-2 items-center px-2 py-1 bg-purple-50 rounded">
                        <FileText className="w-4 h-4 text-purple-600" />
                        <span className="truncate max-w-32">{selectedDoc.name}</span>
                        <button
                          onClick={() => setSelectedDoc(null)}
                          className="ml-1 text-red-500 hover:text-red-700"
                          title="Quitar documento"
                        >
                          ×
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* pickers ocultos */}
              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                hidden
                onChange={onPickImage}
              />
              <input
                ref={audioInputRef}
                type="file"
                accept="audio/*"
                hidden
                onChange={onPickAudio}
              />
              <input
                ref={docInputRef}
                type="file"
                accept="application/pdf"
                hidden
                onChange={onPickDocument}
              />

              {/* Adjuntos */}
              <div className="relative">
                <button
                  ref={attachBtnRef}
                  className="btn btn-square btn-sm border border-[#CDEBD6] bg-white text-black hover:bg-[#F1FAF3]"
                  disabled={!canWrite || sending}
                  onClick={() => setShowAttachMenu((v) => !v)}
                  aria-haspopup="menu"
                  aria-expanded={showAttachMenu}
                  title="Adjuntar (imagen, audio, grabar)"
                >
                  <Paperclip className="w-4 h-4" />
                </button>

                {showAttachMenu && (
                  <div
                    id="attach-menu"
                    className="absolute bottom-[110%] left-0 z-50 rounded-xl border border-[#CDEBD6] bg-white shadow-md p-1 w-40"
                  >
                    <button
                      className="gap-2 justify-start w-full btn btn-ghost btn-sm"
                      onClick={() => imageInputRef.current?.click()}
                      disabled={!canWrite || sending}
                    >
                      <ImageIcon className="w-4 h-4" />
                      Imagen
                    </button>
                    <button
                      className="gap-2 justify-start w-full btn btn-ghost btn-sm"
                      onClick={() => audioInputRef.current?.click()}
                      disabled={!canWrite || sending}
                    >
                      <FileAudio2 className="w-4 h-4" />
                      Audio
                    </button>
                    <button
                      className="gap-2 justify-start w-full btn btn-ghost btn-sm"
                      onClick={() => docInputRef.current?.click()}
                      disabled={!canWrite || sending}
                    >
                      <FileText className="w-4 h-4" />
                      Documento
                    </button>
                    <div className="w-full">
                      <AudioRecorderButton
                        conversationId={conversationId}
                        canWrite={canWrite}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Textarea */}
              {/* Reply chip over input */}
              {replyTo && (
                <div className="absolute -top-9 left-0 right-0 flex items-center justify-between px-3 py-1 rounded-md border bg-white border-[#CDEBD6] text-sm">
                  <div className="flex gap-2 items-center min-w-0">
                    <CornerUpLeft className="w-4 h-4 text-[#2E7D32]" />
                    <span className="truncate">
                      {(
                        replyTo.textPreview || (
                          replyTo.type === "image"
                            ? "Imagen"
                            : replyTo.type === "audio"
                            ? "Audio"
                            : replyTo.type === "document"
                            ? "Documento"
                            : "Mensaje"
                        )
                      )}
                    </span>
                  </div>
                  <button className="btn btn-ghost btn-xs" onClick={cancelReplyTo} title="Cancelar respuesta">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}
              <textarea
                ref={textareaRef}
                rows={1}
                className="textarea textarea-bordered w-full min-h-[36px] max-h-40 resize-none leading-tight text-black placeholder:text-black/60 border-[#CDEBD6] focus:border-[#2E7D32]"
                placeholder={
                  canWrite
                    ? "Escribí un mensaje… (Enter para enviar, Shift+Enter salto)"
                    : "Conversación asignada a otro agente"
                }
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={onMsgKeyDown}
                disabled={!canWrite}
                autoComplete="off"
                autoCorrect="on"
                autoCapitalize="sentences"
                spellCheck={true}
              />

              {/* EMOJI */}
              <div className="relative">
                <button
                  ref={emojiBtnRef}
                  className="btn btn-square btn-sm border border-[#CDEBD6] bg-white text-black hover:bg-[#F1FAF3]"
                  disabled={!canWrite}
                  onClick={(e) => { e.stopPropagation(); setShowEmojiPicker((v) => !v); }}
                  title="Insertar emoji"
                >
                  <Smile className="w-4 h-4" />
                </button>

                {showEmojiPicker && (
                  <div
                    ref={emojiPickerRef}
                    className="absolute bottom-[110%] right-0 z-[95] rounded-xl border border-[#CDEBD6] bg-white shadow-lg p-3 w-64 max-h-48 overflow-y-auto"
                  >
                    <div className="grid grid-cols-8 gap-1">
                      {[
                        "😀","😃","😄","😁","😆","😅","😂","🤣","😊","😇","🙂","🙃","😉","😌","😍","🥰",
                        "😘","😗","😙","😚","😋","😛","😝","😜","🤪","🤨","🧐","🤓","😎","🤩","🥳","😏",
                        "😒","😞","😔","😟","😕","🙁","☹️","😣","😖","😫","😩","🥺","😢","😭","😤","😠",
                        "😡","🤬","🤯","😳","🥵","🥶","😱","😨","😰","😥","😓","🤗","🤔","🤭","🤫","🤥",
                        "😶","😐","😑","😬","🙄","😯","😦","😧","😮","😲","🥱","😴","🤤","😪","😵","🤐",
                        "🥴","🤢","🤮","🤧","😷","🤒","🤕","🤑","🤠","😈","👿","👹","👺","🤡","💩","👻",
                        "💀","☠️","👽","👾","🤖","🎃","😺","😸","😹","😻","😼","😽","🙀","😿","😾",
                      ].map((emoji) => (
                        <button
                          key={emoji}
                          className="p-1 text-lg rounded hover:bg-gray-100"
                          onClick={() => handleEmojiSelect({ native: emoji })}
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Plantilla 24 h (manual) */}
              <button
                className="snap-start btn btn-xs md:btn-sm bg-white text-black hover:bg-[#F1FAF3] border border-[#CDEBD6]"
                disabled={!canWrite || sending}
                title="Enviar Plantilla 24 h"
                onClick={async () => {
                  try {
                    const sellerUser = {
                      alias: convMeta?.assignedToName || "",
                      name: user?.displayName || user?.name || "",
                      email: user?.email || "",
                    };
                    const sellerName = getSellerDisplayName(sellerUser);
                    const rawWebhookSnapshot = (() => {
                      try {
                        for (const m of msgs) {
                          if (!isOutgoingMessage(m, user) && m?.raw) return m.raw;
                        }
                        return null;
                      } catch { return null; }
                    })();
                    const templatePayload = buildReengageTemplate({
                      contact,
                      sellerUser,
                      rawWebhookSnapshot,
                    });
                    setText("");
                    const tplRes = await sendMessage({
                      to: String(conversationId),
                      conversationId,
                      sellerName,
                      template: templatePayload,
                    });
                    logWaSendOutcome("manual-24h", tplRes, { template: templatePayload }, {
                      conversationId,
                      sellerName,
                      brandName: "HogarCril",
                    });
                    const code = tplRes?.results?.[0]?.error?.error?.code || tplRes?.results?.[0]?.error?.code;
                    if (tplRes && tplRes.ok === false) {
                      alert(`No se pudo enviar la plantilla.\nCódigo: ${code || "desconocido"}`);
                      if (code === 131042) {
                        alert("WhatsApp rechazó la plantilla por un problema de pago (131042). Revisar Pagos en Business Manager (WhatsApp).");
                      }
                    }
                  } catch (e) {
                    alert(e?.message || "No se pudo enviar la plantilla.");
                  }
                }}
              >
                24 h
              </button>

              {/* Enviar */}
              <button
                onClick={doSend}
                disabled={!(text.trim() || selectedImage || selectedAudio || selectedDoc) || !canWrite}
                className="gap-2 btn"
                style={{
                  backgroundColor: "#2E7D32",
                  borderColor: "#2E7D32",
                  color: "#fff",
                }}
                title="Enviar (Enter)"
              >
                <SendIcon className="w-4 h-4" />
                <span className="hidden sm:inline">Enviar</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Drawer de perfil */}
      {showProfile && (
        <div className="fixed inset-y-0 right-0 z-[80] w/full max-w-md border-l border-[#CDEBD6] bg-base-100 shadow-xl">
          <div className="flex items-center justify-between border-b border-[#CDEBD6] p-3">
            <h3 className="font-semibold">Perfil de cliente</h3>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setShowProfile(false)}
            >
              Cerrar
            </button>
          </div>
          <div className="overflow-auto p-3 h-full">
            <ClientProfile
              contactId={contactId}
              phone={phone}
              conversationId={conversationId}
            />
          </div>
        </div>
      )}

      {imagePreviewUrl && (
        <div
          className="
fixed inset-0 z-[95] bg-black/70 grid place-items-center p-4"
          onClick={() => setImagePreviewUrl(null)}  // click en backdrop cierra
        >
          <div
            className="relative bg-white rounded-xl p-2 shadow-2xl max-w-[92vw]"
            onClick={(e) => e.stopPropagation()}     // evita cerrar si clickeás dentro
          >
            <button
              className="absolute top-2 right-2 btn btn-ghost btn-sm"
              onClick={() => setImagePreviewUrl(null)}
              title="Cerrar"
            >
              ✕
            </button>

            <img
              src={imagePreviewUrl}
              alt="Vista previa"
              className="max-h-[80vh] max-w-[90vw] object-contain rounded-lg"
              loading="eager"
            />
          </div>
        </div>
      )}

      {/* Modal de etiquetas */}
      {showTags && (
        <div
          className="fixed inset-0 z-[90] grid place-items-center bg-black/40 p-4"
          onClick={() => setShowTags(false)}
        >
          <div
            className="w-full max-w-md rounded-xl shadow-xl bg-base-100"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center p-3 border-b">
              <h3 className="font-semibold">Etiquetas</h3>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setShowTags(false)}
              >
                Cerrar
              </button>
            </div>
            <div className="p-3">
              <TagsMenu
                conversationId={conversationId}
                phone={phone}
                onClose={() => setShowTags(false)}
                onChanged={() => setShowTags(false)}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
