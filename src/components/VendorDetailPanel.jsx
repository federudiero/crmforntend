import React from "react";
import { useEffect, useMemo, useState } from "react";
import { db } from "../firebase";
import {
  collection,
  getDocs,
  doc,
  getDoc,
  onSnapshot,
  query,
  where,
  limit,
  orderBy,
  documentId
} from "firebase/firestore";

/* ========= Helpers ========= */
function startOfDay(d) { const x = new Date(d); x.setHours(0,0,0,0); return x; }
function endOfDay(d)   { const x = new Date(d); x.setHours(23,59,59,999); return x; }
function ymd(d) {
  const x = new Date(d);
  const m = String(x.getMonth()+1).padStart(2,"0");
  const dd= String(x.getDate()).padStart(2,"0");
  return `${x.getFullYear()}-${m}-${dd}`;
}
// ✅ Parsear "YYYY-MM-DD" como fecha LOCAL (no UTC)
function parseLocalYMD(s) {
  if (!s) return new Date();
  const [Y,M,D] = s.split("-").map(Number);
  return new Date(Y, (M||1)-1, D||1);
}
// ✅ Timestamps robustos: Date/Timestamp, ISO, epoch segundos/ms, string numérica
function tsToMs(ts) {
  if (!ts) return 0;
  if (typeof ts === "number") {
    // si es 10 dígitos, epoch s → ms
    return ts < 1e12 ? ts * 1000 : ts;
  }
  if (typeof ts === "string") {
    const num = Number(ts);
    if (!Number.isNaN(num) && ts.trim().match(/^\d+$/)) {
      return num < 1e12 ? num * 1000 : num; // epoch s o ms
    }
    const t = Date.parse(ts);
    if (!Number.isNaN(t)) return t; // ISO
  }
  if (ts?.toMillis) return ts.toMillis();
  if (ts?.toDate) return +ts.toDate();
  try { return +new Date(ts); } catch { return 0; }
}
function toCSV(rows, headers) {
  const head = headers.map(h => `"${h}"`).join(",");
  const body = rows
    .map(r => r.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\n");
  return head + "\n" + body;
}
function downloadCSV(filename, csv) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
function MiniStatCard({ title, value, from = "#eef2ff", to = "#e0e7ff", text = "#1e293b", subtitle }) {
  return (
    <div
      className="p-4 rounded-2xl border shadow-lg"
      style={{ background: `linear-gradient(135deg, ${from}, ${to})`, borderColor: "rgba(148,163,184,.35)" }}
    >
      <div className="text-xs font-semibold tracking-wide uppercase" style={{ color: "#334155" }}>
        {title}
      </div>
      <div className="mt-2 text-3xl font-extrabold" style={{ color: text }}>{value}</div>
      {subtitle && <div className="mt-1 text-xs text-slate-600">{subtitle}</div>}
    </div>
  );
}

/* ===== Presencia helpers (estricto: flag + lastSeen fresco) ===== */
function calcOnline(userLike) {
  if (!userLike) return false;
  const flag =
    userLike.online === true ||
    userLike.isOnline === true ||
    userLike.onlineStatus === "online";
  const ms = tsToMs(userLike.lastSeen);
  const fresh = ms && (Date.now() - ms) < 2 * 60 * 1000; // 2 minutos
  return !!(flag && fresh);
}
function timeAgo(ts) {
  const ms = tsToMs(ts);
  if (!ms) return "";
  const diff = Math.max(0, Date.now() - ms);
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

/* ===== Formato de duración y percentiles ===== */
function fmtDuration(ms) {
  if (!ms || ms < 0) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return `${m}m ${rs}s`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}h ${rm}m`;
}
function median(arr) {
  if (!arr.length) return 0;
  const a = [...arr].sort((x,y)=>x-y);
  const mid = Math.floor(a.length/2);
  return a.length%2 ? a[mid] : (a[mid-1]+a[mid])/2;
}
function p90(arr) {
  if (!arr.length) return 0;
  const a = [...arr].sort((x,y)=>x-y);
  const idx = Math.ceil(0.9 * a.length) - 1;
  return a[Math.max(0, idx)];
}

/**
 * Detalle por vendedor
 */
export default function VendorDetailPanel({ vendorUid, onBack }) {
  const [loading, setLoading] = useState(true);
  const [vendor, setVendor]   = useState(null);
  const [convs, setConvs]     = useState([]);

  // Filtros
  const [mode, setMode] = useState("today"); // por defecto HOY
  const [from, setFrom] = useState(ymd(startOfDay(new Date())));
  const [to, setTo]     = useState(ymd(new Date()));
  const [q, setQ]       = useState("");
  const [labelFilter, setLabelFilter] = useState([]);

  // Paginado
  const [page, setPage] = useState(1);

  // ⏱️ Métricas de respuesta
  const [respStats, setRespStats] = useState({ avgMs: 0, medMs: 0, p90Ms: 0, pairs: 0, loading: false });

  // Presets de rango
  useEffect(() => {
    if (mode === "today") {
      const now = new Date();
      setFrom(ymd(startOfDay(now)));
      setTo(ymd(now));
    } else if (mode === "yesterday") {
      const now = new Date();
      const y   = new Date(now);
      y.setDate(now.getDate() - 1);
      setFrom(ymd(startOfDay(y)));
      setTo(ymd(endOfDay(y)));
    } else if (mode === "7") {
      const end = new Date();
      const start = startOfDay(new Date(Date.now() - 6 * 86400000));
      setFrom(ymd(start)); setTo(ymd(end));
    } else if (mode === "30") {
      const end = new Date();
      const start = startOfDay(new Date(Date.now() - 29 * 86400000));
      setFrom(ymd(start)); setTo(ymd(end));
    } else if (mode === "month") {
      const now = new Date();
      const start = startOfDay(new Date(now.getFullYear(), now.getMonth(), 1));
      const end = endOfDay(new Date(now.getFullYear(), now.getMonth() + 1, 0));
      setFrom(ymd(start)); setTo(ymd(end));
    }
  }, [mode]);

  /* ===== Presencia en tiempo real del vendedor ===== */
  useEffect(() => {
    if (!vendorUid) return;
    setLoading(true);
    let unsubUser = null;
    let unsubWaba = null;

    const userRef = doc(db, "users", vendorUid);
    unsubUser = onSnapshot(userRef, (snap) => {
      if (snap.exists()) {
        setVendor({ id: vendorUid, ...snap.data() });
        setLoading(false);
      } else {
        const qV = query(collection(db, "wabaNumbers"), where("ownerUid", "==", vendorUid), limit(1));
        unsubWaba = onSnapshot(qV, (qs) => {
          if (!qs.empty) {
            const d = qs.docs[0];
            setVendor({ id: d.id, ...d.data() });
          } else {
            setVendor(null);
          }
          setLoading(false);
        });
      }
    }, () => setLoading(false));

    return () => {
      try { unsubUser && unsubUser(); } catch {}
      try { unsubWaba && unsubWaba(); } catch {}
    };
  }, [vendorUid]);

  // Carga de conversaciones asignadas al vendedor
  useEffect(() => {
    if (!vendorUid) return;
    (async () => {
      setLoading(true);
      try {
        const qC = query(collection(db, "conversations"), where("assignedToUid", "==", vendorUid));
        const cSnap = await getDocs(qC);
        const rows = await Promise.all(
          cSnap.docs.map(async (d) => {
            let contact = null;
            try {
              const c = await getDoc(doc(db, "contacts", d.id));
              contact = c.exists() ? c.data() : null;
            } catch {}
            return { id: d.id, ...d.data(), contact };
          })
        );
        setConvs(rows);
        setPage(1);
      } finally {
        setLoading(false);
      }
    })();
  }, [vendorUid]);

  // Rango
  const range = useMemo(() => {
    const a = +startOfDay(parseLocalYMD(from));
    const b = +endOfDay(parseLocalYMD(to));
    return [a, b];
  }, [from, to]);

  const convsInRange = useMemo(() => {
    const [a, b] = range;
    return convs.filter(c => {
      const t = tsToMs(c.lastMessageAt) || tsToMs(c.createdAt);
      return t >= a && t <= b;
    });
  }, [convs, range]);

  const convsByLabel = useMemo(() => {
    if (!labelFilter.length) return convsInRange;
    const set = new Set(labelFilter);
    return convsInRange.filter(c => (Array.isArray(c.labels) ? c.labels : []).some(s => set.has(s)));
  }, [convsInRange, labelFilter]);

  const convsFiltered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return convsByLabel;
    return convsByLabel.filter(c => {
      const id = String(c.id || "").toLowerCase();
      const name = String(c.contact?.name || "").toLowerCase();
      return id.includes(s) || name.includes(s);
    });
  }, [convsByLabel, q]);

  useEffect(() => { setPage(1); }, [q, labelFilter, from, to, mode]);

  const totalItems = convsFiltered.length;
  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const pageClamped = Math.min(page, totalPages);
  const sliceStart = (pageClamped - 1) * pageSize;
  const sliceEnd   = sliceStart + pageSize;
  const convsPage  = convsFiltered.slice(sliceStart, sliceEnd);

  // KPIs
  const kpis = useMemo(() => {
    const total = convsFiltered.length;
    const sinEtiqueta = convsFiltered.filter(c => !(Array.isArray(c.labels) && c.labels.length)).length;
    const porEtiqueta = {};
    for (const c of convsFiltered) {
      const ls = Array.isArray(c.labels) ? c.labels : [];
      for (const s of ls) porEtiqueta[s] = (porEtiqueta[s] || 0) + 1;
    }
    const map = new Map();
    const aDate = startOfDay(parseLocalYMD(from));
    const bDate = endOfDay(parseLocalYMD(to));
    for (let t = +aDate; t <= +bDate; t += 86400000) map.set(ymd(t), 0);
    for (const c of convsFiltered) {
      const t = tsToMs(c.lastMessageAt) || tsToMs(c.createdAt);
      const key = ymd(startOfDay(t));
      if (map.has(key)) map.set(key, (map.get(key) || 0) + 1);
    }
    const porDia = Array.from(map.entries()).map(([k, v]) => ({ k, v }));
    return { total, sinEtiqueta, porEtiqueta, porDia };
  }, [convsFiltered, from, to]);

  // Exports
  const suffix = `${vendorUid}_${from}_a_${to}`;
  const exportConvs = () => {
    const rows = convsFiltered.map(c => ([
      c.id,
      c.contact?.name || "",
      c.assignedToName || "",
      (Array.isArray(c.labels) ? c.labels.join(" | ") : ""),
      new Date(tsToMs(c.createdAt)).toISOString(),
      new Date(tsToMs(c.lastMessageAt)).toISOString(),
    ]));
    downloadCSV(`conversaciones_${suffix}.csv`, toCSV(rows, ["id","contacto","asignado","etiquetas","creada","último msj"]));
  };
  const exportPorDia = () => {
    downloadCSV(`conversaciones_por_dia_${suffix}.csv`, toCSV(kpis.porDia.map(d => [d.k,d.v]), ["fecha","conversaciones"]));
  };
  const exportEtiquetas = () => {
    const pairs = Object.entries(kpis.porEtiqueta).sort((a,b)=>b[1]-a[1]);
    downloadCSV(`conversaciones_por_etiqueta_${suffix}.csv`, toCSV(pairs, ["etiqueta","conversaciones"]));
  };

  const isOnline = calcOnline(vendor);

  // Días en rango
  const diasEnRango = useMemo(() => {
    const a = +startOfDay(parseLocalYMD(from));
    const b = +endOfDay(parseLocalYMD(to));
    return Math.max(1, Math.round((b - a) / 86400000) + 1);
  }, [from, to]);

  /* ========== ⏱️ Tiempo de respuesta ========== */
  useEffect(() => {
    let cancelled = false;

    // timestamp robusto por mensaje
    const getMsgTime = (m) =>
      tsToMs(m.createdAt || m.sentAt || m.timestamp || m.ts || m.created_at);

    const isInbound = (m, c) =>
      m?.direction === "in" ||
      m?.from === c?.contactId ||
      m?.authorType === "customer" ||
      m?.isFromContact === true ||
      m?.sender === "contact" ||
      m?.role === "user" ||
      m?.type === "incoming";

    const isOutboundByVendor = (m, c) => {
      const uid = m?.senderUid || m?.userUid || m?.ownerUid || m?.agentUid;
      const outbound =
        m?.direction === "out" ||
        m?.from === c?.businessDisplay ||
        m?.authorType === "agent" ||
        m?.isAgent === true ||
        m?.sender === "agent" ||
        m?.role === "agent" ||
        m?.type === "outgoing";
      return outbound || (uid && uid === vendorUid);
    };

    async function fetchMsgsForConversation(c) {
      // 1) Subcolección estándar
      try {
        const ref1 = collection(db, "conversations", c.id, "messages");
        const q1 = query(ref1, orderBy("createdAt", "asc"));
        const snap1 = await getDocs(q1);
        if (!snap1.empty) return snap1.docs.map(d => ({ id: d.id, ...d.data() }));
      } catch {}

      // 2) Top-level messages con conversationId
      try {
        const ref2 = collection(db, "messages");
        const q2 = query(ref2, where("conversationId", "==", c.id), orderBy("createdAt", "asc"));
        const snap2 = await getDocs(q2);
        if (!snap2.empty) return snap2.docs.map(d => ({ id: d.id, ...d.data() }));
      } catch {}

      // 3) Resolver por array de ids en la conversación (en chunks de 10)
      try {
        if (Array.isArray(c.messages) && c.messages.length) {
          const all = [];
          const ref3 = collection(db, "messages");
          for (let i = 0; i < c.messages.length; i += 10) {
            const chunk = c.messages.slice(i, i + 10);
            const q3 = query(ref3, where(documentId(), "in", chunk));
            const snap3 = await getDocs(q3);
            snap3.forEach(d => all.push({ id: d.id, ...d.data() }));
          }
          if (all.length) {
            all.sort((a,b) => getMsgTime(a) - getMsgTime(b));
            return all;
          }
        }
      } catch {}

      return [];
    }

    async function run() {
      if (!vendorUid) return;
      setRespStats(s => ({ ...s, loading: true }));

      try {
        const sampleConvs = convsFiltered.slice(0, 120); // cota de seguridad
        const deltas = [];

        for (const c of sampleConvs) {
          const msgs = await fetchMsgsForConversation(c);
          if (!msgs.length) continue;

          for (let i = 0; i < msgs.length; i++) {
            const aMsg = msgs[i];
            if (!isInbound(aMsg, c)) continue;
            const aT = getMsgTime(aMsg);
            if (!aT) continue;

            for (let j = i + 1; j < msgs.length; j++) {
              const bMsg = msgs[j];
              if (!isOutboundByVendor(bMsg, c)) continue;
              const bT = getMsgTime(bMsg);
              if (!bT) continue;
              const delta = bT - aT;
              if (delta >= 0) deltas.push(delta);
              break; // sólo la primera respuesta
            }
          }
        }

        if (cancelled) return;
        if (!deltas.length) {
          setRespStats({ avgMs: 0, medMs: 0, p90Ms: 0, pairs: 0, loading: false });
        } else {
          const sum = deltas.reduce((a,b)=>a+b,0);
          const avg = sum / deltas.length;
          setRespStats({
            avgMs: avg,
            medMs: median(deltas),
            p90Ms: p90(deltas),
            pairs: deltas.length,
            loading: false
          });
        }
      } catch {
        if (!cancelled) setRespStats({ avgMs: 0, medMs: 0, p90Ms: 0, pairs: 0, loading: false });
      }
    }
    run();
    return () => { cancelled = true; };
  }, [db, vendorUid, convsFiltered]);

  return (
    <div className="min-h-screen bg-gradient-to-br via-amber-50 to-orange-100 from-slate-50">
      <div className="p-6 mx-auto space-y-8 max-w-7xl">
        {/* Header */}
        <div className="flex justify-between items-center">
          <div className="space-y-1">
            <h1 className="text-3xl font-bold text-slate-900">Detalle de vendedor</h1>
            <div className="text-sm text-slate-600">
              UID: <span className="font-mono">{vendorUid}</span>
              {vendor?.alias && <> · Alias: <b>{vendor.alias}</b></>}
              {vendor?.zone  && <> · Zona: <b>{vendor.zone}</b></>}
              {vendor?.owner && <> · Nombre: <b>{vendor.owner}</b></>}
              {" · Estado: "}
              <span
                className={`px-2 py-0.5 text-xs rounded-full ${isOnline ? "text-green-700 bg-green-100" : "text-red-600 bg-red-100"}`}
                title={vendor?.lastSeen ? `Visto: ${new Date(tsToMs(vendor.lastSeen)).toLocaleString()}` : undefined}
              >
                {isOnline ? "Online" : "Offline"}
              </span>
              {vendor?.lastSeen && (
                <> · Visto hace <span className="font-mono">{timeAgo(vendor.lastSeen)}</span></>
              )}
            </div>
          </div>
          {onBack && (
            <button className="px-4 py-2 bg-white rounded-xl border shadow hover:bg-slate-50" onClick={onBack}>
              ← Volver
            </button>
          )}
        </div>

        {/* Filtros */}
        <div className="p-4 rounded-2xl border shadow bg-white/90">
          <div className="flex flex-wrap gap-4 items-end">
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Período</label>
              <select
                className="px-3 py-2 rounded-xl border border-slate-200 bg-white/80"
                value={mode}
                onChange={(e) => setMode(e.target.value)}
              >
                <option value="today">Hoy</option>
                <option value="yesterday">Ayer</option>
                <option value="7">Últimos 7 días</option>
                <option value="30">Últimos 30 días</option>
                <option value="month">Este mes</option>
                <option value="custom">Rango personalizado…</option>
              </select>
              <div className="text-xs text-slate-500">
                Rango: {from} → {to}
              </div>
            </div>

            {mode === "custom" && (
              <>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-slate-700">Desde</label>
                  <input
                    type="date"
                    className="px-3 py-2 rounded-xl border border-slate-200 bg-white/80"
                    value={from}
                    onChange={(e) => setFrom(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-slate-700">Hasta</label>
                  <input
                    type="date"
                    className="px-3 py-2 rounded-xl border border-slate-200 bg-white/80"
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                  />
                </div>
              </>
            )}

            <div className="space-y-1 flex-1 min-w-[220px]">
              <label className="text-sm font-medium text-slate-700">Buscar</label>
              <input
                type="text"
                placeholder="Buscar por id o nombre de contacto…"
                className="px-3 py-2 w-full rounded-xl border border-slate-200 bg-white/80"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>

            <div className="space-y-1 min-w-[220px]">
              <label className="text-sm font-medium text-slate-700">Etiquetas</label>
              <select
                multiple
                className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white/80 min-h-[100px]"
                value={labelFilter}
                onChange={(e) => {
                  const vals = Array.from(e.target.selectedOptions).map(o => o.value);
                  setLabelFilter(vals);
                }}
              >
                {(() => {
                  const set = new Set();
                  for (const c of convsInRange) {
                    const ls = Array.isArray(c.labels) ? c.labels : [];
                    for (const s of ls) set.add(s);
                  }
                  const labels = Array.from(set).sort((a,b)=>a.localeCompare(b));
                  return labels.length === 0
                    ? <option value="" disabled>(Sin etiquetas)</option>
                    : labels.map((s) => <option key={s} value={s}>{s}</option>);
                })()}
              </select>
            </div>

            <div className="flex gap-2 ml-auto">
              <button
                className="px-4 py-2 text-white bg-gradient-to-r rounded-xl shadow from-slate-600 to-slate-700"
                onClick={() => { setMode("today"); setQ(""); setLabelFilter([]); }}
                title="Poner filtros en Hoy"
              >
                Hoy
              </button>
              <button
                className="px-4 py-2 text-white bg-gradient-to-r rounded-xl shadow from-slate-500 to-slate-600"
                onClick={() => { setMode("30"); setQ(""); setLabelFilter([]); }}
                title="Limpiar y volver a Últimos 30 días"
              >
                Limpiar filtros
              </button>
              <button
                className="px-4 py-2 text-white bg-gradient-to-r from-blue-600 to-indigo-600 rounded-xl shadow"
                onClick={exportConvs}
              >
                Exportar Conversaciones
              </button>
            </div>
          </div>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
          <MiniStatCard title="Total conversaciones" value={convsFiltered.length} from="#e6f0ff" to="#eaf3ff" text="#1e40af" />
          <MiniStatCard title="Sin etiqueta" value={convsFiltered.filter(c => !(Array.isArray(c.labels) && c.labels.length)).length} from="#fff1cc" to="#fff4d6" text="#7c2d12" />
          <MiniStatCard title="Etiquetas activas" value={Object.keys(convsFiltered.reduce((acc,c)=>{(Array.isArray(c.labels)?c.labels:[]).forEach(s=>acc[s]=(acc[s]||0)+1);return acc;},{})).length} from="#dcfce7" to="#e7f9ef" text="#064e3b" />
          <MiniStatCard title="Días en rango" value={diasEnRango} from="#f5ebff" to="#f3e8ff" text="#4c1d95" />
          <MiniStatCard
            title="⏱️ Tiempo de respuesta (prom.)"
            value={respStats.loading ? "…" : fmtDuration(respStats.avgMs)}
            subtitle={
              respStats.loading
                ? "Calculando…"
                : respStats.pairs
                  ? `Mediana ${fmtDuration(respStats.medMs)} · P90 ${fmtDuration(respStats.p90Ms)} · n=${respStats.pairs}`
                  : "Sin pares cliente→respuesta"
            }
            from="#e5fbea"
            to="#f0fff3"
            text="#065f46"
          />
        </div>

        {/* Serie por día */}
        <section className="p-6 rounded-2xl border shadow bg-white/90">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-xl font-bold text-slate-800">📈 Conversaciones por día</h3>
            <button
              className="px-4 py-2 text-white bg-gradient-to-r from-blue-500 to-blue-600 rounded-xl shadow"
              onClick={exportPorDia}
            >
              Exportar CSV
            </button>
          </div>
          {kpis.porDia.length === 0 ? (
            <div className="p-6 text-center rounded-xl border text-slate-500 bg-slate-50 border-slate-200">
              Sin datos en el período.
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 max-h-[360px] overflow-y-auto pr-1">
              {kpis.porDia.map((d, i) => (
                <div key={i} className="p-4 bg-white rounded-xl border hover:bg-slate-50">
                  <div className="text-3xl font-extrabold text-blue-600">{d.v}</div>
                  <div className="mt-1 text-sm text-slate-700">{d.k}</div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Top etiquetas */}
        <section className="p-6 rounded-2xl border shadow bg-white/90">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-xl font-bold text-slate-800">🏷️ Etiquetas</h3>
            <button
              className="px-4 py-2 text-white bg-gradient-to-r from-green-500 to-green-600 rounded-xl shadow"
              onClick={exportEtiquetas}
            >
              Exportar CSV
            </button>
          </div>
          {(() => {
            const counts = convsFiltered.reduce((acc, c) => {
              (Array.isArray(c.labels) ? c.labels : []).forEach(s => acc[s] = (acc[s] || 0) + 1);
              return acc;
            }, {});
            const entries = Object.entries(counts);
            return entries.length === 0 ? (
              <div className="p-6 text-center rounded-xl border text-slate-500 bg-slate-50 border-slate-200">
                Sin etiquetas en el período.
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 max-h-[360px] overflow-y-auto pr-1">
                {entries.sort((a,b)=>b[1]-a[1]).map(([k,v]) => (
                  <div key={k} className="p-4 bg-white rounded-xl border hover:bg-slate-50">
                    <div className="text-3xl font-extrabold text-green-600">{v}</div>
                    <div className="mt-1 text-sm break-words text-slate-700">{k}</div>
                  </div>
                ))}
              </div>
            );
          })()}
        </section>

        {/* Tabla de conversaciones + PAGINADO */}
        <section className="p-6 rounded-2xl border shadow bg-white/90">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-xl font-bold text-slate-800">📚 Conversaciones</h3>
            <div className="text-sm text-slate-600">
              {`Mostrando ${convsPage.length} de ${totalItems} (pág. ${pageClamped}/${totalPages})`}
            </div>
          </div>

          {loading ? (
            <div className="py-10 text-center text-slate-600">Cargando…</div>
          ) : convsPage.length === 0 ? (
            <div className="p-6 text-center rounded-xl border text-slate-500 bg-slate-50 border-slate-200">
              Sin resultados para los filtros.
            </div>
          ) : (
            <>
              <div className="overflow-auto rounded-xl border">
                <table className="table">
                  <thead>
                    <tr>
                      <th className="whitespace-nowrap">ID</th>
                      <th>Contacto</th>
                      <th>Etiquetas</th>
                      <th className="whitespace-nowrap">Creada</th>
                      <th className="whitespace-nowrap">Último msj</th>
                    </tr>
                  </thead>
                  <tbody>
                    {convsPage.map((c) => (
                      <tr key={c.id} className="align-top">
                        <td className="font-mono text-xs">{c.id}</td>
                        <td>
                          <div className="font-medium">{c.contact?.name || "—"}</div>
                          <div className="text-xs text-slate-500">{c.assignedToName || c.assignedToUid || "—"}</div>
                        </td>
                        <td className="text-sm">
                          {(Array.isArray(c.labels) ? c.labels : []).join(", ")}
                        </td>
                        <td className="text-xs text-slate-600">
                          {tsToMs(c.createdAt) ? new Date(tsToMs(c.createdAt)).toLocaleString() : "—"}
                        </td>
                        <td className="text-xs text-slate-600">
                          {tsToMs(c.lastMessageAt) ? new Date(tsToMs(c.lastMessageAt)).toLocaleString() : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Controles de paginado */}
              <div className="flex justify-between items-center mt-4">
                <button
                  className="px-3 py-2 bg-white rounded-lg border hover:bg-slate-50 disabled:opacity-50"
                  disabled={pageClamped <= 1}
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                >
                  ← Anterior
                </button>
                <div className="text-sm text-slate-600">
                  Página {pageClamped} de {totalPages}
                </div>
                <button
                  className="px-3 py-2 bg-white rounded-lg border hover:bg-slate-50 disabled:opacity-50"
                  disabled={pageClamped >= totalPages}
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                >
                  Siguiente →
                </button>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
