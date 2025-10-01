// src/components/AdminPanel.jsx
import { useEffect, useMemo, useState } from "react";
import { db } from "../firebase";
import { collection, getDocs, doc, getDoc } from "firebase/firestore";
import AdminVendors from "./AdminVendors.jsx";
import LabelsAdmin from "./LabelsAdmin.jsx";
import TemplatesPanel from "./TemplatesPanel.jsx";

import TasksPanel from "./TasksPanel.jsx";
import DashboardPro from "./DashboardPro.jsx";

/* ========================= Helpers fecha ========================= */
function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function endOfDay(d) { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; }
function ymd(d) {
  const x = new Date(d);
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const dd = String(x.getDate()).padStart(2, "0");
  return `${x.getFullYear()}-${m}-${dd}`;
}
function tsToMs(ts) {
  if (!ts) return 0;
  if (typeof ts === "number") return ts;
  if (ts?.toMillis) return ts.toMillis();
  if (ts?.toDate) return +ts.toDate();
  return +new Date(ts);
}

/* ========================= CSV helpers ========================= */
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

/* ========================= Presentational Cards ========================= */
function MiniStatCard({ title, value, from = "#eef2ff", to = "#e0e7ff", text = "#1e293b" }) {
  return (
    <div
      className="p-4 rounded-2xl border shadow-lg"
      style={{
        background: `linear-gradient(135deg, ${from}, ${to})`,
        borderColor: "rgba(148,163,184,.35)"
      }}
    >
      <div className="text-xs font-semibold tracking-wide uppercase" style={{ color: "#334155" }}>
        {title}
      </div>
      <div className="mt-2 text-3xl font-extrabold" style={{ color: text }}>{value}</div>
    </div>
  );
}

function ListStatCard({ title, data, accent = "#3b82f6", exportBtn, formatter = (k) => k }) {
  return (
    <section className="p-6 rounded-2xl border shadow-lg backdrop-blur-sm bg-white/90 border-white/20">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-xl font-bold text-slate-800">{title}</h3>
        {exportBtn}
      </div>

      {data.length === 0 ? (
        <div className="p-6 text-center rounded-xl border text-slate-500 bg-slate-50 border-slate-200">
          Sin datos en el período.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 max-h-[360px] overflow-y-auto pr-1">
          {data.map((d, i) => (
            <div
              key={i}
              className="p-4 rounded-xl border shadow-sm transition bg-white/80 hover:bg-white group"
              style={{ borderColor: "rgba(226,232,240,.8)" }}
              title={`${formatter(d.k)}: ${d.v}`}
            >
              <div className="mb-2 text-3xl font-extrabold" style={{ color: accent }}>{d.v}</div>
              <div className="text-sm leading-snug break-words text-slate-700">{formatter(d.k)}</div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/* =============================================================== */
export default function AdminPanel() {
  // tabs soportados:
  // "numbers" | "dashboard" | "templates" | "labels" | "campaigns" | "tasks" | "dashboardPro"
  const [tab, setTab] = useState("numbers");

  const [loading, setLoading] = useState(false);
  const [convs, setConvs] = useState([]);
  const [vendors, setVendors] = useState([]);

  const [mode, setMode] = useState("7");
  const [from, setFrom] = useState(ymd(startOfDay(new Date(Date.now() - 6 * 86400000))));
  const [to, setTo] = useState(ymd(new Date()));

  const [zoneFilter, setZoneFilter] = useState("(todas)");
  const [labelFilter, setLabelFilter] = useState([]);
  const [agentFilter, setAgentFilter] = useState([]);
  const [q, setQ] = useState("");

  const zonas = useMemo(() => {
    const set = new Set(
      vendors.filter(v => v.active)
        .map(v => (v.zone || "Sin zona").trim())
        .filter(Boolean)
    );
    return ["(todas)", ...Array.from(set).sort()];
  }, [vendors]);

  // Carga para tu dashboard actual (cuando se entra a "dashboard")
  useEffect(() => {
    if (tab !== "dashboard") return;
    (async () => {
      setLoading(true);
      try {
        const cs = await getDocs(collection(db, "conversations"));
        const convRows = await Promise.all(
          cs.docs.map(async (d) => {
            let contact = null;
            try {
              const c = await getDoc(doc(db, "contacts", d.id));
              contact = c.exists() ? c.data() : null;
            } catch (e) { console.error(e); }
            return { id: d.id, ...d.data(), contact };
          })
        );
        setConvs(convRows);

        const vs = await getDocs(collection(db, "wabaNumbers"));
        setVendors(vs.docs.map(d => ({ id: d.id, ...d.data() })));
      } finally {
        setLoading(false);
      }
    })();
  }, [tab]);

  useEffect(() => {
    if (mode === "7") {
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

  // Rango en ms
  const range = useMemo(() => {
    return [+startOfDay(new Date(from)), +endOfDay(new Date(to))];
  }, [from, to]);

  const convsInRange = useMemo(() => {
    const [a, b] = range;
    return convs.filter(c => {
      const t = tsToMs(c.lastMessageAt) || tsToMs(c.createdAt);
      return t >= a && t <= b;
    });
  }, [convs, range]);

  const vendorIndexByZone = useMemo(() => {
    const map = new Map();
    for (const v of vendors) {
      const z = (v.zone || "Sin zona").trim();
      if (!map.has(z)) map.set(z, { uids: new Set(), names: new Set() });
      if (v.ownerUid) map.get(z).uids.add(v.ownerUid);
      if (v.alias) map.get(z).names.add(v.alias);
      if (v.owner) map.get(z).names.add(v.owner);
      if (v.phone) map.get(z).names.add(v.phone);
    }
    return map;
  }, [vendors]);

  const convsByZone = useMemo(() => {
    if (zoneFilter === "(todas)") return convsInRange;
    const idx = vendorIndexByZone.get(zoneFilter);
    if (!idx) return [];
    return convsInRange.filter(c => {
      const uid = c.assignedToUid || "";
      const name = c.assignedToName || "";
      const zone = c.assignedZone || "";
      if (zone && zone.toLowerCase() === zoneFilter.toLowerCase()) return true;
      if (uid && idx.uids.has(uid)) return true;
      if (name && idx.names.has(name)) return true;
      return false;
    });
  }, [convsInRange, zoneFilter, vendorIndexByZone]);

  const availableLabels = useMemo(() => {
    const set = new Set();
    for (const c of convsByZone) {
      const ls = Array.isArray(c.labels) ? c.labels : [];
      for (const s of ls) set.add(s);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [convsByZone]);

  const availableAgents = useMemo(() => {
    const map = new Map();
    for (const c of convsByZone) {
      const name = c.assignedToName || "";
      const uid = c.assignedToUid || "";
      if (!name && !uid) continue;
      const label = name && uid ? `${name} (${uid})` : (name || uid);
      map.set(label, { name, uid });
    }
    return Array.from(map.keys()).sort((a, b) => a.localeCompare(b));
  }, [convsByZone]);

  const convsByLabel = useMemo(() => {
    if (!labelFilter.length) return convsByZone;
    const set = new Set(labelFilter);
    return convsByZone.filter(c => {
      const ls = Array.isArray(c.labels) ? c.labels : [];
      return ls.some(s => set.has(s));
    });
  }, [convsByZone, labelFilter]);

  const convsByAgent = useMemo(() => {
    if (!agentFilter.length) return convsByLabel;
    const tokens = agentFilter.map(s => s.trim());
    return convsByLabel.filter(c => {
      const name = (c.assignedToName || "").trim();
      const uid = (c.assignedToUid || "").trim();
      return tokens.some(t => t === name || t === uid || t === `${name} (${uid})`);
    });
  }, [convsByLabel, agentFilter]);

  const convsFiltered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return convsByAgent;
    return convsByAgent.filter(c => {
      const id = String(c.id || "").toLowerCase();
      const name = String(c.contact?.name || "").toLowerCase();
      return id.includes(s) || name.includes(s);
    });
  }, [convsByAgent, q]);

  const kpis = useMemo(() => {
    const total = convsFiltered.length;
    const sinAsignar = convsFiltered.filter(c => !c.assignedToUid && !c.assignedToName).length;

    const porEtiqueta = {};
    for (const c of convsFiltered) {
      const ls = Array.isArray(c.labels) ? c.labels : [];
      for (const s of ls) porEtiqueta[s] = (porEtiqueta[s] || 0) + 1;
    }

    const porAgente = {};
    for (const c of convsFiltered) {
      const k = c.assignedToName || c.assignedToUid || "Sin asignar";
      porAgente[k] = (porAgente[k] || 0) + 1;
    }

    return { total, sinAsignar, porEtiqueta, porAgente };
  }, [convsFiltered]);

  const seriePorDia = useMemo(() => {
    const map = new Map();
    const [a, b] = range;
    for (let t = a; t <= b; t += 86400000) map.set(ymd(t), 0);
    for (const c of convsFiltered) {
      const t = tsToMs(c.lastMessageAt) || tsToMs(c.createdAt);
      const key = ymd(startOfDay(t));
      if (map.has(key)) map.set(key, (map.get(key) || 0) + 1);
    }
    return Array.from(map.entries()).map(([k, v]) => ({ k, v }));
  }, [convsFiltered, range]);

  const etiquetasData = useMemo(() =>
    Object.entries(kpis.porEtiqueta).sort((a, b) => b[1] - a[1]).slice(0, 50).map(([k, v]) => ({ k, v }))
    , [kpis.porEtiqueta]);

  const agentesData = useMemo(() =>
    Object.entries(kpis.porAgente).sort((a, b) => b[1] - a[1]).slice(0, 50).map(([k, v]) => ({ k, v }))
    , [kpis.porAgente]);

  const vendedoresActivos = useMemo(() => vendors.filter(v => !!v.active), [vendors]);
  const vendedoresPorZona = useMemo(() => {
    const map = {};
    for (const v of vendedoresActivos) {
      const z = v.zone || "Sin zona";
      if (!map[z]) map[z] = [];
      map[z].push(v);
    }
    return map;
  }, [vendedoresActivos]);

  const vendedoresPorZonaFiltrado = useMemo(() => {
    if (zoneFilter === "(todas)") return vendedoresPorZona;
    return { [zoneFilter]: vendedoresPorZona[zoneFilter] || [] };
  }, [vendedoresPorZona, zoneFilter]);

  const vendedoresEnZona = useMemo(() => {
    return zoneFilter === "(todas)"
      ? vendedoresActivos.length
      : (vendedoresPorZona[zoneFilter]?.length || 0);
  }, [zoneFilter, vendedoresActivos.length, vendedoresPorZona]);

  const zonaPart = zoneFilter === "(todas)" ? "" : `_zona_${zoneFilter}`;
  const labelsPart = labelFilter.length ? `_labels_${labelFilter.join("+")}` : "";
  const agentsPart = agentFilter.length ? `_agentes_${agentFilter.length}` : "";
  const suffix = `${from}_a_${to}${zonaPart}${labelsPart}${agentsPart}`;

  const doExportPorDia = () => {
    const csv = toCSV(seriePorDia.map(d => [d.k, d.v]), ["fecha", "conversaciones"]);
    downloadCSV(`conversaciones_por_dia_${suffix}.csv`, csv);
  };
  const doExportEtiquetas = () => {
    const csv = toCSV(Object.entries(kpis.porEtiqueta).map(([k, v]) => [k, v]), ["etiqueta", "conversaciones"]);
    downloadCSV(`conversaciones_por_etiqueta_${suffix}.csv`, csv);
  };
  const doExportAgentes = () => {
    const csv = toCSV(Object.entries(kpis.porAgente).map(([k, v]) => [k, v]), ["agente", "conversaciones"]);
    downloadCSV(`conversaciones_por_agente_${suffix}.csv`, csv);
  };

  const onMultiChange = (setter) => (e) => {
    const vals = Array.from(e.target.selectedOptions).map(o => o.value);
    setter(vals);
  };
  const clearFilters = () => {
    setZoneFilter("(todas)");
    setLabelFilter([]);
    setAgentFilter([]);
    setQ("");
  };

  // ────────────────────────────────────────────────────────────
  // UI
  return (
    <div className="min-h-screen bg-gradient-to-br via-blue-50 to-indigo-100 from-slate-50">
      <div className="p-6 mx-auto space-y-8 max-w-7xl">
        {/* Header elegante */}
        <div className="space-y-4 text-center">
          <h1 className="text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r via-blue-900 to-indigo-900 from-slate-900">
            Panel de Administración
          </h1>
          <p className="text-lg text-slate-600">Gestiona tu CRM con herramientas avanzadas</p>
        </div>

        {/* Navegación por pestañas moderna */}
        <div className="p-2 rounded-2xl border shadow-lg backdrop-blur-sm bg-white/80 border-white/20">
          <div className="flex flex-wrap gap-1">
            {[
              { key: "numbers", label: "📱 Números" },
              { key: "dashboard", label: "📊 Dashboard" },
              { key: "templates", label: "📝 Plantillas" },
              { key: "labels", label: "🏷️ Etiquetas" },

              { key: "tasks", label: "✅ Tareas" },
              { key: "dashboardPro", label: "⚡ Dashboard Pro" }
            ].map(({ key, label }) => (
              <button
                key={key}
                className={`
                  px-6 py-3 rounded-xl font-medium transition-all duration-300 transform hover:scale-105
                  ${tab === key
                    ? "bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-500/25"
                    : "text-slate-700 hover:bg-white/60 hover:shadow-md"
                  }
                `}
                onClick={() => setTab(key)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Contenido por pestaña */}
        {tab === "numbers" && <AdminVendors />}
        {tab === "templates" && <TemplatesPanel />}
        {tab === "labels" && <LabelsAdmin />}

        {tab === "dashboard" && (
          <div className="space-y-8">
            {loading && (
              <div className="flex justify-center items-center py-12">
                <div className="w-12 h-12 rounded-full border-b-2 border-blue-600 animate-spin"></div>
                <span className="ml-3 font-medium text-slate-600">Cargando datos...</span>
              </div>
            )}

            {!loading && (
              <>
                {/* Controles / Filtros */}
                <div className="p-6 rounded-2xl border shadow-lg backdrop-blur-sm bg-white/90 border-white/20">
                  <div className="flex flex-wrap gap-4 items-end">
                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-slate-700">Período</label>
                      <select
                        className="px-4 py-2 rounded-xl border transition-all border-slate-200 bg-white/80 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        value={mode}
                        onChange={(e) => setMode(e.target.value)}
                      >
                        <option value="7">Últimos 7 días</option>
                        <option value="30">Últimos 30 días</option>
                        <option value="month">Este mes</option>
                        <option value="custom">Rango personalizado…</option>
                      </select>
                    </div>

                    {mode === "custom" && (
                      <>
                        <div className="space-y-2">
                          <label className="text-sm font-semibold text-slate-700">Desde</label>
                          <input
                            type="date"
                            className="px-4 py-2 rounded-xl border transition-all border-slate-200 bg-white/80 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            value={from}
                            onChange={(e) => setFrom(e.target.value)}
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-semibold text-slate-700">Hasta</label>
                          <input
                            type="date"
                            className="px-4 py-2 rounded-xl border transition-all border-slate-200 bg-white/80 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            value={to}
                            onChange={(e) => setTo(e.target.value)}
                          />
                        </div>
                      </>
                    )}

                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-slate-700">Zona</label>
                      <select
                        className="px-4 py-2 rounded-xl border transition-all border-slate-200 bg-white/80 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        value={zoneFilter}
                        onChange={(e) => setZoneFilter(e.target.value)}
                      >
                        {zonas.map((z) => <option key={z} value={z}>{z}</option>)}
                      </select>
                    </div>

                    <div className="space-y-2 flex-1 min-w-[200px]">
                      <label className="text-sm font-semibold text-slate-700">Buscar</label>
                      <input
                        type="text"
                        placeholder="Buscar nombre o número…"
                        className="px-4 py-2 w-full rounded-xl border transition-all border-slate-200 bg-white/80 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                      />
                    </div>

                    <button
                      className="px-6 py-2 text-white bg-gradient-to-r rounded-xl shadow-lg transition-all duration-300 transform from-slate-500 to-slate-600 hover:from-slate-600 hover:to-slate-700 hover:scale-105"
                      onClick={() => { setZoneFilter("(todas)"); setLabelFilter([]); setAgentFilter([]); setQ(""); }}
                    >
                      Limpiar filtros
                    </button>

                    <div className="ml-auto text-sm font-medium text-slate-600">
                      {`Mostrando ${convsFiltered.length} conversaciones`}
                    </div>
                  </div>

                  {/* Filtros avanzados */}
                  <div className="grid grid-cols-1 gap-4 mt-6 md:grid-cols-2">
                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-slate-700">Etiquetas</label>
                      <select
                        multiple
                        className="w-full px-4 py-2 rounded-xl border border-slate-200 bg-white/80 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all min-h-[100px]"
                        value={labelFilter}
                        onChange={(e) => {
                          const vals = Array.from(e.target.selectedOptions).map(o => o.value);
                          setLabelFilter(vals);
                        }}
                      >
                        {availableLabels.length === 0
                          ? <option value="" disabled>(Sin etiquetas disponibles)</option>
                          : availableLabels.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                      {!!labelFilter.length && (
                        <div className="mt-1 text-xs text-slate-600">
                          Seleccionadas: {labelFilter.join(", ")}
                        </div>
                      )}
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-slate-700">Agentes</label>
                      <select
                        multiple
                        className="w-full px-4 py-2 rounded-xl border border-slate-200 bg-white/80 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all min-h-[100px]"
                        value={agentFilter}
                        onChange={(e) => {
                          const vals = Array.from(e.target.selectedOptions).map(o => o.value);
                          setAgentFilter(vals);
                        }}
                      >
                        {availableAgents.length === 0
                          ? <option value="" disabled>(Sin agentes disponibles)</option>
                          : availableAgents.map((a) => <option key={a} value={a}>{a}</option>)}
                      </select>
                      {!!agentFilter.length && (
                        <div className="mt-1 text-xs text-slate-600">
                          Seleccionados: {agentFilter.join(", ")}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* KPIs principales */}
                <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
                  <MiniStatCard title="Total conversaciones" value={kpis.total} from="#e6f0ff" to="#eaf3ff" text="#1e40af" />
                  <MiniStatCard title="Sin asignar" value={kpis.sinAsignar} from="#fff1cc" to="#fff4d6" text="#7c2d12" />
                  <MiniStatCard title="Zonas activas" value={Object.keys(vendedoresPorZona).length} from="#dcfce7" to="#e7f9ef" text="#064e3b" />
                  <MiniStatCard title="Vendedores activos" value={vendedoresActivos.length} from="#f5ebff" to="#f3e8ff" text="#4c1d95" />
                  <MiniStatCard title="Vendedores en esta zona" value={vendedoresEnZona} from="#e6f0ff" to="#eaf3ff" text="#312e81" />
                </div>

                {/* Conversaciones por día (como tarjetas) */}
                <ListStatCard
                  title="📈 Conversaciones por día"
                  accent="#2563eb"
                  data={seriePorDia.map(d => ({ k: d.k, v: d.v }))}
                  formatter={(k) => k}
                  exportBtn={
                    <button
                      className="px-4 py-2 text-white bg-gradient-to-r from-blue-500 to-blue-600 rounded-xl shadow-lg transition hover:from-blue-600 hover:to-blue-700"
                      onClick={doExportPorDia}
                    >
                      📊 Exportar CSV
                    </button>
                  }
                />

                {/* Top etiquetas (como tarjetas) */}
                <ListStatCard
                  title="🏷️ Top etiquetas"
                  accent="#16a34a"
                  data={etiquetasData}
                  formatter={(k) => k}
                  exportBtn={
                    <button
                      className="px-4 py-2 text-white bg-gradient-to-r from-green-500 to-green-600 rounded-xl shadow-lg transition hover:from-green-600 hover:to-green-700"
                      onClick={doExportEtiquetas}
                    >
                      📊 Exportar CSV
                    </button>
                  }
                />

                {/* Conversaciones por agente (como tarjetas) */}
                <ListStatCard
                  title="👥 Conversaciones por agente"
                  accent="#7c3aed"
                  data={agentesData}
                  formatter={(k) => String(k).replace(/\s*\([^)]*\)\s*$/, "")}
                  exportBtn={
                    <button
                      className="px-4 py-2 text-white bg-gradient-to-r from-purple-500 to-purple-600 rounded-xl shadow-lg transition hover:from-purple-600 hover:to-purple-700"
                      onClick={doExportAgentes}
                    >
                      📊 Exportar CSV
                    </button>
                  }
                />

                {/* Vendedores por zona (se conserva) */}
                <section className="p-6 rounded-2xl border shadow-lg backdrop-blur-sm bg-white/90 border-white/20">
                  <h3 className="mb-4 text-xl font-bold text-slate-800">🌍 Vendedores activos por zona</h3>
                  <div className="grid gap-4 md:grid-cols-2">
                    {Object.entries(
                      zoneFilter === "(todas)"
                        ? vendedoresPorZona
                        : { [zoneFilter]: vendedoresPorZona[zoneFilter] || [] }
                    ).map(([zona, arr]) => (
                      <div key={zona} className="p-4 bg-gradient-to-br rounded-xl border shadow-sm from-slate-50 to-slate-100 border-slate-200/60">
                        <div className="flex justify-between items-center mb-3">
                          <div className="font-semibold text-slate-800">{zona}</div>
                          <div className="px-2 py-1 text-sm rounded-full text-slate-600 bg-slate-200">
                            {arr.length} vendedor(es)
                          </div>
                        </div>
                        <ul className="space-y-2">
                          {arr.map((v) => (
                            <li
                              key={v.id}
                              className="flex justify-between items-center p-2 rounded-lg border bg-white/60 border-slate-200/40"
                            >
                              <span className="text-sm font-medium text-slate-700">
                                {v.alias || v.owner || v.phone}
                                {v.phone ? ` · ${v.phone}` : ""}
                              </span>
                              {!v.active && (
                                <span className="px-2 py-1 text-xs text-red-500 bg-red-100 rounded-full">inactivo</span>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </section>
              </>
            )}
          </div>
        )}

        {tab === "tasks" && <TasksPanel />}
        {tab === "dashboardPro" && <DashboardPro />}
      </div>
    </div>
  );
}
