// src/components/ChatWindow.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  arrayRemove,
  collection,
  doc,
  getDoc,
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
} from "lucide-react";

// =========================
// PREVIEW FIX — mediaUrl resolver
// Prioridad: media.url → media.link → mediaUrl → image.link/url → audio.link/url
// =========================
function resolveMediaUrl(m) {
  // Verificar que el mensaje existe
  if (!m || typeof m !== 'object') {
    console.warn('⚠️ resolveMediaUrl: mensaje inválido', m);
    return null;
  }

  const url = (
    m?.media?.url ||
    m?.media?.link || // <-- clave para salientes (sendMessage guarda media.link)
    m?.mediaUrl ||
    m?.image?.link ||
    m?.image?.url ||
    m?.audio?.link ||
    m?.audio?.url ||
    null
  );
  
  // DEBUG: Log para diagnosticar URLs de imágenes
  if (m?.type === 'image' || m?.media?.kind === 'image' || m?.mediaKind === 'image') {
    console.log('🖼️ DEBUG Image URL Resolution:', {
      messageId: m?.id,
      type: m?.type,
      mediaKind: m?.media?.kind || m?.mediaKind,
      resolvedUrl: url,
      mediaUrl: m?.mediaUrl,
      mediaObject: m?.media,
      imageObject: m?.image,
      hasMedia: m?.hasMedia,
      mediaError: m?.mediaError,
      // Mostrar todas las propiedades disponibles para debug
      allProps: Object.keys(m || {}).filter(key => 
        key.includes('media') || key.includes('image') || key.includes('url')
      ),
      // Mostrar el mensaje completo para debug
      fullMessage: m
    });
  }
  
  // Si no encontramos URL pero hay error específico
  if (!url && m?.mediaError === "URL_NOT_AVAILABLE") {
    console.warn("🔍 DEBUG: Media URL not available from WhatsApp - ID de media probablemente expirado");
  }
  
  // Si es media expirada, mostrar información adicional
  if (!url && m?.mediaError === "MEDIA_EXPIRED") {
    console.warn("⏰ DEBUG: Media expirada permanentemente - mostrar placeholder");
  }
  
  return url;
}

// ---------- helpers ----------
function formatTs(ts) {
  const d = ts?.toDate ? ts.toDate() : ts ? new Date(ts) : null;
  return d ? d.toLocaleString() : "";
}

// Detecta si un mensaje es saliente (mío) de forma robusta
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
    if (a === "me" || a === (user?.uid || "").toLowerCase() || a === (user?.email || "").toLowerCase()) {
      return true;
    }
  }
  return false; // por defecto entrante
}

export default function ChatWindow({ conversationId, onBack }) {
  const { user } = useAuthState();
  const navigate = useNavigate();

  // ---- state ----
  const [msgs, setMsgs] = useState([]);
  const [sending, setSending] = useState(false);
  const [text, setText] = useState("");

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

  // ---- refs ----
  const viewportRef = useRef(null);
  const textareaRef = useRef(null);
  const imageInputRef = useRef(null);
  const audioInputRef = useRef(null);
  const attachBtnRef = useRef(null);
  const emojiPickerRef = useRef(null);

  // flags para control de scroll
  const didInitialAutoScroll = useRef(false);

  // ---------- limpieza inmediata al cambiar de chat ----------
  useEffect(() => {
    setMsgs([]);
    setConvSlugs([]);
    setContact(null);
    setConvMeta(null);
    setText("");
    setTab("chat");
    setShowAttachMenu(false);
    setShowEmojiPicker(false);
    didInitialAutoScroll.current = false;
    requestAnimationFrame(() => viewportRef.current?.scrollTo({ top: 0 }));
  }, [conversationId]);

  // ---------- etiquetas catálogo ----------
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

  // ---------- meta conversación ----------
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

  // ---------- contacto ----------
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

  // ---------- permisos ----------
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

    if (!assignedToUid && !assignedEmail && assignedList.length === 0) return false;

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
  }, [convMeta?.assignedToUid, convMeta?.assignedToEmail, convMeta?.assignedEmail, convMeta?.assignedTo, user?.uid, user?.email, isAdmin]);

  const canWrite = useMemo(() => {
    if (!canRead) return false;
    return true;
  }, [canRead]);

  // ---------- mensajes (solo si canRead) ----------
  useEffect(() => {
    if (!conversationId) return;
    if (!canRead) {
      setMsgs([]);
      return;
    }

    let unsub = null;
    let triedAlt = false;
    let firstEmission = true;

    const mount = (subcol = "messages") => {
      if (typeof unsub === "function") {
        unsub();
        unsub = null;
      }
      const qRef = query(
        collection(db, "conversations", String(conversationId), subcol),
        orderBy("timestamp", "asc")
      );
      unsub = onSnapshot(
        qRef,
        (snap) => {
          const arr = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          setMsgs(arr);

          if (firstEmission && arr.length === 0 && !triedAlt && subcol === "messages") {
            triedAlt = true;
            mount("msgs");
          }
          firstEmission = false;
        },
        (err) => {
          console.error(`onSnapshot(${subcol}) error:`, err);
          if (!triedAlt && subcol === "messages") {
            triedAlt = true;
            mount("msgs");
          }
        }
      );
    };

    mount("messages");

    return () => {
      if (typeof unsub === "function") unsub();
    };
  }, [conversationId, canRead]);

  // ---------- auto-scroll ----------
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

  // ---------- UI helpers ----------
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

  // contexto para plantillas
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

  // envío texto
  const doSend = () => {
    const body = (text || "").trim();
    if (!conversationId || !body || !canWrite) return;

    setText("");
    requestAnimationFrame(() => textareaRef.current?.focus());

    sendMessage({ to: String(conversationId), text: body, conversationId })
      .then((r) => {
        const serverConvId = r?.results?.[0]?.to;
        if (serverConvId && serverConvId !== conversationId) {
          navigate(`/app/${encodeURIComponent(serverConvId)}`, { replace: true });
        }
        if (r && r.ok === false) {
          const err = r?.results?.[0]?.error;
          const code =
            err?.error?.code ?? err?.code ?? (typeof err === "string" ? err : "");
          alert(`No se pudo enviar.\nCódigo: ${code || "desconocido"}`);
        }
        scrollToBottom("smooth");
      })
      .catch((e) => {
        alert(e?.message || "No se pudo enviar");
      });
  };

  // adjuntos (imagen / audio)
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
    if (file) await handlePickAndSend(file, "image");
  };

  const onPickAudio = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) await handlePickAndSend(file, "audio");
  };

  // cerrar menú adjuntos en click afuera / Esc
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

  // cerrar emoji picker en click afuera / Esc
  useEffect(() => {
    if (!showEmojiPicker) return;
    const onDocClick = (e) => {
      if (!emojiPickerRef.current) return;
      if (!emojiPickerRef.current.contains(e.target)) setShowEmojiPicker(false);
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
                  m?.media?.kind || // <-- primero el "kind" del backend (image/audio/sticker)
                  m?.mediaKind ||   // <-- también revisar mediaKind directo
                  m?.type ||
                  (m?.image ? "image" : m?.audio ? "audio" : "text");

                const wrapperClass = `flex w-full ${isOut ? "justify-end" : "justify-start"}`;
                const bubbleClass = isOut
                  ? "bg-gradient-to-r from-[#2E7D32] to-[#388E3C] text-white rounded-2xl rounded-br-md shadow-sm"
                  : "bg-white border border-[#E0EDE4] text-gray-800 rounded-2xl rounded-bl-md shadow-sm";

                const visibleText =
                  typeof m?.text === "string"
                    ? m.text
                    : m?.template
                    ? `[template] ${m.template}`
                    : typeof m?.text === "object"
                    ? JSON.stringify(m?.text || "")
                    : m?.caption || "";

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
                            isOut ? "border-[#2E7D32]/40 bg-[#E6F2E8]" : "border-gray-300 bg-gray-50"
                          }`}
                        >
                          {isOut ? "Yo" : "Cliente"}
                        </span>
                      </div>

                      <div className={`px-4 py-3 ${bubbleClass}`}>
                        {/* PREVIEW FIX — Render */}
                        {type === "image" && mediaUrl ? (
                          <img
                            src={mediaUrl}
                            alt="Imagen"
                            className="max-w-full rounded-lg"
                            loading="lazy"
                            onError={(e) => {
                              e.currentTarget.style.display = "none";
                              const fallback = e.currentTarget.nextSibling;
                              if (fallback) fallback.style.display = "block";
                            }}
                          />
                        ) : type === "image" && (m.mediaError === "URL_NOT_AVAILABLE" || m.mediaError === "MEDIA_EXPIRED" || m.mediaError === "DOWNLOAD_FAILED_EXPIRED") ? (
                          // Placeholder para imágenes con media expirada o error de descarga
                          <div className={`flex flex-col items-center gap-2 p-4 rounded-lg border-2 border-dashed ${
                            isOut ? "border-white/30 bg-white/10" : "border-gray-300 bg-gray-50"
                          }`}>
                            <ImageIcon className={`w-8 h-8 ${isOut ? "text-white/60" : "text-gray-400"}`} />
                            <div className={`text-sm text-center ${isOut ? "text-white/80" : "text-gray-600"}`}>
                              <div>Imagen no disponible</div>
                              <div className="text-xs mt-1">
                                {m.mediaError === "MEDIA_EXPIRED" 
                                  ? "Media expirada (>48h)" 
                                  : m.mediaError === "DOWNLOAD_FAILED_EXPIRED"
                                  ? "Descarga falló - Media expirada"
                                  : "ID de media expirado"}
                              </div>
                            </div>
                          </div>
                        ) : type === "sticker" ? (
                          <div className="flex flex-col gap-2 items-center">
                            {mediaUrl ? (
                              <img
                                src={mediaUrl}
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
                                isOut ? "text-white bg-white/20" : "text-gray-600 bg-gray-100"
                              }`}
                            >
                              Sticker
                            </span>
                            <div
                              style={{ display: "none" }}
                              className={`text-sm ${isOut ? "text-white/80" : "text-gray-600"}`}
                            >
                              Sticker no disponible
                            </div>
                          </div>
                        ) : type === "audio" && mediaUrl ? (
                          <audio controls className="max-w-full">
                            <source src={mediaUrl} />
                          </audio>
                        ) : (
                          <div className="leading-relaxed whitespace-pre-wrap break-words">
                            {visibleText}
                          </div>
                        )}

                        <div className="flex gap-2 justify-between items-center mt-2">
                          <div className={`text-xs ${isOut ? "text-white/80" : "text-gray-500"}`}>
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
              {/* pickers ocultos */}
              <input ref={imageInputRef} type="file" accept="image/*" hidden onChange={onPickImage} />
              <input ref={audioInputRef} type="file" accept="audio/*" hidden onChange={onPickAudio} />

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
                      <AudioRecorderButton conversationId={conversationId} canWrite={canWrite} />
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
                        "😀","😃","😄","😁","😆","😅","😂","🤣","😊","😇","🙂","🙃","😉","😌","😍","🥰","😘","😗","😙","😚",
                        "😋","😛","😝","😜","🤪","🤨","🧐","🤓","😎","🤩","🥳","😏","😒","😞","😔","😟","😕","🙁","☹️","😣",
                        "😖","😫","😩","🥺","😢","😭","😤","😠","😡","🤬","🤯","😳","🥵","🥶","😱","😨","😰","😥","😓","🤗",
                        "🤔","🤭","🤫","🤥","😶","😐","😑","😬","🙄","😯","😦","😧","😮","😲","🥱","😴","🤤","😪","😵","🤐",
                        "🥴","🤢","🤮","🤧","😷","🤒","🤕","🤑","🤠","😈","👿","👹","👺","🤡","💩","👻","💀","☠️","👽","👾",
                        "🤖","🎃","😺","😸","😹","😻","😼","😽","🙀","😿","😾"
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
                disabled={!text.trim() || !canWrite}
                className="gap-2 btn"
                style={{ backgroundColor: "#2E7D32", borderColor: "#2E7D32", color: "#fff" }}
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
            <button className="btn btn-ghost btn-sm" onClick={() => setShowProfile(false)}>
              Cerrar
            </button>
          </div>
          <div className="overflow-auto p-3 h-full">
            <ClientProfile contactId={contactId} phone={phone} conversationId={conversationId} />
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
              <button className="btn btn-ghost btn-sm" onClick={() => setShowTags(false)}>
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
