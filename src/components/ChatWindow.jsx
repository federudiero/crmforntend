// src/components/ChatWindow.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  arrayRemove,
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
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
} from "lucide-react";

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


  // ---- refs ----
  const viewportRef = useRef(null);
  const textareaRef = useRef(null);
  const imageInputRef = useRef(null);
  const audioInputRef = useRef(null);
  const attachBtnRef = useRef(null);
  const emojiPickerRef = useRef(null);

  const didInitialAutoScroll = useRef(false);

  // limpiar al cambiar chat
  useEffect(() => {
    setMsgs([]);
    setConvSlugs([]);
    setContact(null);
    setConvMeta(null);
    setText("");
    setTab("chat");
    setShowAttachMenu(false);
    setShowEmojiPicker(false);
    // Resetear estados de paginación
    setMessageLimit(50);
    setHasMoreMessages(false);
    // Limpiar archivos seleccionados
    setSelectedImage(null);
    setSelectedAudio(null);
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
    ["federudiero@gmail.com", "fede_rudiero@gmail.com"].includes(user.email);

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

  // mensajes
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
    const totalMessages = a.length + b.length;
    const uniqueMessages = arr.length;
    setHasMoreMessages(uniqueMessages >= messageLimit && (a.length === messageLimit || b.length === messageLimit));

    setMsgs(arr);
  };

  const unsubA = onSnapshot(
    qA,
    (snap) => {
      a = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      applyMerge();
    },
    (err) => console.error("onSnapshot(messages) error:", err)
  );

  const unsubB = onSnapshot(
    qB,
    (snap) => {
      b = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
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

  // envío texto y archivos multimedia
  const doSend = async () => {
    const body = (text || "").trim();
    const hasText = !!body;
    const hasImage = !!selectedImage;
    const hasAudio = !!selectedAudio;

    // Verificar que hay algo que enviar (texto, imagen o audio)
    if (!conversationId || (!hasText && !hasImage && !hasAudio) || !canWrite) return;

    // Limpiar estados inmediatamente
    setText("");
    const imageToSend = selectedImage;
    const audioToSend = selectedAudio;
    setSelectedImage(null);
    setSelectedAudio(null);
    
    requestAnimationFrame(() => textareaRef.current?.focus());

    try {
      // Enviar texto si existe
      if (hasText) {
        const textResult = await sendMessage({ 
          to: String(conversationId), 
          text: body, 
          conversationId 
        });
        
        const serverConvId = textResult?.results?.[0]?.to;
        if (serverConvId && serverConvId !== conversationId) {
          navigate(`/app/${encodeURIComponent(serverConvId)}`, {
            replace: true,
          });
        }
        if (textResult && textResult.ok === false) {
          const err = textResult?.results?.[0]?.error;
          const code =
            err?.error?.code ??
            err?.code ??
            (typeof err === "string" ? err : "");
          alert(`No se pudo enviar el texto.\nCódigo: ${code || "desconocido"}`);
        }
      }

      // Enviar imagen si existe
      if (hasImage && imageToSend) {
        setSending(true);
        const dest = `uploads/${conversationId}/${Date.now()}_${imageToSend.name}`;
        const { url } = await uploadFile(imageToSend, dest);
        await sendMessage({
          to: String(conversationId),
          conversationId,
          image: { link: url }
        });
      }

      // Enviar audio si existe
      if (hasAudio && audioToSend) {
        setSending(true);
        const dest = `uploads/${conversationId}/${Date.now()}_${audioToSend.name}`;
        const { url } = await uploadFile(audioToSend, dest);
        await sendMessage({
          to: String(conversationId),
          conversationId,
          audio: { link: url }
        });
      }

      scrollToBottom("smooth");
    } catch (e) {
      alert(e?.message || "No se pudo enviar");
    } finally {
      setSending(false);
      setShowAttachMenu(false);
    }
  };

  // adjuntos
  const handlePickAndSend = async (file, kind /* "image" | "audio" */) => {
    if (!file || !conversationId || !canWrite) return;
    try {
      setSending(true);
      const dest = `uploads/${conversationId}/${Date.now()}_${file.name}`;
      const { url } = await uploadFile(file, dest);
      const payload =
        kind === "image" ? { image: { link: url } } : { audio: { link: url } };
      await sendMessage({
        to: String(conversationId),
        conversationId,
        ...payload,
      });
      scrollToBottom("smooth");
    } catch (err) {
      alert(err?.message || `No se pudo enviar el ${kind}`);
    } finally {
      setSending(false);
      setShowAttachMenu(false);
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

  useEffect(() => {
    if (!showEmojiPicker) return;
    const onDocClick = (e) => {
      if (!emojiPickerRef.current) return;
      if (!emojiPickerRef.current.contains(e.target))
        setShowEmojiPicker(false);
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
                        {/* PREVIEW FIX — Render */}
                        {effectiveType === "image" && mediaUrl ? (
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
                        ) : (
                          <div className="leading-relaxed whitespace-pre-wrap break-words">
                            {visibleText}
                            {m.status === "error" && (
                              <div
                                className={`mt-2 text-xs flex items-center gap-1 ${
                                  isOut ? "text-red-200" : "text-red-500"
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

                        <div className="flex gap-2 justify-between items-center mt-2">
                          <div
                            className={`text-xs ${
                              isOut ? "text-white/80" : "text-gray-500"
                            }`}
                          >
                            {formatTs(m.timestamp)}
                          </div>
                          {canWrite && (
                            <StarButton
                              chatId={conversationId}
                              messageId={m.id}
                              texto={visibleText}
                            />
                          )}
                        </div>
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
              {(selectedImage || selectedAudio) && (
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
                  className="btn btn-square btn-sm border border-[#CDEBD6] bg-white text-black hover:bg-[#F1FAF3]"
                  disabled={!canWrite}
                  onClick={() => setShowEmojiPicker((v) => !v)}
                  title="Insertar emoji"
                >
                  <Smile className="w-4 h-4" />
                </button>

                {showEmojiPicker && (
                  <div
                    ref={emojiPickerRef}
                    className="absolute bottom-[110%] right-0 z-50 rounded-xl border border-[#CDEBD6] bg-white shadow-lg p-3 w-64 max-h-48 overflow-y-auto"
                  >
                    <div className="grid grid-cols-8 gap-1">
                      {[
                        "😀",
                        "😃",
                        "😄",
                        "😁",
                        "😆",
                        "😅",
                        "😂",
                        "🤣",
                        "😊",
                        "😇",
                        "🙂",
                        "🙃",
                        "😉",
                        "😌",
                        "😍",
                        "🥰",
                        "😘",
                        "😗",
                        "😙",
                        "😚",
                        "😋",
                        "😛",
                        "😝",
                        "😜",
                        "🤪",
                        "🤨",
                        "🧐",
                        "🤓",
                        "😎",
                        "🤩",
                        "🥳",
                        "😏",
                        "😒",
                        "😞",
                        "😔",
                        "😟",
                        "😕",
                        "🙁",
                        "☹️",
                        "😣",
                        "😖",
                        "😫",
                        "😩",
                        "🥺",
                        "😢",
                        "😭",
                        "😤",
                        "😠",
                        "😡",
                        "🤬",
                        "🤯",
                        "😳",
                        "🥵",
                        "🥶",
                        "😱",
                        "😨",
                        "😰",
                        "😥",
                        "😓",
                        "🤗",
                        "🤔",
                        "🤭",
                        "🤫",
                        "🤥",
                        "😶",
                        "😐",
                        "😑",
                        "😬",
                        "🙄",
                        "😯",
                        "😦",
                        "😧",
                        "😮",
                        "😲",
                        "🥱",
                        "😴",
                        "🤤",
                        "😪",
                        "😵",
                        "🤐",
                        "🥴",
                        "🤢",
                        "🤮",
                        "🤧",
                        "😷",
                        "🤒",
                        "🤕",
                        "🤑",
                        "🤠",
                        "😈",
                        "👿",
                        "👹",
                        "👺",
                        "🤡",
                        "💩",
                        "👻",
                        "💀",
                        "☠️",
                        "👽",
                        "👾",
                        "🤖",
                        "🎃",
                        "😺",
                        "😸",
                        "😹",
                        "😻",
                        "😼",
                        "😽",
                        "🙀",
                        "😿",
                        "😾",
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

              {/* Enviar */}
              <button
                onClick={doSend}
                disabled={!(text.trim() || selectedImage || selectedAudio) || !canWrite}
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
        <div className="fixed inset-y-0 right-0 z-[80] w-full max-w-md border-l border-[#CDEBD6] bg-base-100 shadow-xl">
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
    className="fixed inset-0 z-[95] bg-black/70 grid place-items-center p-4"
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
