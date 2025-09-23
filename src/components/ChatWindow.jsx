// src/components/ChatWindow.jsx
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
} from "firebase/firestore";
import { db } from "../firebase";
import { sendMessage } from "../services/api";
import { useAuthState } from "../hooks/useAuthState.js";
import TemplatesPicker from "./TemplatesPicker.jsx";
import { listLabels } from "../lib/labels";

import StagePicker from "./StagePicker.jsx";
import QuickRepliesBar from "./QuickRepliesBar.jsx";
import ClientProfile from "./ClientProfile.jsx";
import TagsMenu from "./TagsMenu.jsx";

// ⭐ Destacados
import StarButton from "./StarButton.jsx";
import ChatDestacadosPanel from "./ChatDestacadosPanel.jsx";

function formatTs(ts) {
  const d = ts?.toDate ? ts.toDate() : (ts ? new Date(ts) : null);
  return d ? d.toLocaleString() : "";
}

export default function ChatWindow({ conversationId }) {
  const navigate = useNavigate();
  const { user } = useAuthState();

  // mensajes
  const [msgs, setMsgs] = useState([]);
  const [sending, setSending] = useState(false);
  const [text, setText] = useState("");

  // labels
  const [convSlugs, setConvSlugs] = useState([]);
  const [allLabels, setAllLabels] = useState([]);

  // contacto + meta conversación
  const [contact, setContact] = useState(null);
  const [convMeta, setConvMeta] = useState(null);

  // UI
  const [showProfile, setShowProfile] = useState(false);
  const [showTags, setShowTags] = useState(false);

  // ⭐ pestañas (chat | destacados)
  const [tab, setTab] = useState("chat");

  const viewportRef = useRef(null);
  const textareaRef = useRef(null);

  // catálogo de etiquetas
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

  // mensajes
  useEffect(() => {
    if (!conversationId) {
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
        if (tab === "chat") {
          requestAnimationFrame(() => {
            viewportRef.current?.scrollTo({ top: 1e9, behavior: "smooth" });
          });
        }
      },
      (err) => console.error("onSnapshot(messages) error:", err)
    );
    return () => unsub();
  }, [conversationId, tab]);

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

  // permisos de envío
  const isAdmin =
    !!user?.email &&
    ["federudiero@gmail.com", "fede_rudiero@gmail.com"].includes(user.email);

  const canWrite = useMemo(() => {
    if (isAdmin) return true;
    const assignedToUid = convMeta?.assignedToUid || null;
    if (!assignedToUid) return true; // libre
    return assignedToUid === user?.uid;
  }, [convMeta?.assignedToUid, user?.uid, isAdmin]);

  // quitar etiqueta
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

  // enviar
  const doSend = async () => {
    const body = (text || "").trim();
    if (!conversationId || !body || sending || !canWrite) return;

    setSending(true);
    try {
      const r = await sendMessage({ to: String(conversationId), text: body });
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

      setText("");
    } catch (e) {
      alert(e?.message || "No se pudo enviar");
    } finally {
      setSending(false);
    }
  };

  const onMsgKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      doSend();
    }
  };

  // contexto para plantillas
  const templateContext = {
    nombre: contact?.name || contact?.fullName || "",
    vendedor: user?.displayName || user?.email || "",
    fecha: new Date().toLocaleDateString(),
    link: window?.location?.href || "",
  };

  const onPickQuick = (t) => {
    if (!t) return;
    setText((prev) => (prev ? prev + (prev.endsWith("\n") ? "" : "\n") + t : t));
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const phone = useMemo(
    () => convMeta?.clientPhone || contact?.phone || "",
    [convMeta?.clientPhone, contact?.phone]
  );

  const contactId = useMemo(
    () => String(conversationId || phone || ""),
    [conversationId, phone]
  );

  return (
    <div className="flex flex-col h-full text-black bg-[#F6FBF7]">
      {/* Header (2 filas) */}
      <header className="sticky top-0 z-40 border-b bg-[#E8F5E9]/90 border-[#CDEBD6] backdrop-blur">
        <div className="px-4 pt-2 pb-2 space-y-2">
          {/* Fila 1: título + acciones */}
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-xs">Conversación</div>
              <h2 className="text-lg font-semibold truncate">
                {contact?.name || String(conversationId || "")}
              </h2>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <TemplatesPicker
                mode="modal"
                anchorToBody
                backdrop
                onInsert={(txt) => {
                  setText((prev) => (prev ? prev + "\n" + txt : txt));
                  requestAnimationFrame(() => textareaRef.current?.focus());
                }}
                context={templateContext}
              />
              <button
                className="text-black btn btn-sm bg-white hover:bg-[#F1FAF3] border border-[#CDEBD6]"
                onClick={() => setShowTags(true)}
                title="Etiquetar conversación"
              >
                Etiquetar
              </button>
              <button
                className="text-black btn btn-sm bg-white hover:bg-[#F1FAF3] border border-[#CDEBD6]"
                onClick={() => setShowProfile((v) => !v)}
                title="Ver perfil del cliente"
              >
                Perfil
              </button>
              <div className="shrink-0">
                <StagePicker
                  conversationId={conversationId}
                  value={convMeta?.stage}
                />
              </div>
            </div>
          </div>

          {/* Fila 2: chips (solo etiquetas) */}
          <div className="flex items-center gap-2 overflow-x-auto px-0.5 pb-1">
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

      {/* ⭐ pestañas */}
      <div className="px-4 pt-2">
        <div className="flex overflow-hidden border rounded bg-white/70 border-[#CDEBD6]">
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

      {/* Contenido principal */}
      {tab === "chat" ? (
        // ====== Vista chat ======
        <main ref={viewportRef} className="flex-1 px-4 py-4 overflow-y-auto">
          {msgs.length === 0 && (
            <div className="p-4 mx-auto text-sm text-center border rounded-xl bg-[#EAF7EE] border-[#CDEBD6]">
              Sin mensajes todavía.
            </div>
          )}

          <div className="flex flex-col w-full gap-3 mx-auto max-w-none">
            {msgs.map((m) => {
              const isOut = m?.direction === "out";
              const status = m?.status || "";
              const toRawSent = m?.toRawSent || "";
              const variant = m?.sendVariant || "";
              const errCode =
                m?.error?.error?.code ??
                m?.error?.code ??
                (status === "error" ? "?" : "");

              // texto visible (con fallback)
              const visibleText =
                typeof m?.text === "string"
                  ? m.text
                  : m?.template
                  ? `[template] ${m.template}`
                  : JSON.stringify(m?.text || "");

              // ⭐ Opción 2 (UI): sólo mostrar la estrella para estados permitidos
              const allowStar = ["sent", "delivered", "read"].includes(status);

              return (
                <div
                  key={m.id}
                  className={`chat ${isOut ? "chat-end" : "chat-start"}`}
                >
                  {/* Burbuja + ⭐ (condicional) */}
                  <div className="flex items-center gap-2">
                    <div
                      className={
                        "chat-bubble whitespace-pre-wrap shadow " +
                        (isOut
                          ? "chat-bubble-primary text-white"
                          : "bg-[#EAF7EE] text-black border border-[#CDEBD6]")
                      }
                    >
                      {visibleText}
                    </div>

                    {allowStar && (
                      <StarButton
                        chatId={conversationId}
                        messageId={m.id}
                        texto={visibleText}
                      />
                    )}
                  </div>

                  <div className="chat-footer mt-1 text-[10px]">
                    {formatTs(m?.timestamp)}
                    {isOut && (
                      <>
                        {" • "}
                        {status === "error" ? "❌ no enviado" : "✅ enviado"}
                        {toRawSent ? ` • a ${toRawSent}` : ""}
                        {variant ? ` (${variant})` : ""}
                        {status === "error" && errCode ? ` • code ${errCode}` : ""}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </main>
      ) : (
        // ====== Vista destacados ======
        <main className="flex-1 px-4 py-4 overflow-y-auto">
          <ChatDestacadosPanel chatId={conversationId} />
        </main>
      )}

      {/* Input */}
      <div className="border-t bg-[#F6FBF7] border-[#CDEBD6]">
        <div className="px-4 py-3">
          <div className="flex flex-col w-full gap-2 mx-auto max-w-none">
            <QuickRepliesBar onPick={onPickQuick} />

            <div className="flex items-end gap-2 p-2 border shadow-sm rounded-xl bg-white border-[#CDEBD6]">
              <textarea
                ref={textareaRef}
                className="textarea textarea-bordered w-full min-h-[48px] max-h-40 resize-y text-black placeholder:text-black/60 border-[#CDEBD6] focus:border-[#2E7D32]"
                placeholder={
                  canWrite
                    ? "Escribí un mensaje… (Enter para enviar)"
                    : "Conversación asignada a otro agente"
                }
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={onMsgKeyDown}
                disabled={!canWrite}
              />

              <button
                onClick={doSend}
                disabled={!text.trim() || sending || !canWrite}
                className="btn"
                style={{ backgroundColor: "#2E7D32", borderColor: "#2E7D32", color: "#fff" }}
                title="Enviar (Enter)"
              >
                {sending ? "Enviando…" : "Enviar"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Drawer de perfil */}
      {showProfile && (
        <div className="fixed inset-y-0 right-0 w-full max-w-md bg-base-100 shadow-xl border-l z-[80] border-[#CDEBD6]">
          <div className="flex items-center justify-between p-3 border-b border-[#CDEBD6]">
            <h3 className="font-semibold">Perfil de cliente</h3>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setShowProfile(false)}
            >
              Cerrar
            </button>
          </div>
          <div className="h-full p-3 overflow-auto">
            <ClientProfile
              contactId={contactId}
              phone={phone}
              conversationId={conversationId}
            />
          </div>
        </div>
      )}

      {/* Modal de etiquetas */}
      {showTags && (
        <div
          className="fixed inset-0 z-[90] bg-black/40 grid place-items-center p-4"
          onClick={() => setShowTags(false)}
        >
          <div
            className="w-full max-w-md shadow-xl bg-base-100 rounded-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-3 border-b">
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
