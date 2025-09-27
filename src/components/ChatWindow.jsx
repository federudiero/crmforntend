import React, { useEffect, useRef, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  arrayRemove,
  getDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../firebase";
import { sendMessage } from "../services/api";
import { uploadFile } from "../services/storage";
import { useAuthState } from "../hooks/useAuthState.js";
import TemplatesPicker from "./TemplatesPicker.jsx";
import { listLabels } from "../lib/labels";
import StagePicker from "./StagePicker.jsx";
import QuickRepliesBar from "./QuickRepliesBar.jsx";
import ClientProfile from "./ClientProfile.jsx";
import TagsMenu from "./TagsMenu.jsx";
import AudioRecorderButton from "./AudioRecorderButton.jsx";
import StarButton from "./StarButton.jsx";
import ChatDestacadosPanel from "./ChatDestacadosPanel.jsx";

import {
  Image as ImageIcon,
  FileAudio2,
  Send as SendIcon,
  Tags as TagsIcon,
  UserRound,
  FileText,
  Paperclip,
} from "lucide-react";

function formatTs(ts) {
  if (!ts) return "";
  return new Date(ts.seconds * 1000).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
}

export default function ChatWindow({ conversationId, convMeta, onBack }) {
  const navigate = useNavigate();
  const { user } = useAuthState();

  // Estados principales
  const [msgs, setMsgs] = useState([]);
  const [sending, setSending] = useState(false); // bloquea sólo adjuntos mientras suben
  const [text, setText] = useState("");

  // Estados para etiquetas
  const [convSlugs, setConvSlugs] = useState([]);
  const [allLabels, setAllLabels] = useState([]);

  // Estados para contacto y metadata
  const [contact, setContact] = useState(null);
  const [localConvMeta, setLocalConvMeta] = useState(null);

  // Estados de UI
  const [showProfile, setShowProfile] = useState(false);
  const [showTags, setShowTags] = useState(false);
  const [tab, setTab] = useState("chat");
  const [showAttachMenu, setShowAttachMenu] = useState(false);

  const viewportRef = useRef(null);
  const textareaRef = useRef(null);
  const imageInputRef = useRef(null);
  const audioInputRef = useRef(null);
  const attachBtnRef = useRef(null);

  // Usar convMeta del prop o el local
  const currentConvMeta = convMeta || localConvMeta;

  // Verificar si es admin
  const isAdmin =
    !!user?.email &&
    ["federudiero@gmail.com", "fede_rudiero@gmail.com"].includes(user.email);

  const canRead = useMemo(() => {
    if (!currentConvMeta) return false;
    if (isAdmin) return true;
    return currentConvMeta.assignedToUid === user?.uid;
  }, [currentConvMeta?.assignedToUid, user?.uid, isAdmin]);

  const canWrite = useMemo(() => {
    if (!currentConvMeta) return false;
    if (isAdmin) return true;
    return currentConvMeta.assignedToUid === user?.uid;
  }, [currentConvMeta?.assignedToUid, user?.uid, isAdmin]);

  // Cargar metadata local si no viene del prop
  useEffect(() => {
    if (!conversationId || convMeta) return;
    
    const unsubscribe = onSnapshot(doc(db, "conversations", conversationId), (snap) => {
      if (snap.exists()) {
        setLocalConvMeta(snap.data());
      }
    });

    return unsubscribe;
  }, [conversationId]);

  // Cargar etiquetas
  useEffect(() => {
    (async () => {
      try {
        const labels = await listLabels();
        setAllLabels(labels);
      } catch (e) {
        console.error("Error cargando etiquetas:", e);
      }
    })();
  }, []);

  const labelBySlug = useMemo(() => {
    const map = {};
    for (const l of allLabels) map[l.slug] = l;
    return map;
  }, [allLabels]);

  const getLabel = (slug) =>
    labelBySlug[slug] || { name: slug, color: "#666" };

  useEffect(() => {
    if (!conversationId || !canRead) return;

    const unsubscribe = onSnapshot(
      query(
        collection(db, "conversations", conversationId, "messages"),
        orderBy("timestamp", "asc")
      ),
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setMsgs(list);
      },
      (error) => {
        console.error("Error en mensajes:", error);
      }
    );

    return unsubscribe;
  }, [conversationId, tab]);

  // Cargar metadata de conversación y etiquetas
  useEffect(() => {
    if (!conversationId) return;

    const unsubscribe = onSnapshot(
      doc(db, "conversations", conversationId),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          setConvSlugs(data.labelSlugs || []);
          if (!convMeta) {
            setLocalConvMeta(data);
          }
        }
      },
      (error) => {
        console.error("Error en conversación:", error);
      }
    );

    return unsubscribe;
  }, [conversationId, convMeta]);

  // Cargar contacto
  useEffect(() => {
    if (!conversationId) return;

    (async () => {
      try {
        const convSnap = await getDoc(doc(db, "conversations", conversationId));
        if (convSnap.exists()) {
          const convData = convSnap.data();
          const phone = convData.clientPhone;
          if (phone) {
            const contactSnap = await getDoc(doc(db, "contacts", phone));
            if (contactSnap.exists()) {
              setContact(contactSnap.data());
            }
          }
        }
      } catch (e) {
        console.error("Error cargando contacto:", e);
      }
    })();
  }, [conversationId]);

  const removeTag = async (slug) => {
    try {
      await updateDoc(doc(db, "conversations", conversationId), {
        labelSlugs: arrayRemove(slug),
      });
    } catch (e) {
      console.error("Error removiendo etiqueta:", e);
    }
  };

  const doSend = () => {
    if (!text.trim() || !canWrite) return;

    (async () => {
      try {
        await sendMessage({
          conversationId,
          text: text.trim(),
          timestamp: serverTimestamp(),
        });
        setText("");
        if (textareaRef.current) {
          textareaRef.current.style.height = "auto";
        }
      } catch (e) {
        console.error("Error enviando mensaje:", e);
        alert("Error enviando mensaje");
      }
    })();
  };

  const onMsgKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      doSend();
    }
  };

  // Auto-resize del textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = textareaRef.current.scrollHeight + "px";
    }
  }, [text]);

  // Contexto para plantillas
  const templateContext = {
    nombre: contact?.name || contact?.fullName || "",
    vendedor: user?.displayName || user?.email || "",
    fecha: new Date().toLocaleDateString(),
    link: window?.location?.href || "",
  };

  const onPickQuick = (t) => {
    setText((prev) => prev + (prev ? " " : "") + t.text);
    if (textareaRef.current) textareaRef.current.focus();
  };

  const phone = useMemo(
    () => convMeta?.clientPhone || contact?.phone,
    [convMeta?.clientPhone, contact?.phone]
  );

  const contactId = useMemo(
    () => conversationId + "_" + phone,
    [conversationId, phone]
  );

  const handleAssignToMe = async () => {
    if (!user?.uid || !conversationId) return;
    
    try {
      await updateDoc(doc(db, "conversations", conversationId), {
        assignedToUid: user.uid,
        assignedToName: user.displayName || user.email || "Usuario",
        assignedAt: serverTimestamp(),
      });
    } catch (error) {
      console.error("Error asignando conversación:", error);
      alert("Error al asignar la conversación");
    }
  };

  const onPickImage = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !canWrite) return;
    // Implementar lógica de subida de imagen
  };

  const onPickAudio = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !canWrite) return;
    // Implementar lógica de subida de audio
  };

  // Cerrar menú de adjuntos al hacer clic fuera
  useEffect(() => {
    if (!showAttachMenu) return;

    const handleClickOutside = (e) => {
      if (
        attachBtnRef.current &&
        !attachBtnRef.current.contains(e.target) &&
        !document.getElementById("attach-menu")?.contains(e.target)
      ) {
        setShowAttachMenu(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [showAttachMenu]);

  return (
    <div className="flex h-full flex-col text-black bg-[#F6FBF7]">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b bg-[#E8F5E9]/90 border-[#CDEBD6] backdrop-blur">
        <div className="px-3 pt-2 pb-2 md:px-4">
          {/* Título y controles principales */}
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

          {/* Botones de acción */}
          <div className="overflow-x-auto -mx-1 mt-2 no-scrollbar">
            <div className="flex gap-2 items-center px-1 snap-x snap-mandatory">
              {/* Plantillas */}
              <div className="snap-start shrink-0">
                <TemplatesPicker
                  mode="modal"
                  anchorToBody
                  backdrop
                  buttonClassName="btn btn-circle btn-sm bg-white text-black hover:bg-[#F1FAF3] border border-[#CDEBD6]"
                  buttonChildren={<FileText className="w-4 h-4" />}
                  onInsert={(txt) => {
                    setText((prev) => prev + (prev ? " " : "") + txt);
                    if (textareaRef.current) textareaRef.current.focus();
                  }}
                  context={templateContext}
                  buttonAriaLabel="Plantillas"
                />
              </div>

              <button
                className="snap-start btn btn-xs md:btn-sm bg-white text-black hover:bg-[#F1FAF3] border border-[#CDEBD6] gap-2"
                onClick={() => setShowTags(true)}
                title="Etiquetar conversación"
              >
                <TagsIcon className="w-4 h-4" />
                <span className="hidden xs:inline">Etiquetar</span>
              </button>

              <button
                className="snap-start btn btn-xs md:btn-sm bg-white text-black hover:bg-[#F1FAF3] border border-[#CDEBD6] gap-2"
                onClick={() => setShowProfile(true)}
                title="Ver perfil del cliente"
              >
                <UserRound className="w-4 h-4" />
                <span className="hidden xs:inline">Perfil</span>
              </button>
            </div>
          </div>

          {/* Etiquetas */}
          <div className="flex overflow-x-auto gap-2 items-center px-0.5 pb-1 mt-2 no-scrollbar">
            {convSlugs.map((slug) => {
              const label = getLabel(slug);
              return (
                <div
                  key={slug}
                  className="snap-start shrink-0 flex items-center gap-1 px-2 py-1 text-xs rounded-full border"
                  style={{
                    backgroundColor: label.color + "20",
                    borderColor: label.color,
                    color: label.color,
                  }}
                >
                  <span>{label.name}</span>
                  <button
                    onClick={() => removeTag(slug)}
                    className="hover:bg-black/10 rounded-full p-0.5"
                    title="Quitar etiqueta"
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </header>

      {/* Tabs - Solo si tiene acceso de lectura */}
      {canRead && (
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
      )}

      {/* Contenido principal */}
      {tab === "chat" ? (
        <main ref={viewportRef} className="overflow-y-auto flex-1 px-3 py-3 md:px-4 md:py-4">
          {!canRead ? (
            <div className="mx-auto rounded-xl border border-red-300 bg-red-50 p-4 text-center text-sm text-red-700">
              <div className="mb-3">
                No tenés acceso a este chat. Asignate desde la lista.
              </div>
              <button
                onClick={async () => {
                  try {
                    await handleAssignToMe();
                  } catch (error) {
                    console.error("Error:", error);
                  }
                }}
                className="px-4 py-2 font-medium text-white bg-blue-600 rounded-lg transition-colors duration-200 hover:bg-blue-700"
              >
                Asignarme
              </button>
            </div>
          ) : msgs.length === 0 ? (
            <div className="mx-auto rounded-xl border border-[#CDEBD6] bg-[#EAF7EE] p-4 text-center text-sm">
              Sin mensajes todavía.
            </div>
          ) : null}

          <div className="flex flex-col gap-3 mx-auto w-full max-w-none">
            {canRead && msgs.map((m) => {
              const isFromMe = m.from === "me";
              return (
                <div
                  key={m.id}
                  className={`flex ${isFromMe ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl px-3 py-2 ${
                      isFromMe
                        ? "bg-[#2E7D32] text-white rounded-br-md"
                        : "bg-white border border-[#CDEBD6] text-black rounded-bl-md"
                    }`}
                  >
                    {m.type === "text" && (
                      <div className="whitespace-pre-wrap break-words">
                        {m.text}
                      </div>
                    )}
                    {m.type === "image" && (
                      <div>
                        <img
                          src={m.mediaUrl}
                          alt="Imagen"
                          className="max-w-full rounded-lg"
                        />
                        {m.caption && (
                          <div className="mt-2 whitespace-pre-wrap break-words">
                            {m.caption}
                          </div>
                        )}
                      </div>
                    )}
                    {m.type === "audio" && (
                      <div>
                        <audio controls className="max-w-full">
                          <source src={m.mediaUrl} type="audio/mpeg" />
                        </audio>
                      </div>
                    )}
                    <div className="flex items-center justify-between gap-2 mt-1">
                      <div
                        className={`text-xs ${
                          isFromMe ? "text-white/70" : "text-black/50"
                        }`}
                      >
                        {formatTs(m.timestamp)}
                      </div>
                      {canWrite && (
                        <StarButton
                          chatId={conversationId}
                          messageId={m.id}
                          texto={m.text || m.caption || ""}
                        />
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </main>
      ) : canRead ? (
        <main className="overflow-y-auto flex-1 px-3 py-3 md:px-4 md:py-4">
          {canWrite ? (
            <ChatDestacadosPanel chatId={conversationId} />
          ) : (
            <div className="mx-auto rounded-xl border border-red-300 bg-red-50 p-4 text-center text-sm text-red-700">
              No tenés permisos para ver destacados en esta conversación.
            </div>
          )}
        </main>
      ) : (
        <main className="overflow-y-auto flex-1 px-3 py-3 md:px-4 md:py-4">
          <div className="mx-auto rounded-xl border border-red-300 bg-red-50 p-4 text-center text-sm text-red-700">
            <div className="mb-3">
              No tenés acceso a este chat. Asignate desde la lista.
            </div>
            <button
              onClick={async () => {
                try {
                  await handleAssignToMe();
                } catch (error) {
                  console.error("Error:", error);
                }
              }}
              className="px-4 py-2 font-medium text-white bg-blue-600 rounded-lg transition-colors duration-200 hover:bg-blue-700"
            >
              Asignarme
            </button>
          </div>
        </main>
      )}

      {/* Área de entrada de mensajes - Solo si tiene acceso de lectura */}
      {canRead && (
        <div className="border-t border-[#CDEBD6] bg-[#F6FBF7]">
          <div className="px-3 py-3 md:px-4">
            <div className="flex flex-col gap-2 mx-auto w-full max-w-none">
              <QuickRepliesBar onPick={onPickQuick} />

              <div className="relative flex items-end gap-2 rounded-xl border border-[#CDEBD6] bg-white p-2 shadow-sm">
                {/* Botón de adjuntos */}
                <div className="relative">
                  <button
                    ref={attachBtnRef}
                    className="btn btn-square btn-sm border border-[#CDEBD6] bg-white text-black hover:bg-[#F1FAF3]"
                    disabled={!canWrite || sending}
                    onClick={() => setShowAttachMenu(!showAttachMenu)}
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

                {/* Botón enviar */}
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

          {/* Inputs ocultos para archivos */}
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={onPickImage}
          />
          <input
            ref={audioInputRef}
            type="file"
            accept="audio/*"
            className="hidden"
            onChange={onPickAudio}
          />
        </div>
      )}

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
