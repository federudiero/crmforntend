import { useState } from "react";
import { sendMessage } from "../services/api";

/**
 * Crea una conversación nueva:
 * - Envia el mensaje con `to` tal como lo escribió el usuario.
 * - Abre SIEMPRE la conversación que devuelve el backend en results[0].to
 *   (ya normalizado a +549… cuando corresponde).
 */
export default function NewConversation({ onOpen }) {
  const [to, setTo] = useState("+5493518120950");
  const [text, setText] = useState("Hola 👋");
  const [loading, setLoading] = useState(false);

  const create = async () => {
    const phone = (to || "").trim();
    if (!phone || loading) return;
    setLoading(true);
    try {
      // 👇 NO mandamos conversationId; el servidor decide el correcto.
      const r = await sendMessage({ to: phone, text });
      const convId = r?.results?.[0]?.to || phone; // ej. "+5493518120950"
      onOpen?.(convId);
      setText("");
    } catch (e) {
      alert(e?.message || "No se pudo crear");
    } finally {
      setLoading(false);
    }
  };

  const onKey = (e) => (e.key === "Enter" && !loading ? create() : null);

  return (
    <div className="flex items-center gap-2">
      <input
        className="p-1 border rounded w-36"
        placeholder="+549..."
        value={to}
        onChange={(e) => setTo(e.target.value)}
        onKeyDown={onKey}
      />
      <input
        className="p-1 border rounded w-52"
        placeholder="Mensaje inicial"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
      />
      <button
        disabled={loading}
        onClick={create}
        className="px-2 py-1 text-sm text-white bg-black rounded"
      >
        {loading ? "Enviando..." : "Nueva"}
      </button>
    </div>
  );
}
