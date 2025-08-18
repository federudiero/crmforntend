import { useState } from "react";
import { sendMessage } from "../services/api";

export default function NewConversation({ onOpen }) {
  const [to, setTo] = useState("+5493512602142");
  const [text, setText] = useState("Hola 👋");
  const [loading, setLoading] = useState(false);

  const create = async () => {
    const phone = to.trim();
    if (!phone) return;
    setLoading(true);
    try {
      // 🚫 ya no mandamos conversationId
      const r = await sendMessage({ to: phone, text });
      // ✅ abrir exactamente la conv donde el backend guardó el mensaje
      const convId = r?.results?.[0]?.to || phone;
      onOpen?.(convId);
    } catch (e) {
      alert(e?.message || "No se pudo crear");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <input
        className="p-1 border rounded w-36"
        placeholder="+549..."
        value={to}
        onChange={(e) => setTo(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && !loading && create()}
      />
      <input
        className="p-1 border rounded w-52"
        placeholder="Mensaje inicial"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && !loading && create()}
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
