// src/components/DashboardPro.jsx
import React, { useEffect, useMemo, useState } from "react";
import { db } from "../firebase";
import {
  collection,  getDocs, limit, orderBy, query
} from "firebase/firestore";

/**
 * Dashboard con métricas clave:
 * - Conversaciones nuevas por día (últimos 30 días)
 * - Tiempo promedio de 1ª respuesta por vendedor
 * - Conversaciones cerradas por vendedor
 */
export default function DashboardPro() {
  const [convs, setConvs] = useState([]);
  const [msgsByConv, setMsgsByConv] = useState({});

  useEffect(() => {
    (async () => {
      const q = query(collection(db, "conversations"), orderBy("createdAt", "desc"), limit(800));
      const snap = await getDocs(q);
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setConvs(list);

      // Cargamos primeros mensajes por conversación para medir 1ª respuesta
      const all = {};
      for (const c of list.slice(0, 100)) { // limitar para no saturar
        try {
          const q2 = query(
            collection(db, "conversations", c.id, "messages"),
            orderBy("timestamp", "asc"),
            limit(10)
          );
          const s2 = await getDocs(q2);
          all[c.id] = s2.docs.map(d => ({ id: d.id, ...d.data() }));
        } catch (e){console.error(e)}
      }
      setMsgsByConv(all);
    })();
  }, []);

  const byDay = useMemo(() => {
    const map = new Map();
    for (const c of convs) {
      const d = c.createdAt?.toDate?.() || (c.createdAt ? new Date(c.createdAt) : null) || new Date();
      const key = d.toISOString().slice(0,10);
      map.set(key, 1 + (map.get(key) || 0));
    }
    return Array.from(map.entries()).sort((a,b) => a[0].localeCompare(b[0]));
  }, [convs]);

  const avgRespByAgent = useMemo(() => {
    // tiempo entre primer msg del cliente y primera respuesta "outgoing"
    const acc = {};
    for (const c of convs) {
      const ms = msgsByConv[c.id] || [];
      if (!ms.length) continue;
      const incoming = ms.find(m => m.direction === "in" || m.fromCustomer);
      const reply = ms.find(m => (m.direction === "out" || m.fromAgent) && (!incoming || (m.timestamp >= incoming.timestamp)));
      if (!incoming || !reply) continue;
      const dt = (new Date(reply.timestamp?.toDate?.() || reply.timestamp) - new Date(incoming.timestamp?.toDate?.() || incoming.timestamp)) / 1000;
      const who = c.assignedToName || "—";
      acc[who] = acc[who] || { sum: 0, n: 0 };
      acc[who].sum += dt; acc[who].n += 1;
    }
    return Object.entries(acc).map(([k, v]) => ({ k, v: Math.round(v.sum / Math.max(1,v.n)) }))
      .sort((a,b) => a.v - b.v);
  }, [convs, msgsByConv]);

  const closedByAgent = useMemo(() => {
    const map = new Map();
    for (const c of convs) {
      if (c.stage === "cerrado") {
        const k = c.assignedToName || "—";
        map.set(k, 1 + (map.get(k) || 0));
      }
    }
    return Array.from(map.entries()).map(([k,v]) => ({ k, v })).sort((a,b)=>b.v - a.v);
  }, [convs]);

  return (
    <div className="p-4 space-y-6">
      <h2 className="text-lg font-semibold">Dashboard</h2>

      <section>
        <div className="mb-2 font-medium">Nuevas conversaciones por día</div>
        <div className="overflow-x-auto">
          <table className="table w-auto table-zebra">
            <thead><tr><th>Día</th><th>Total</th></tr></thead>
            <tbody>
              {byDay.map(([k,v]) => <tr key={k}><td>{k}</td><td>{v}</td></tr>)}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <div className="mb-2 font-medium">Promedio 1ª respuesta (segundos) por vendedor</div>
        <div className="overflow-x-auto">
          <table className="table w-auto">
            <thead><tr><th>Vendedor</th><th>Segundos</th></tr></thead>
            <tbody>
              {avgRespByAgent.map(r => <tr key={r.k}><td>{r.k}</td><td>{r.v}</td></tr>)}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <div className="mb-2 font-medium">Cerradas por vendedor</div>
        <div className="overflow-x-auto">
          <table className="table w-auto">
            <thead><tr><th>Vendedor</th><th>Cerradas</th></tr></thead>
            <tbody>
              {closedByAgent.map(r => <tr key={r.k}><td>{r.k}</td><td>{r.v}</td></tr>)}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
