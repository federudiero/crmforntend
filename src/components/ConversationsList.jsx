import { useEffect, useMemo, useState } from "react";
import { db } from "../firebase";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  limit,
  doc,
  getDoc,
} from "firebase/firestore";

/** Formatea fecha corta para la columna izquierda */
function formatShort(ts) {
  const d = ts?.toDate ? ts.toDate() : (ts ? new Date(ts) : null);
  return d ? d.toLocaleString() : "";
}

export default function ConversationsList({ activeId, onSelect }) {
  const [items, setItems] = useState([]);

  useEffect(() => {
    const qRef = query(
      collection(db, "conversations"),
      orderBy("lastMessageAt", "desc"),
      limit(100)
    );
    const unsub = onSnapshot(qRef, async (snap) => {
      const rows = await Promise.all(
        snap.docs.map(async (d) => {
          // Podés traer algún dato extra del contacto si querés
          let contact = null;
          try {
            const c = await getDoc(doc(db, "contacts", d.id));
            contact = c.exists() ? c.data() : null;
          } catch (e){console.error(e)}
          return { id: d.id, ...d.data(), contact };
        })
      );
      setItems(rows);
    });
    return () => unsub();
  }, []);

  const list = useMemo(() => items, [items]);

  return (
    <div className="flex flex-col">
      <div className="p-2">
        <input
          className="w-full p-2 border rounded"
          placeholder="Buscar número..."
          // (opcional) podrías filtrar acá
          onChange={() => {}}
        />
      </div>

      <div className="flex-1 overflow-y-auto">
        {list.map((c) => {
          const isActive = String(c.id) === String(activeId || "");
          return (
            <button
              key={c.id}
              onClick={() => onSelect?.(c.id)}
              className={
                "w-full text-left px-3 py-2 border-t hover:bg-gray-50 " +
                (isActive ? "bg-gray-100" : "")
              }
            >
              <div className="font-mono text-sm break-all">{c.id}</div>
              <div className="text-xs text-gray-500">
                {formatShort(c.lastMessageAt)}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
