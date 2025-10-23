// src/components/AdminPanel.jsx
import { useEffect, useMemo, useState } from "react";
import { auth, db } from "../firebase";
import {
  addDoc,
  collection,
  getDocs,
  doc,
  getDoc,
  onSnapshot,
  Timestamp,
} from "firebase/firestore";

import AdminVendors from "./AdminVendors.jsx";
import LabelsAdmin from "./LabelsAdmin.jsx";
import TemplatesPanel from "./TemplatesPanel.jsx";
import TasksPanel from "./TasksPanel.jsx";
import VendorDetailPanel from "./VendorDetailPanel.jsx";

/* ========================= Helpers fecha ========================= */
function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function endOfDay(d) { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; }
function ymd(d) {
  const x = new Date(d);
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const dd = String(x.getDate()).padStart(2, "0");
  return `${x.getFullYear()}-${m}-${dd}`;
}
function parseLocalYMD(s) {
  try {
    const [y, m, d] = String(s).split("-").map(Number);
    return new Date(y, m - 1, d);
  } catch {
    return new Date(s);
  }
}
// NUEVO: Zona horaria fija de negocio
const BUSINESS_TZ = "America/Argentina/Cordoba";
function ymdTZ(d) {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: BUSINESS_TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(d));
  } catch {
    return ymd(d);
  }
}
function startOfDayTZ(d) {
  try {
    const s = ymdTZ(d);
    const [y, m, dd] = s.split("-").map(Number);
    // GMT-3 → medianoche local equivale a 03:00 UTC
    return new Date(Date.UTC(y, (m || 1) - 1, dd || 1, 3, 0, 0, 0));
  } catch {
    return startOfDay(d);
  }
}
function endOfDayTZ(d) {
  try {
    const start = startOfDayTZ(d);
    return new Date(start.getTime() + 86400000 - 1);
  } catch {
    return endOfDay(d);
  }
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

/* ======== Presencia helper (estricto: flag + lastSeen fresco) ======== */
function calcOnline(userDoc) {
  if (!userDoc) return false;
  const flag =
    userDoc.online === true ||
    userDoc.isOnline === true ||
    userDoc.onlineStatus === "online";
  const ms = tsToMs(userDoc.lastSeen);
  const fresh = ms && (Date.now() - ms) < 2 * 60 * 1000; // 2 minutos
  return !!(flag && fresh);
}

/* =============================================================== */
function cleanAgentLabel(s) {
  const val = String(s || "").trim();
  if (!val) return "";
  if (val.includes("@")) {
    const local = val.split("@")[0];
    const name = local.replace(/[._-]+/g, " ").trim();
    return name.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  }
  return val;
}

/* =============================================================== */
/* NUEVO: Formulario para asignar tareas a agentes (Admin → Agenda) */
function AdminAssignTask({ vendors }) {
  const [vendorOptions, setVendorOptions] = useState([]);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    userId: "",
    titulo: "",
    nota: "",
    fecha: "", // YYYY-MM-DD
    hora: "",  // HH:MM
  });

  useEffect(() => {
    // Mapear vendors (wabaNumbers) a opciones de selección: uid + label visible
    const arr = [];
    for (const v of vendors || []) {
      const uid = v.ownerUid || v.userUid || v.uid || v.id;
      const label = v.alias || v.owner || v.phone || uid;
      if (uid) arr.push({ uid, label });
    }
    arr.sort((a, b) => a.label.localeCompare(b.label));
    setVendorOptions(arr);
  }, [vendors]);

  function toLocalTimestamp(ymd, hm) {
    if (!ymd) return Timestamp.fromDate(new Date());
    const [y, m, d] = ymd.split("-").map(Number);
    let H = 9, M = 0; // por defecto 09:00
    if (hm && /^\d{2}:\d{2}$/.test(hm)) {
      [H, M] = hm.split(":").map(Number);
    }
    const js = new Date(y, (m || 1) - 1, d || 1, H || 0, M || 0, 0);
    return Timestamp.fromDate(js);
  }

  async function handleCreate(e) {
    e?.preventDefault?.();
    if (!form.userId) return alert("Elegí un agente.");
    if (!form.titulo.trim()) return alert("Escribí un título.");
    setSaving(true);
    try {
      await addDoc(collection(db, "tareas"), {
        userId: form.userId,
        titulo: form.titulo.trim(),
        nota: form.nota?.trim() || "",
        fecha: toLocalTimestamp(form.fecha, form.hora),
        done: false,
        createdBy: auth?.currentUser?.uid || null,
        createdAt: Timestamp.now(),
      });
      setForm({ userId: "", titulo: "", nota: "", fecha: "", hora: "" });
      alert("Tarea creada y asignada 🙌");
    } catch (err) {
      console.error(err);
      alert("No se pudo crear la tarea.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="p-6 rounded-2xl border shadow bg-white/95 mb-6">
      <h3 className="text-lg font-bold text-slate-800 mb-3">🗓️ Asignar tarea a un agente</h3>
      <form onSubmit={handleCreate} className="grid gap-3 md:grid-cols-12">
        <select
          className="p-2 border rounded md:col-span-3"
          value={form.userId}
          onChange={(e)=>setForm(f=>({...f, userId:e.target.value}))}
          required
        >
          <option value="">Asignar a…</option>
          {vendorOptions.map(v => (
            <option key={v.uid} value={v.uid}>{v.label}</option>
          ))}
        </select>

        <input
          className="p-2 border rounded md:col-span-3"
          placeholder="Título de la tarea"
          value={form.titulo}
          onChange={(e)=>setForm(f=>({...f, titulo:e.target.value}))}
          required
        />

        <input
          type="date"
          className="p-2 border rounded md:col-span-2"
          value={form.fecha}
          onChange={(e)=>setForm(f=>({...f, fecha:e.target.value}))}
          required
        />
        <input
          type="time"
          className="p-2 border rounded md:col-span-2"
          value={form.hora}
          onChange={(e)=>setForm(f=>({...f, hora:e.target.value}))}
        />

        <input
          className="p-2 border rounded md:col-span-12"
          placeholder="Nota (opcional)"
          value={form.nota}
          onChange={(e)=>setForm(f=>({...f, nota:e.target.value}))}
        />

        <div className="md:col-span-12">
          <button
            disabled={saving}
            className="px-4 py-2 rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-70"
          >
            {saving ? "Creando…" : "Crear tarea"}
          </button>
        </div>
      </form>
      <p className="text-xs text-slate-500 mt-2">
        Tip: La tarea aparecerá automáticamente en la <b>Agenda</b> del agente (porque la Agenda filtra <code>tareas</code> por <code>userId</code> y <code>fecha</code>).
      </p>
    </section>
  );
}

/* =============================================================== */
/* ============================ MAIN ============================= */
export default function AdminPanel() {
  // Pestañas
  const [tab, setTab] = useState("dashboard");
  const [selectedVendorUid, setSelectedVendorUid] = useState(null);

  // Estado
  const [loading, setLoading] = useState(false);
  const [convs, setConvs] = useState([]);
  const [vendors, setVendors] = useState([]);

  // mapa de users para presencia
  const [usersByUid, setUsersByUid] = useState({});

  // Filtros globales (sin agente)
  const [mode, setMode] = useState("7"); // ← soporta "today"
  const [from, setFrom] = useState(ymdTZ(new Date(Date.now() - 6 * 86400000)));
  const [to, setTo] = useState(ymdTZ(new Date()));
  const [zoneFilter, setZoneFilter] = useState("(todas)");
  const [labelFilter, setLabelFilter] = useState([]);
  const [q, setQ] = useState("");

  // Paginado de tabla global
  const [page, setPage] = useState(1);
  const pageSize = 10;

  // Zonas dinámicas (desde vendors activos)
  const zonas = useMemo(() => {
    const set = new Set(
      vendors.filter(v => v.active)
        .map(v => (v.zone || "Sin zona").trim())
        .filter(Boolean)
    );
    return ["(todas)", ...Array.from(set).sort()];
  }, [vendors]);

  // Carga datasets del dashboard + escucha users para presencia
  useEffect(() => {
    if (tab !== "dashboard" && tab !== "tasks") return; // vendors y users nos sirven en ambas
    setLoading(true);

    let unsubUsers = null;
    (async () => {
      try {
        // Conversaciones
        const cs = await getDocs(collection(db, "conversations"));
        const convRows = await Promise.all(
          cs.docs.map(async (d) => {
            let contact = null;
            try {
              const c = await getDoc(doc(db, "contacts", d.id));
              contact = c.exists() ? c.data() : null;
            } catch {}
            return { id: d.id, ...d.data(), contact };
          })
        );
        setConvs(convRows);

        // Vendedores (wabaNumbers)
        const vs = await getDocs(collection(db, "wabaNumbers"));
        setVendors(vs.docs.map(d => ({ id: d.id, ...d.data() })));

        // Users: presencia en tiempo real
        unsubUsers = onSnapshot(collection(db, "users"), (snap) => {
          const map = {};
          snap.forEach((doc) => { map[doc.id] = doc.data(); });
          setUsersByUid(map);
        });
      } finally {
        setLoading(false);
      }
    })();

    return () => { try { unsubUsers && unsubUsers(); } catch {} };
  }, [tab]);

  // Períodos rápidos
  useEffect(() => {
    if (mode === "today") {
      const now = new Date();
      setFrom(ymdTZ(now));
      setTo(ymdTZ(now));
    } else if (mode === "7") {
      const end = new Date();
      const start = new Date(Date.now() - 6 * 86400000);
      setFrom(ymdTZ(start)); setTo(ymdTZ(end));
    } else if (mode === "30") {
      const end = new Date();
      const start = new Date(Date.now() - 29 * 86400000);
      setFrom(ymdTZ(start)); setTo(ymdTZ(end));
    } else if (mode === "month") {
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      setFrom(ymdTZ(start)); setTo(ymdTZ(end));
    }
  }, [mode]);

  // Derivados
  const range = useMemo(() => [
    +startOfDayTZ(parseLocalYMD(from)),
    +endOfDayTZ(parseLocalYMD(to))
  ], [from, to]);

  const convsInRange = useMemo(() => {
    const [a, b] = range;
    return convs.filter(c => {
      const t = tsToMs(c.lastMessageAt) || tsToMs(c.createdAt);
      return t >= a && t <= b;
    });
  }, [convs, range]);

  // Índice zona → vendedores (para filtrar por zona)
  const vendorIndexByZone = useMemo(() => {
    const map = new Map();
    for (const v of vendors) {
      const z = (v.zone || "Sin zona").trim();
      if (!map.has(z)) map.set(z, { uids: new Set(), names: new Set() });
      if (v.ownerUid) map.get(z).uids.add(v.ownerUid);
      if (v.userUid) map.get(z).uids.add(v.userUid);
      if (v.uid)      map.get(z).uids.add(v.uid);
      if (v.id)       map.get(z).uids.add(v.id);
      if (v.alias) map.get(z).names.add(v.alias);
      if (v.owner) map.get(z).names.add(v.owner);
      if (v.phone) map.get(z).names.add(v.phone);
    }
    return map;
  }, [vendors]);

  // Índice uid → nombre visible (alias/owner/phone)
  const vendorNameByUid = useMemo(() => {
    const map = {};
    for (const v of vendors) {
      const uid = v.ownerUid || v.userUid || v.uid || v.id;
      const name = v.alias || v.owner || v.phone || "";
      if (uid && name) map[uid] = name;
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

  const convsByLabel = useMemo(() => {
    if (!labelFilter.length) return convsByZone;
    const set = new Set(labelFilter);
    return convsByZone.filter(c => {
      const ls = Array.isArray(c.labels) ? c.labels : [];
      return ls.some(s => set.has(s));
    });
  }, [convsByZone, labelFilter]);

  // Vista total: sin filtro de agente
  const convsFiltered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return convsByLabel;
    return convsByLabel.filter(c => {
      const id = String(c.id || "").toLowerCase();
      const name = String(c.contact?.name || "").toLowerCase();
      return id.includes(s) || name.includes(s);
    });
  }, [convsByLabel, q]);

  // ⚠️ Reset de página ante cambios de filtros
  useEffect(() => { setPage(1); }, [mode, from, to, zoneFilter, labelFilter, q]);

  // Paginado
  const totalItems = convsFiltered.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const pageClamped = Math.min(page, totalPages);
  const sliceStart = (pageClamped - 1) * pageSize;
  const sliceEnd   = sliceStart + pageSize;
  const convsPage  = convsFiltered.slice(sliceStart, sliceEnd);

  // KPIs globales
  const getAgentName = (c) => {
    const uid = c.assignedToUid || "";
    const u = usersByUid[uid];
    const userName = u?.alias || u?.displayName || u?.name || "";
    const vendorName = vendorNameByUid[uid] || "";
    const assignedName = cleanAgentLabel(c.assignedToName || "");
    const name = userName || vendorName || assignedName;
    return name || (uid ? uid : "Sin asignar");
  };
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
      const k = getAgentName(c);
      porAgente[k] = (porAgente[k] || 0) + 1;
    }

    return { total, sinAsignar, porEtiqueta, porAgente };
  }, [convsFiltered, usersByUid, vendorNameByUid]);

  // Series y tops
  const seriePorDia = useMemo(() => {
    const map = new Map();
    const [a, b] = range;
    for (let t = a; t <= b; t += 86400000) map.set(ymdTZ(new Date(t)), 0);
    for (const c of convsFiltered) {
      const t = tsToMs(c.lastMessageAt) || tsToMs(c.createdAt);
      const key = ymdTZ(new Date(t));
      if (map.has(key)) map.set(key, (map.get(key) || 0) + 1);
    }
    return Array.from(map.entries()).map(([k, v]) => ({ k, v }));
  }, [convsFiltered, range]);

  const etiquetasData = useMemo(
    () => Object.entries(kpis.porEtiqueta).sort((a, b) => b[1] - a[1]).slice(0, 50).map(([k, v]) => ({ k, v })),
    [kpis.porEtiqueta]
  );

  const agentesData = useMemo(
    () => Object.entries(kpis.porAgente).sort((a, b) => b[1] - a[1]).slice(0, 50).map(([k, v]) => ({ k, v })),
    [kpis.porAgente]
  );

  // 🛒 Ventas por vendedor (con etiqueta 'vendido')
  const ventasPorAgente = useMemo(() => {
    const map = new Map();
    for (const c of convsFiltered) {
      const ls = Array.isArray(c.labels) ? c.labels : [];
      if (!ls.includes("vendido")) continue;
      const key = getAgentName(c);
      map.set(key, (map.get(key) || 0) + 1);
    }
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 50)
      .map(([k, v]) => ({ k, v }));
  }, [convsFiltered, usersByUid, vendorNameByUid]);

  // Vendedores activos / por zona
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

  // Exports
  const suffix = `${from}_a_${to}`;
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

  // ────────────────────────────────────────────────────────────
  // UI
  return (
    <div className="min-h-screen bg-gradient-to-br via-blue-50 to-indigo-100 from-slate-50">
      <div className="p-6 mx-auto space-y-8 max-w-7xl">
        {/* Header */}
        <div className="space-y-4 text-center">
          <h1 className="text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r via-blue-900 to-indigo-900 from-slate-900">
            Panel de Administración
          </h1>
          <p className="text-lg text-slate-600">Gestiona tu CRM con herramientas avanzadas</p>
        </div>

        <section className="p-6 rounded-2xl border shadow-lg backdrop-blur-sm bg-white/90 border-white/20">
          <h3 className="mb-4 text-xl font-bold text-slate-800">🌍 Vendedores activos por zona</h3>
          <div className="grid gap-4 md:grid-cols-2">
            {Object.entries(vendedoresPorZonaFiltrado).map(([zona, arr]) => (
              <div key={zona} className="p-4 bg-gradient-to-br rounded-xl border shadow-sm from-slate-50 to-slate-100 border-slate-200/60">
                <div className="flex justify-between items-center mb-3">
                  <div className="font-semibold text-slate-800">{zona}</div>
                  <div className="px-2 py-1 text-sm rounded-full text-slate-600 bg-slate-200">
                    {arr.length} vendedor(es)
                  </div>
                </div>
                <ul className="space-y-2">
                  {arr.map((v) => {
                    const uid = v.ownerUid || v.userUid || v.uid || v.id;
                    const u = usersByUid[uid];
                    const online = calcOnline(u);
                    return (
                      <li
                        key={v.id}
                        className="flex flex-wrap gap-2 justify-between items-center p-2 rounded-lg border bg-white/60 border-slate-200/40"
                      >
                        <span className="text-sm font-medium text-slate-700">
                          {v.alias || v.owner || v.phone}
                          {v.phone ? ` · ${v.phone}` : ""}
                        </span>

                        <span
                          className={`px-2 py-1 text-xs rounded-full ${
                            online ? "text-green-700 bg-green-100" : "text-red-600 bg-red-100"
                          }`}
                          title={u?.lastSeen ? `Visto: ${new Date(tsToMs(u.lastSeen)).toLocaleString()}` : undefined}
                        >
                          {online ? "Online" : "Offline"}
                        </span>

                        <button
                          className="px-3 py-1 text-sm bg-white rounded-lg border shadow hover:bg-slate-50"
                          onClick={() => {
                            setSelectedVendorUid(uid);
                            setTab("vendorDetail");
                          }}
                        >
                          Ver detalle →
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </section>

        {/* Tabs */}
        <div className="p-2 rounded-2xl border shadow-lg backdrop-blur-sm bg-white/80 border-white/20">
          <div className="flex flex-wrap gap-1">
            {[
              { key: "numbers", label: "📱 Números" },
              { key: "dashboard", label: "📊 Dashboard" },
              { key: "templates", label: "📝 Plantillas" },
              { key: "labels", label: "🏷️ Etiquetas" },
              { key: "tasks", label: "✅ Tareas" },
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
                        <option value="today">Hoy</option>
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
                      onClick={() => { setMode("today"); setZoneFilter("(todas)"); setLabelFilter([]); setQ(""); }}
                      title="Resetea filtros y muestra solo HOY"
                    >
                      Hoy
                    </button>

                    <button
                      className="px-6 py-2 text-white bg-gradient-to-r rounded-xl shadow-lg transition-all duration-300 transform from-slate-500 to-slate-600 hover:from-slate-600 hover:to-slate-700 hover:scale-105"
                      onClick={() => { setZoneFilter("(todas)"); setLabelFilter([]); setQ(""); setMode("30"); }}
                    >
                      Limpiar filtros
                    </button>

                    <div className="ml-auto text-sm font-medium text-slate-600">
                      {`Mostrando ${convsFiltered.length} conversaciones`}
                    </div>
                  </div>

                  {/* Filtro de etiquetas */}
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

                    <div className="space-y-2 opacity-60">
                      <label className="text-sm font-semibold text-slate-700">Agentes</label>
                      <div className="px-4 py-3 text-sm rounded-xl border border-dashed border-slate-300 bg-slate-50 text-slate-500">
                        El filtrado por vendedor/agente se hace en el detalle (VendorDetailPanel).
                      </div>
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

                {/* Conversaciones por día */}
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

                {/* Top etiquetas */}
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

                {/* Distribución por agente */}
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

                {/* Ventas por vendedor */}
                <ListStatCard
                  title="🛒 Ventas por vendedor"
                  accent="#16a34a"
                  data={ventasPorAgente}
                  formatter={(k) => String(k)}
                />

                {/* Tabla de conversaciones */}
                <section className="p-6 rounded-2xl border shadow bg-white/90">
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-xl font-bold text-slate-800">📚 Conversaciones</h3>
                    <div className="text-sm text-slate-600">
                      {`Mostrando ${convsPage.length} de ${totalItems} (pág. ${pageClamped}/${totalPages})`}
                    </div>
                  </div>

                  {convsPage.length === 0 ? (
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
                              <th>Asignado</th>
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
                                  <div className="text-xs text-slate-500">{c.contact?.phone || ""}</div>
                                </td>
                                <td className="text-sm">
                                  {getAgentName(c)}
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
              </>
            )}
          </div>
        )}

        {tab === "tasks" && (
          <>
            {/* NUEVO: Asignación de tareas a agentes (se conecta con la Agenda) */}
            <AdminAssignTask vendors={vendedoresActivos} />
            {/* Panel de tareas existente (no se toca) */}
            <TasksPanel />
          </>
        )}

        {/* Vista de detalle del vendedor */}
        {tab === "vendorDetail" && selectedVendorUid && (
          <VendorDetailPanel
            vendorUid={selectedVendorUid}
            onBack={() => setTab("dashboard")}
          />
        )}
      </div>
    </div>
  );
}
