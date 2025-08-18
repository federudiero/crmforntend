// src/components/ChatWindow.jsx
import { useEffect, useRef, useState } from "react";
import { db } from "../firebase";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { sendMessage } from "../services/api";

// Formatea Firestore Timestamp o milisegundos
function formatTs(ts) {
  const d = ts?.toDate ? ts.toDate() : (ts ? new Date(ts) : null);
  return d ? d.toLocaleString() : "";
}

export default function ChatWindow({ conversationId }) {
  const [msgs, setMsgs] = useState([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const viewportRef = useRef(null);

  // Suscripción a Firestore
  useEffect(() => {
    if (!conversationId) {
      setMsgs([]);
      return;
    }
    const messagesRef = collection(
      db,
      "conversations",
      String(conversationId),
      "messages"
    );
    const qRef = query(messagesRef, orderBy("timestamp", "asc"));

    const unsub = onSnapshot(
      qRef,
      (snap) => {
        const arr = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setMsgs(arr);
        // scroll suave al final
        requestAnimationFrame(() => {
          viewportRef.current?.scrollTo({ top: 1e9, behavior: "smooth" });
        });
      },
      (err) => {
        console.error("onSnapshot error:", err);
      }
    );

    return () => unsub();
  }, [conversationId]);

  // Enviar mensaje
  const doSend = async () => {
    const body = text.trim();
    if (!body || sending || !conversationId) return;
    setSending(true);
    try {
     await sendMessage({
  to: String(conversationId),
  text: body,
});
      setText("");
    } catch (e) {
      console.error(e);
      alert(e?.message || "No se pudo enviar");
    } finally {
      setSending(false);
    }
  };

  // Enter envía / Shift+Enter salto
  const onKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      doSend();
    }
  };

  return (
    <div className="flex flex-col h-full">
      <header className="p-3 border-b">
        <div className="font-semibold break-all">{String(conversationId || "")}</div>
      </header>

      <div ref={viewportRef} className="flex-1 p-3 space-y-2 overflow-y-auto">
        {msgs.length === 0 && (
          <div className="text-sm text-gray-500">Sin mensajes todavía.</div>
        )}

        {msgs.map((m) => (
          <div
            key={m.id}
            className={
              "p-2 rounded " +
              (m?.direction === "out" ? "ml-auto bg-black text-white" : "bg-gray-100")
            }
          >
            <div>{typeof m?.text === "string" ? m.text : JSON.stringify(m?.text || "")}</div>
            <div className="text-[10px] opacity-60 mt-1">
              {formatTs(m?.timestamp)}
            </div>
          </div>
        ))}
      </div>

      <div className="p-3 border-t">
        <div className="flex gap-2">
          <textarea
            className="flex-1 border rounded p-2 min-h-[44px] max-h-40"
            placeholder="Escribí un mensaje… (Enter para enviar)"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
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
