// src/components/ChatWindow.jsx
import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  arrayUnion,
  arrayRemove,
} from "firebase/firestore";
import { db } from "../firebase";
import { sendMessage } from "../services/api";

/** Opciones fijas permitidas para etiquetas (editá a gusto) */
const ALLOWED_TAGS = [
  { slug: "nuevo",        name: "Nuevo" },
  { slug: "vip",          name: "VIP" },
  { slug: "reclamo",      name: "Reclamo" },
  { slug: "deuda",        name: "Deuda" },
  { slug: "no-contactar", name: "No contactar" },
   { slug: "vendido",      name: "Vendido" }, 
];

/** Colores simples por slug (opcional) */
const TAG_STYLE = {
  vip: "bg-amber-100 border-amber-300",
  reclamo: "bg-red-100 border-red-300",
  deuda: "bg-orange-100 border-orange-300",
  "no-contactar": "bg-gray-200 border-gray-300",
  nuevo: "bg-green-100 border-green-300",
    vendido: "bg-blue-100 border-blue-300",
};

/** Formatea Firestore Timestamp o milisegundos */
function formatTs(ts) {
  const d = ts?.toDate ? ts.toDate() : (ts ? new Date(ts) : null);
  return d ? d.toLocaleString() : "";
}

export default function ChatWindow({ conversationId }) {
  const navigate = useNavigate();

  // mensajes del hilo
  const [msgs, setMsgs] = useState([]);
  // input
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  // etiquetas (solo slugs)
  const [convSlugs, setConvSlugs] = useState([]);
  const [selTag, setSelTag] = useState(""); // valor del <select>

  // viewport para autoscroll
  const viewportRef = useRef(null);

  // ────────────────────────────────────────────────────────────
  // Suscripción a MENSAJES del hilo
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
        requestAnimationFrame(() => {
          viewportRef.current?.scrollTo({ top: 1e9, behavior: "smooth" });
        });
      },
      (err) => console.error("onSnapshot(messages) error:", err)
    );
    return () => unsub();
  }, [conversationId]);

  // Suscripción al DOC de la conversación (para labels)
  useEffect(() => {
    if (!conversationId) return;
    const unsub = onSnapshot(
      doc(db, "conversations", String(conversationId)),
      (snap) => {
        const data = snap.data() || {};
        setConvSlugs(Array.isArray(data.labels) ? data.labels : []);
      },
      (err) => console.error("onSnapshot(conversation) error:", err)
    );
    return () => unsub();
  }, [conversationId]);

  // ────────────────────────────────────────────────────────────
  // Etiquetas: add / remove (actualiza solo el array `labels`)
  const addTag = async (slug) => {
    if (!conversationId || !slug) return;
    try {
      await updateDoc(doc(db, "conversations", String(conversationId)), {
        labels: arrayUnion(slug),
      });
    } catch (e) {
      console.error("addTag error:", e);
      alert("No se pudo agregar la etiqueta (revisá reglas de Firestore).");
    } finally {
      setSelTag("");
    }
  };

  const removeTag = async (slug) => {
    if (!conversationId || !slug) return;
    try {
      await updateDoc(doc(db, "conversations", String(conversationId)), {
        labels: arrayRemove(slug),
      });
    } catch (e) {
      console.error("removeTag error:", e);
      alert("No se pudo quitar la etiqueta (revisá reglas de Firestore).");
    }
  };

  // Opciones que faltan (no mostrar duplicadas)
  const availableTags = ALLOWED_TAGS.filter((t) => !convSlugs.includes(t.slug));

  // ────────────────────────────────────────────────────────────
  // Enviar mensaje
  const doSend = async () => {
    const body = (text || "").trim();
    if (!body || sending || !conversationId) return;

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
      console.error(e);
      alert(e?.message || "No se pudo enviar");
    } finally {
      setSending(false);
    }
  };

  // Enter envía / Shift+Enter salto
  const onMsgKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      doSend();
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header del chat */}
      <header className="p-3 space-y-2 border-b">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold break-all truncate">
            {String(conversationId || "")}
          </h2>
        </div>

        {/* Etiquetas: chips + selector controlado */}
        <div className="flex flex-wrap items-center gap-2">
          {convSlugs.map((s) => (
            <span
              key={s}
              className={
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs " +
                (TAG_STYLE[s] || "bg-gray-100 border-gray-300")
              }
              title={s}
            >
              {s}
              <button
                className="opacity-60 hover:opacity-100"
                onClick={() => removeTag(s)}
                aria-label={`Quitar ${s}`}
                title="Quitar"
              >
                ×
              </button>
            </span>
          ))}

          <select
            className="px-2 py-1 text-xs border rounded"
            value={selTag}
            onChange={(e) => {
              const v = e.target.value;
              setSelTag(v);
              if (v) addTag(v); // agrega automáticamente
            }}
            disabled={!conversationId || availableTags.length === 0}
            title="Agregar etiqueta"
          >
            <option value="">{availableTags.length ? "+ agregar etiqueta…" : "Sin opciones"}</option>
            {availableTags.map((t) => (
              <option key={t.slug} value={t.slug}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
      </header>

      {/* Mensajes */}
      <div ref={viewportRef} className="flex-1 p-3 space-y-2 overflow-y-auto">
        {msgs.length === 0 && (
          <div className="text-sm opacity-60">Sin mensajes todavía.</div>
        )}

        {msgs.map((m) => {
          const isOut = m?.direction === "out";
          const bubble =
            "p-2 rounded " +
            (isOut ? "ml-auto bg-black text-white" : "bg-gray-100");

          const toRawSent = m?.toRawSent || "";
          const variant = m?.sendVariant || "";
          const status = m?.status || "";
          const errCode =
            m?.error?.error?.code ??
            m?.error?.code ??
            (status === "error" ? "?" : "");

          return (
            <div key={m.id} className={bubble}>
              <div>
                {typeof m?.text === "string"
                  ? m.text
                  : m?.template
                  ? `[template] ${m.template}`
                  : JSON.stringify(m?.text || "")}
              </div>

              <div className="text-[10px] opacity-60 mt-1">
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

      {/* Input */}
      <div className="p-3 border-t">
        <div className="flex gap-2">
          <textarea
            className="flex-1 border rounded p-2 min-h-[44px] max-h-40"
            placeholder="Escribí un mensaje… (Enter para enviar)"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onMsgKeyDown}
          />
          <button
            onClick={doSend}
            disabled={!text.trim() || sending}
            className="px-4 text-white bg-black rounded"
            title="Enviar (Enter)"
          >
            {sending ? "Enviando…" : "Enviar"}
          </button>
        </div>
      </div>
    </div>
  );
}
