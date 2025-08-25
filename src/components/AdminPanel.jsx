// src/components/AdminPanel.jsx
import { useEffect, useMemo, useState } from "react";
import { db } from "../firebase";
import { collection, getDocs, doc, getDoc } from "firebase/firestore";
import AdminVendors from "./AdminVendors.jsx";
import LabelsAdmin from "./LabelsAdmin.jsx";
import TemplatesPanel from "./TemplatesPanel.jsx";
import CampaignsPanel from "./CampaignsPanel.jsx";
import TasksPanel from "./TasksPanel.jsx";
import DashboardPro from "./DashboardPro.jsx";

/* ========================= Helpers fecha ========================= */
function startOfDay(d) { const x = new Date(d); x.setHours(0,0,0,0); return x; }
function endOfDay(d)   { const x = new Date(d); x.setHours(23,59,59,999); return x; }
function ymd(d) {
  const x = new Date(d);
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const dd = String(x.getDate()).padStart(2, "0");
  return `${x.getFullYear()}-${m}-${dd}`;
}
function tsToMs(ts){
  if(!ts) return 0;
  if(typeof ts==="number") return ts;
  if(ts?.toMillis) return ts.toMillis();
  if(ts?.toDate)   return +ts.toDate();
  return +new Date(ts);
}

/* ========================= CSV helpers ========================= */
function toCSV(rows, headers) {
  const head = headers.map(h => `"${h}"`).join(",");
  const body = rows
    .map(r => r.map(v => `"${String(v ?? "").replace(/"/g,'""')}"`).join(","))
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

/* ========================= Mini bar chart (SVG puro) ========================= */
function BarChart({ data, height = 140, labelFmt = (k) => k }) {
  const max = Math.max(1, ...data.map((d) => d.v));
  const barW = 32, gap = 8;
  const w = data.length * (barW + gap) + gap;

  return (
    <div className="overflow-x-auto">
      <svg width={w} height={height + 40}>
        {data.map((d, i) => {
          const x = gap + i * (barW + gap);
          const h = Math.round((d.v / max) * height);
          const y = height - h + 10;
          return (
            <g key={i} transform={`translate(${x},0)`}>
              <rect x="0" y={y} width={barW} height={h} className="fill-gray-300" />
              <text x={barW/2} y={y-4} textAnchor="middle" fontSize="10">{d.v}</text>
              <text x={barW/2} y={height+24} textAnchor="middle" fontSize="10" className="fill-gray-700">
                {labelFmt(d.k)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export default function AdminPanel() {
  // tabs soportados:
  // "numbers" | "dashboard" | "templates" | "labels" | "campaigns" | "tasks" | "dashboardPro"
  const [tab, setTab] = useState("numbers");

  const [loading, setLoading] = useState(false);
  const [convs,   setConvs]   = useState([]);
  const [vendors, setVendors] = useState([]);

  const [mode, setMode] = useState("7");
  const [from, setFrom] = useState(ymd(startOfDay(new Date(Date.now() - 6*86400000))));
  const [to,   setTo]   = useState(ymd(new Date()));

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
      const start = startOfDay(new Date(Date.now() - 6*86400000));
      setFrom(ymd(start)); setTo(ymd(end));
    } else if (mode === "30") {
      const end = new Date();
      const start = startOfDay(new Date(Date.now() - 29*86400000));
      setFrom(ymd(start)); setTo(ymd(end));
    } else if (mode === "month") {
      const now = new Date();
      const start = startOfDay(new Date(now.getFullYear(), now.getMonth(), 1));
      const end   = endOfDay(new Date(now.getFullYear(), now.getMonth()+1, 0));
      setFrom(ymd(start)); setTo(ymd(end));
    }
  }, [mode]);

  // Rango en ms
  const range = useMemo(() => {
    return [+startOfDay(new Date(from)), +endOfDay(new Date(to))];
  }, [from, to]);

  const convsInRange = useMemo(() => {
    const [a,b] = range;
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
      if (v.alias)    map.get(z).names.add(v.alias);
      if (v.owner)    map.get(z).names.add(v.owner);
      if (v.phone)    map.get(z).names.add(v.phone);
    }
    return map;
  }, [vendors]);

  const convsByZone = useMemo(() => {
    if (zoneFilter === "(todas)") return convsInRange;
    const idx = vendorIndexByZone.get(zoneFilter);
    if (!idx) return [];
    return convsInRange.filter(c => {
      const uid  = c.assignedToUid || "";
      const name = c.assignedToName || "";
      const zone = c.assignedZone  || "";
      if (zone && zone.toLowerCase() === zoneFilter.toLowerCase()) return true;
      if (uid  && idx.uids.has(uid))   return true;
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
    return Array.from(set).sort((a,b) => a.localeCompare(b));
  }, [convsByZone]);

  const availableAgents = useMemo(() => {
    const map = new Map();
    for (const c of convsByZone) {
      const name = c.assignedToName || "";
      const uid  = c.assignedToUid  || "";
      if (!name && !uid) continue;
      const label = name && uid ? `${name} (${uid})` : (name || uid);
      map.set(label, { name, uid });
    }
    return Array.from(map.keys()).sort((a,b) => a.localeCompare(b));
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
      const uid  = (c.assignedToUid  || "").trim();
      return tokens.some(t => t === name || t === uid || t === `${name} (${uid})`);
    });
  }, [convsByLabel, agentFilter]);

  const convsFiltered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return convsByAgent;
    return convsByAgent.filter(c => {
      const id   = String(c.id || "").toLowerCase();
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
    const [a,b] = range;
    for (let t=a; t<=b; t+=86400000) map.set(ymd(t), 0);
    for (const c of convsFiltered) {
      const t = tsToMs(c.lastMessageAt) || tsToMs(c.createdAt);
      const key = ymd(startOfDay(t));
      if (map.has(key)) map.set(key, (map.get(key) || 0) + 1);
    }
    return Array.from(map.entries()).map(([k,v]) => ({ k, v }));
  }, [convsFiltered, range]);

  const etiquetasData = useMemo(() =>
    Object.entries(kpis.porEtiqueta).sort((a,b) => b[1]-a[1]).slice(0,12).map(([k,v]) => ({ k, v }))
  , [kpis.porEtiqueta]);

  const agentesData = useMemo(() =>
    Object.entries(kpis.porAgente).sort((a,b) => b[1]-a[1]).slice(0,12).map(([k,v]) => ({ k, v }))
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

  const zonaPart   = zoneFilter === "(todas)" ? "" : `_zona_${zoneFilter}`;
  const labelsPart = labelFilter.length ? `_labels_${labelFilter.join("+")}` : "";
  const agentsPart = agentFilter.length ? `_agentes_${agentFilter.length}` : "";
  const suffix = `${from}_a_${to}${zonaPart}${labelsPart}${agentsPart}`;

  const doExportPorDia = () => {
    const csv = toCSV(seriePorDia.map(d => [d.k, d.v]), ["fecha", "conversaciones"]);
    downloadCSV(`conversaciones_por_dia_${suffix}.csv`, csv);
  };
  const doExportEtiquetas = () => {
    const csv = toCSV(Object.entries(kpis.porEtiqueta).map(([k,v]) => [k,v]), ["etiqueta","conversaciones"]);
    downloadCSV(`conversaciones_por_etiqueta_${suffix}.csv`, csv);
  };
  const doExportAgentes = () => {
    const csv = toCSV(Object.entries(kpis.porAgente).map(([k,v]) => [k,v]), ["agente","conversaciones"]);
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
    <div className="p-4 space-y-4">
      <h2 className="text-lg font-bold">Panel de administración</h2>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2">
        <button
          className={"px-3 py-1 border rounded " + (tab === "numbers" ? "bg-black text-white" : "bg-white")}
          onClick={() => setTab("numbers")}
        >
          Números
        </button>
        <button
          className={"px-3 py-1 border rounded " + (tab === "dashboard" ? "bg-black text-white" : "bg-white")}
          onClick={() => setTab("dashboard")}
        >
          Dashboard
        </button>
        <button
          className={"px-3 py-1 border rounded " + (tab === "templates" ? "bg-black text-white" : "bg-white")}
          onClick={() => setTab("templates")}
        >
          Plantillas
        </button>
        <button
          className={"px-3 py-1 border rounded " + (tab === "labels" ? "bg-black text-white" : "bg-white")}
          onClick={() => setTab("labels")}
        >
          Etiquetas
        </button>
        {/* Nuevas pestañas */}
        <button
          className={"px-3 py-1 border rounded " + (tab === "campaigns" ? "bg-black text-white" : "bg-white")}
          onClick={() => setTab("campaigns")}
        >
          Campañas
        </button>
        <button
          className={"px-3 py-1 border rounded " + (tab === "tasks" ? "bg-black text-white" : "bg-white")}
          onClick={() => setTab("tasks")}
        >
          Tareas
        </button>
        <button
          className={"px-3 py-1 border rounded " + (tab === "dashboardPro" ? "bg-black text-white" : "bg-white")}
          onClick={() => setTab("dashboardPro")}
        >
          Dashboard Pro
        </button>
      </div>

      {/* Contenido por pestaña ya existente */}
      {tab === "numbers" && <AdminVendors />}

      {tab === "templates" && <TemplatesPanel />}

      {tab === "labels" && <LabelsAdmin />}

      {/* Tu Dashboard actual (lo conservo tal cual) */}
      {tab === "dashboard" && (
        <div className="space-y-6">
          <div className="flex flex-col gap-3 p-3 border rounded">
            <div className="flex flex-wrap items-center gap-2">
              <select
                className="p-2 border rounded"
                value={mode}
                onChange={(e) => setMode(e.target.value)}
                title="Período"
              >
                <option value="7">Últimos 7 días</option>
                <option value="30">Últimos 30 días</option>
                <option value="month">Este mes</option>
                <option value="custom">Rango personalizado…</option>
              </select>

              <input
                type="date"
                className="p-2 border rounded"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                disabled={mode !== "custom"}
                title="Desde"
              />
              <input
                type="date"
                className="p-2 border rounded"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                disabled={mode !== "custom"}
                title="Hasta"
              />

              <select
                className="p-2 border rounded"
                value={zoneFilter}
                onChange={(e) => setZoneFilter(e.target.value)}
                title="Zona"
              >
                {zonas.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </select>

              <input
                className="p-2 border rounded md:min-w-64"
                placeholder="Buscar nombre o número…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              <button
                className="px-3 py-2 text-sm border rounded"
                onClick={clearFilters}
              >
                Limpiar filtros
              </button>

              <div className="ml-auto text-sm text-gray-600">
                {loading
                  ? "Cargando…"
                  : `Mostrando ${convsFiltered.length} conversaciones`}
              </div>
            </div>

            <div className="grid items-start gap-3 md:grid-cols-2">
              <div>
                <label className="block mb-1 text-xs text-gray-600">
                  Filtrar por etiqueta (múltiple)
                </label>
                <select
                  multiple
                  className="w-full p-2 border rounded min-h-28"
                  value={labelFilter}
                  onChange={onMultiChange(setLabelFilter)}
                >
                  {availableLabels.length === 0 ? (
                    <option value="" disabled>
                      (Sin etiquetas disponibles)
                    </option>
                  ) : (
                    availableLabels.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))
                  )}
                </select>
                {!!labelFilter.length && (
                  <div className="mt-1 text-xs text-gray-600">
                    Seleccionadas: {labelFilter.join(", ")}
                  </div>
                )}
              </div>

              <div>
                <label className="block mb-1 text-xs text-gray-600">
                  Filtrar por agente (múltiple)
                </label>
                <select
                  multiple
                  className="w-full p-2 border rounded min-h-28"
                  value={agentFilter}
                  onChange={onMultiChange(setAgentFilter)}
                >
                  {availableAgents.length === 0 ? (
                    <option value="" disabled>
                      (Sin agentes disponibles)
                    </option>
                  ) : (
                    availableAgents.map((a) => (
                      <option key={a} value={a}>
                        {a}
                      </option>
                    ))
                  )}
                </select>
                {!!agentFilter.length && (
                  <div className="mt-1 text-xs text-gray-600">
                    Seleccionados: {agentFilter.join(", ")}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <div className="p-3 border rounded">
              <div className="text-xs text-gray-500">Total conversaciones</div>
              <div className="text-2xl font-semibold">{kpis.total}</div>
            </div>
            <div className="p-3 border rounded">
              <div className="text-xs text-gray-500">Sin asignar</div>
              <div className="text-2xl font-semibold">{kpis.sinAsignar}</div>
            </div>
            <div className="p-3 border rounded">
              <div className="text-xs text-gray-500">Zonas activas</div>
              <div className="text-2xl font-semibold">
                {Object.keys(vendedoresPorZona).length}
              </div>
            </div>
            <div className="p-3 border rounded">
              <div className="text-xs text-gray-500">Vendedores activos</div>
              <div className="text-2xl font-semibold">
                {vendedoresActivos.length}
              </div>
            </div>
            <div className="p-3 border rounded">
              <div className="text-xs text-gray-500">
                Vendedores en esta zona
              </div>
              <div className="text-2xl font-semibold">{vendedoresEnZona}</div>
            </div>
          </div>

          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold">Conversaciones por día</h3>
              <button
                className="px-3 py-1 text-sm border rounded"
                onClick={doExportPorDia}
              >
                Exportar CSV
              </button>
            </div>
            <BarChart data={seriePorDia} labelFmt={(k) => k.slice(5)} />
          </section>

          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold">Top etiquetas</h3>
              <button
                className="px-3 py-1 text-sm border rounded"
                onClick={doExportEtiquetas}
              >
                Exportar CSV
              </button>
            </div>
            {etiquetasData.length === 0 ? (
              <div className="p-3 text-sm text-gray-500 border rounded">
                Sin etiquetas en el período.
              </div>
            ) : (
              <BarChart data={etiquetasData} />
            )}
          </section>

          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold">Conversaciones por agente</h3>
              <button
                className="px-3 py-1 text-sm border rounded"
                onClick={doExportAgentes}
              >
                Exportar CSV
              </button>
            </div>
            {agentesData.length === 0 ? (
              <div className="p-3 text-sm text-gray-500 border rounded">
                Sin asignación en el período.
              </div>
            ) : (
              <BarChart data={agentesData} />
            )}
          </section>

          <section className="space-y-2">
            <h3 className="text-base font-semibold">Vendedores activos por zona</h3>
            <div className="grid gap-3 md:grid-cols-2">
              {Object.entries(vendedoresPorZonaFiltrado).map(([zona, arr]) => (
                <div key={zona} className="p-3 border rounded">
                  <div className="flex items-center justify-between">
                    <div className="font-medium">{zona}</div>
                    <div className="text-sm text-gray-500">
                      {arr.length} vendedor(es)
                    </div>
                  </div>
                  <ul className="mt-2 space-y-1 text-sm">
                    {arr.map((v) => (
                      <li
                        key={v.id}
                        className="flex items-center justify-between"
                      >
                        <span>
                          {v.alias || v.owner || v.phone}
                          {v.phone ? ` · ${v.phone}` : ""}
                        </span>
                        {!v.active && (
                          <span className="text-xs text-gray-500">inactivo</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {/* Contenido de NUEVAS pestañas */}
      {tab === "campaigns" && <CampaignsPanel />}
      {tab === "tasks" && <TasksPanel />}
      {tab === "dashboardPro" && <DashboardPro />}
    </div>
  );
}
