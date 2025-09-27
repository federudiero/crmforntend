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
} from "lucide-react";

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

  // ---- refs ----
  const viewportRef = useRef(null);
  const textareaRef = useRef(null);
  const imageInputRef = useRef(null);
  const audioInputRef = useRef(null);
  const attachBtnRef = useRef(null);

  // ---------- limpieza inmediata al cambiar de chat ----------
  useEffect(() => {
    setMsgs([]);
    setConvSlugs([]);
    setContact(null);
    setConvMeta(null);
    setText("");
    setTab("chat");
    setShowAttachMenu(false);
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
    if (isAdmin) return true;
    if (!assignedToUid) return false; // no montamos listeners si no hay dueño
    return assignedToUid === user?.uid;
  }, [convMeta?.assignedToUid, user?.uid, isAdmin]);

  const canWrite = useMemo(() => {
    if (!canRead) return false;
    // si tenés reglas extra, ponelas acá
    return true;
  }, [canRead]);

  // ---------- mensajes (solo si canRead) ----------
  useEffect(() => {
    if (!conversationId) return;

    if (!canRead) {
      setMsgs([]);
      return;
    }

    const qRef = query(
      collection(db, "conversations", String(conversationId), "messages"),
      orderBy("timestamp", "asc")
    );
    const unsub = onSnapshot(
      qRef,
      (snap) => {
        const arr = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setMsgs(arr);
      },
      (err) => console.error("onSnapshot(messages) error:", err)
    );
    return () => unsub();
  }, [conversationId, canRead]);

  // ---------- auto-scroll al fondo cuando llegan mensajes / cambio de tab ----------
  const scrollToBottom = (behavior = "auto") => {
    const el = viewportRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight + 9999, behavior });
  };

  useEffect(() => {
    if (tab === "chat") {
      // smooth cuando ya había mensajes (no inicial vacío)
      scrollToBottom(msgs.length > 0 ? "smooth" : "auto");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    } catch (err) {
      alert(err?.message || `No se pudo enviar el ${kind}`);
    } finally {
      setSending(false);
      setShowAttachMenu(false);
      // scroll al enviar adjunto
      scrollToBottom("smooth");
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

  // ---------- render ----------

  if (!canRead) {
    // Place-holder si el wrapper (home) montó el componente sin permiso
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
    <div className="flex h-full flex-col text-black bg-[#F6FBF7]">
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

          {/* Fila 2: Toolbar con íconos */}
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
        <main ref={viewportRef} className="overflow-y-auto flex-1 px-3 py-3 md:px-4 md:py-4">
          {msgs.length === 0 && (
            <div className="mx-auto rounded-xl border border-[#CDEBD6] bg-[#EAF7EE] p-4 text-center text-sm">
              Sin mensajes todavía.
            </div>
          )}

          <div className="flex flex-col gap-2 mx-auto w-full max-w-none">
            {msgs.map((m) => {
              const isOut = isOutgoingMessage(m, user);
              const type = m?.type || (m?.image ? "image" : m?.audio ? "audio" : "text");
              const mediaUrl =
                m?.mediaUrl ||
                m?.image?.link ||
                m?.image?.url ||
                m?.audio?.link ||
                m?.audio?.url ||
                null;

              const wrapperClass = `flex ${isOut ? "justify-end" : "justify-start"}`;
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
                      {type === "image" && mediaUrl ? (
                        <img src={mediaUrl} alt="" className="max-w-full rounded-lg" loading="lazy" />
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

      {/* Input */}
      <div className="border-t border-[#CDEBD6] bg-[#F6FBF7]">
        <div className="px-3 py-3 md:px-4">
          <div className="flex flex-col gap-2 mx-auto w-full max-w-none">
            <QuickRepliesBar onPick={onPickQuick} />

            <div className="relative flex items-end gap-2 rounded-xl border border-[#CDEBD6] bg-white p-2 shadow-sm">
              {/* pickers ocultos */}
              <input ref={imageInputRef} type="file" accept="image/*" hidden onChange={onPickImage} />
              <input ref={audioInputRef} type="file" accept="audio/*" hidden onChange={onPickAudio} />

              {/* Botón de adjuntos */}
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
                className="textarea textarea-bordered w-full min-h[36px] max-h-40 resize-none leading-tight text-black placeholder:text-black/60 border-[#CDEBD6] focus:border-[#2E7D32]"
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
