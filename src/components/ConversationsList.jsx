import { useEffect, useMemo, useState } from "react";
import { db } from "../firebase";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";

export default function ConversationsList({ activeId, onSelect }) {
  const [items, setItems] = useState([]);
  const [qtext, setQtext] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const qq = query(
      collection(db, "conversations"),
      orderBy("lastMessageAt", "desc")
    );
    const unsub = onSnapshot(qq, (snap) => {
      setItems(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const filtered = useMemo(() => {
    if (!qtext.trim()) return items;
    const s = qtext.toLowerCase();
    return items.filter((c) => c.id.toLowerCase().includes(s));
  }, [items, qtext]);

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b">
        <input
          className="w-full p-2 text-sm border rounded"
          placeholder="Buscar número..."
          value={qtext}
          onChange={(e) => setQtext(e.target.value)}
        />
      </div>

      {loading ? (
        <div className="p-4 text-sm text-gray-500">Cargando…</div>
      ) : filtered.length === 0 ? (
        <div className="p-4 text-sm text-gray-500">
          {qtext ? "Sin resultados." : "Sin conversaciones todavía."}
          {!qtext && <div>Creá una con el botón “Nueva”.</div>}
        </div>
      ) : (
        <div className="overflow-y-auto">
          {filtered.map((c) => (
            <button
              key={c.id}
              onClick={() => onSelect(c.id)}
              className={`w-full text-left p-3 border-b hover:bg-gray-50 ${
                activeId === c.id ? "bg-gray-100" : ""
              }`}
            >
              <div className="font-medium">{c.id}</div>
              <div className="text-xs text-gray-500">
                {c.lastMessageAt?.toDate
                  ? c.lastMessageAt.toDate().toLocaleString()
                  : ""}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
