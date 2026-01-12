import React, { useState } from "react";
import { collection, query, where, orderBy, startAt, endAt, getDocs } from "firebase/firestore";
import { db } from "../firebase";

/**
 * onResults(results:Array<Message>) recibe el array mergeado sin duplicados.
 */
export default function ConversationSearch({ conversationId, onResults }) {
  const [qtext, setQtext] = useState("");
  const [type, setType] = useState(""); // "image" | "video" | "document" | "audio" | ""
  const [from, setFrom] = useState(""); // yyyy-mm-dd
  const [to, setTo] = useState("");     // yyyy-mm-dd
  const [loading, setLoading] = useState(false);

  async function run() {
    if (!conversationId) return;
    setLoading(true);

    const col = collection(db, "conversations", conversationId, "messages");
    const queries = [];

    // Texto (prefijo) -> mantener textLower al guardar
    if (qtext) {
      const low = qtext.toLowerCase();
      queries.push(query(col, orderBy("textLower"), startAt(low), endAt(low + "\uf8ff")));
    }

    // Tipo de media
    if (type) {
      queries.push(query(col, where("media.kind", "==", type), orderBy("timestamp", "desc")));
    }

    // Rango de fechas
    if (from || to) {
      const f = from ? new Date(from) : new Date(0);
      const t = to ? new Date(to) : new Date();
      queries.push(
        query(col, where("timestamp", ">=", f), where("timestamp", "<=", t), orderBy("timestamp", "desc"))
      );
    }

    // Default: últimos mensajes
    if (!queries.length) {
      queries.push(query(col, orderBy("timestamp", "desc")));
    }

    const map = new Map();
    for (const qx of queries) {
      const snap = await getDocs(qx);
      snap.forEach((d) => map.set(d.id, { id: d.id, ...d.data() }));
    }

    onResults && onResults(Array.from(map.values()));
    setLoading(false);
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div>
        <label className="text-xs label">Texto</label>
        <input
          className="input input-sm input-bordered"
          value={qtext}
          onChange={(e) => setQtext(e.target.value)}
          placeholder="Buscar…"
        />
      </div>
      <div>
        <label className="text-xs label">Tipo</label>
        <select
          className="select select-sm select-bordered"
          value={type}
          onChange={(e) => setType(e.target.value)}
        >
          <option value="">Todos</option>
          <option value="image">Fotos</option>
          <option value="video">Videos</option>
          <option value="document">Documentos</option>
          <option value="audio">Audios</option>
        </select>
      </div>
      <div>
        <label className="text-xs label">Desde</label>
        <input
          type="date"
          className="input input-sm input-bordered"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
      </div>
      <div>
        <label className="text-xs label">Hasta</label>
        <input
          type="date"
          className="input input-sm input-bordered"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
      </div>
      <button className="btn btn-sm" disabled={loading} onClick={run}>
        {loading ? "Buscando…" : "Buscar"}
      </button>
    </div>
  );
}
