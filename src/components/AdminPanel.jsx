// src/components/AdminPanel.jsx
import { useEffect, useState } from "react";
import { db } from "../firebase";
import {
  collection, getDocs, doc, updateDoc, arrayUnion, arrayRemove
} from "firebase/firestore";
import AdminVendors from "./AdminVendors.jsx";

export default function AdminPanel() {
  const [tab, setTab] = useState("numbers"); // "numbers" | "convs"
  const [convs, setConvs] = useState([]);
  const etiquetas = ["nuevo", "vip", "reclamo", "deuda", "no-contactar", "vendido"];

  useEffect(() => {
    if (tab !== "convs") return;
    (async () => {
      const snap = await getDocs(collection(db, "conversations"));
      setConvs(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    })();
  }, [tab]);

  const toggleLabel = async (convId, label) => {
    const c = convs.find(c => c.id === convId);
    const current = c?.labels || [];
    const ref = doc(db, "conversations", convId);
    const has = current.includes(label);
    await updateDoc(ref, { labels: has ? arrayRemove(label) : arrayUnion(label) });
    setConvs(prev =>
      prev.map(x =>
        x.id === convId
          ? { ...x, labels: has ? x.labels.filter(l => l !== label) : [...(x.labels || []), label] }
          : x
      )
    );
  };

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-lg font-bold">Panel de administración</h2>

      {/* Pestañas */}
      <div className="flex gap-2">
        <button
          className={"px-3 py-1 border rounded " + (tab === "numbers" ? "bg-black text-white" : "bg-white")}
          onClick={() => setTab("numbers")}
        >
          Números de vendedores
        </button>
        <button
          className={"px-3 py-1 border rounded " + (tab === "convs" ? "bg-black text-white" : "bg-white")}
          onClick={() => setTab("convs")}
        >
          Conversaciones
        </button>
      </div>

      {/* Contenido de cada pestaña */}
      {tab === "numbers" ? (
        <AdminVendors />
      ) : (
        <div className="space-y-4">
          {convs.map((c) => (
            <div key={c.id} className="p-4 border rounded">
              <div className="font-mono text-sm">{c.contact?.name || c.id}</div>
              <div className="text-xs text-gray-600">
                Asignado a: {c.assignedToName || "Sin asignar"}
              </div>
              <div className="flex flex-wrap gap-2 mt-2">
                {etiquetas.map((et) => {
                  const activa = (c.labels || []).includes(et);
                  return (
                    <button
                      key={et}
                      onClick={() => toggleLabel(c.id, et)}
                      className={
                        "px-2 py-1 text-xs rounded border " +
                        (activa ? "bg-blue-600 text-white" : "bg-white")
                      }
                    >
                      {et}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
