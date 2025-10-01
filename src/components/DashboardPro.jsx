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

  // Función para formatear tiempo en formato legible
  const formatTime = (seconds) => {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
    return `${Math.round(seconds / 3600)}h`;
  };

  // Función para formatear fecha
  const formatDate = (dateStr) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('es-ES', { 
      day: '2-digit', 
      month: 'short' 
    });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100 p-4 md:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="text-4xl md:text-5xl font-bold bg-gradient-to-r from-blue-600 via-purple-600 to-indigo-600 bg-clip-text text-transparent">
            Dashboard Profesional
          </h1>
          <p className="text-gray-600 text-lg">
            Métricas clave y análisis de rendimiento
          </p>
        </div>

        {/* KPIs Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-6 shadow-lg border border-white/20 hover:shadow-xl transition-all duration-300">
            <div className="flex items-center space-x-4">
              <div className="p-3 bg-gradient-to-r from-blue-500 to-blue-600 rounded-xl">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-600">Total Conversaciones</p>
                <p className="text-2xl font-bold text-gray-900">{convs.length}</p>
              </div>
            </div>
          </div>

          <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-6 shadow-lg border border-white/20 hover:shadow-xl transition-all duration-300">
            <div className="flex items-center space-x-4">
              <div className="p-3 bg-gradient-to-r from-green-500 to-green-600 rounded-xl">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-600">Conversaciones Cerradas</p>
                <p className="text-2xl font-bold text-gray-900">{closedByAgent.reduce((sum, agent) => sum + agent.v, 0)}</p>
              </div>
            </div>
          </div>

          <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-6 shadow-lg border border-white/20 hover:shadow-xl transition-all duration-300">
            <div className="flex items-center space-x-4">
              <div className="p-3 bg-gradient-to-r from-purple-500 to-purple-600 rounded-xl">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-600">Agentes Activos</p>
                <p className="text-2xl font-bold text-gray-900">{avgRespByAgent.length}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
          {/* Conversaciones por día */}
          <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-6 shadow-lg border border-white/20">
            <div className="flex items-center space-x-3 mb-6">
              <div className="p-2 bg-gradient-to-r from-blue-500 to-indigo-500 rounded-lg">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              <h3 className="text-xl font-bold text-gray-900">Nuevas Conversaciones por Día</h3>
            </div>
            <div className="max-h-96 overflow-y-auto">
              <div className="space-y-2">
                {byDay.slice(-10).map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between p-3 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg border border-blue-100 hover:shadow-md transition-all duration-200">
                    <span className="font-medium text-gray-700">{formatDate(k)}</span>
                    <div className="flex items-center space-x-2">
                      <div className="w-20 bg-gray-200 rounded-full h-2">
                        <div 
                          className="bg-gradient-to-r from-blue-500 to-indigo-500 h-2 rounded-full transition-all duration-300"
                          style={{ width: `${Math.min(100, (v / Math.max(...byDay.map(([,val]) => val))) * 100)}%` }}
                        ></div>
                      </div>
                      <span className="font-bold text-blue-600 min-w-[2rem] text-right">{v}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Tiempo de respuesta por vendedor */}
          <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-6 shadow-lg border border-white/20">
            <div className="flex items-center space-x-3 mb-6">
              <div className="p-2 bg-gradient-to-r from-purple-500 to-pink-500 rounded-lg">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 className="text-xl font-bold text-gray-900">Tiempo Promedio de 1ª Respuesta</h3>
            </div>
            <div className="max-h-96 overflow-y-auto">
              <div className="space-y-3">
                {avgRespByAgent.map((r, index) => (
                  <div key={r.k} className="flex items-center justify-between p-4 bg-gradient-to-r from-purple-50 to-pink-50 rounded-lg border border-purple-100 hover:shadow-md transition-all duration-200">
                    <div className="flex items-center space-x-3">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-sm ${
                        index === 0 ? 'bg-gradient-to-r from-green-500 to-emerald-500' :
                        index === 1 ? 'bg-gradient-to-r from-blue-500 to-cyan-500' :
                        index === 2 ? 'bg-gradient-to-r from-orange-500 to-red-500' :
                        'bg-gradient-to-r from-gray-500 to-slate-500'
                      }`}>
                        {index + 1}
                      </div>
                      <span className="font-medium text-gray-700">{r.k}</span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <span className="text-sm text-gray-500">Responde en</span>
                      <span className="font-bold text-purple-600 bg-purple-100 px-3 py-1 rounded-full">
                        {formatTime(r.v)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Conversaciones cerradas por vendedor */}
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-6 shadow-lg border border-white/20">
          <div className="flex items-center space-x-3 mb-6">
            <div className="p-2 bg-gradient-to-r from-green-500 to-emerald-500 rounded-lg">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h3 className="text-xl font-bold text-gray-900">Conversaciones Cerradas por Vendedor</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {closedByAgent.map((r, index) => (
              <div key={r.k} className="p-4 bg-gradient-to-br from-green-50 to-emerald-500 rounded-xl border border-green-100 hover:shadow-lg transition-all duration-200">
                <div className="flex items-center justify-between mb-2">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-white font-bold text-xs ${
                    index === 0 ? 'bg-gradient-to-r from-yellow-400 to-orange-500' :
                    index === 1 ? 'bg-gradient-to-r from-gray-400 to-gray-500' :
                    index === 2 ? 'bg-gradient-to-r from-orange-600 to-red-500' :
                    'bg-gradient-to-r from-green-500 to-emerald-500'
                  }`}>
                    {index + 1}
                  </div>
                  <span className="text-2xl font-bold text-green-600">{r.v}</span>
                </div>
                <p className="font-medium text-gray-700 truncate" title={r.k}>{r.k}</p>
                <p className="text-xs text-gray-500 mt-1">conversaciones cerradas</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
