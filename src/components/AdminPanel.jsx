// src/components/AdminPanel.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { auth, db } from "../firebase";
import {
  addDoc,
  collection,
  getDocs,
  doc,
  onSnapshot,
  Timestamp,
  serverTimestamp,

  // ✅ NUEVO: batch contacts (evita 1 getDoc por conversación)
  query,
  where,
  documentId,
} from "firebase/firestore";

import AdminVendors from "./AdminVendors.jsx";
import LabelsAdmin from "./LabelsAdmin.jsx";
import TemplatesPanel from "./TemplatesPanel.jsx";
import TasksPanel from "./TasksPanel.jsx";
import VendorDetailPanel from "./VendorDetailPanel.jsx";
import ConversacionesHoy from "./ConversacionesHoy.jsx";

/* ========================= Helpers fecha ========================= */
function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}
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

// Zona horaria fija de negocio
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
    return new Date(Date.UTC(y, (m || 1) - 1, dd || 1, 3, 0, 0, 0)); // GMT-3
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
  const head = headers.map((h) => `"${h}"`).join(",");
  const body = rows
    .map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\n");
  return head + "\n" + body;
}
function downloadCSV(filename, csv) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ========================= Presentational Cards ========================= */
function MiniStatCard({ title, value, from = "#eef2ff", to = "#e0e7ff", text = "#1e293b" }) {
  return (
    <div
      className="p-4 border shadow-lg rounded-2xl bg-white/80 backdrop-blur-sm flex flex-col justify-between hover:translate-y-0.5 transition-transform"
      style={{
        backgroundImage: `linear-gradient(145deg, ${from}, ${to})`,
        borderColor: "rgba(148,163,184,.35)",
      }}
    >
      <div className="text-[11px] font-semibold tracking-[0.08em] uppercase text-slate-500">
        {title}
      </div>
      <div className="mt-3 text-3xl font-extrabold leading-none" style={{ color: text }}>
        {value}
      </div>
    </div>
  );
}

function ListStatCard({ title, data, accent = "#3b82f6", exportBtn, formatter = (k) => k }) {
  return (
    <section className="p-6 space-y-4 border shadow-lg rounded-2xl bg-white/95 backdrop-blur-md">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
          <p className="mt-1 text-xs text-slate-500">
            Vista resumida. Ideal para detectar patrones rápidos.
          </p>
        </div>
        <div className="flex items-center gap-2">{exportBtn}</div>
      </div>

      {data.length === 0 ? (
        <div className="p-6 text-sm text-center border border-dashed rounded-xl bg-slate-50/80 text-slate-500">
          Sin datos en el período seleccionado.
        </div>
      ) : (
        <div className="max-h-[360px] overflow-y-auto pr-1">
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {data.map((d, i) => (
              <div
                key={i}
                className="p-4 transition-colors border shadow-sm rounded-xl bg-white/90 hover:bg-slate-50/90 group"
                style={{ borderColor: "rgba(226,232,240,.9)" }}
                title={`${formatter(d.k)}: ${d.v}`}
              >
                <div
                  className="mb-1 text-3xl font-extrabold tracking-tight tabular-nums"
                  style={{ color: accent }}
                >
                  {d.v}
                </div>
                <div className="text-xs font-medium tracking-wide uppercase text-slate-400">
                  {formatter(d.k)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

/* ======== Presencia helper ======== */
function calcOnline(userDoc) {
  if (!userDoc) return false;
  const flag =
    userDoc.online === true ||
    userDoc.isOnline === true ||
    userDoc.onlineStatus === "online";
  const ms = tsToMs(userDoc.lastSeen);
  const fresh = ms && Date.now() - ms < 2 * 60 * 1000; // 2 minutos
  return !!(flag && fresh);
}

/* =============================================================== */
function cleanAgentLabel(s) {
  const val = String(s || "").trim();
  if (!val) return "";
  if (val.includes("@")) {
    const local = val.split("@")[0];
    const name = local.replace(/[._-]+/g, " ").trim();
    return name
      .split(/\s+/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  }
  return val;
}

/* ========================= Batch helpers ========================= */
function chunk(array, size = 10) {
  const out = [];
  for (let i = 0; i < array.length; i += size) out.push(array.slice(i, i + size));
  return out;
}

/* =============================================================== */
/* Form para asignar tareas a agentes (Admin → Agenda) */
function AdminAssignTask({ vendors }) {
  const [vendorOptions, setVendorOptions] = useState([]);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    userId: "",
    titulo: "",
    nota: "",
    fecha: "", // YYYY-MM-DD
    hora: "", // HH:MM
  });

  useEffect(() => {
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
    let H = 9,
      M = 0;
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
        fechaStr: form.fecha || null,
        done: false,
        createdBy: auth?.currentUser?.uid || null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      setForm({ userId: "", titulo: "", nota: "", fecha: "", hora: "" });
      alert("Tarea creada y asignada 🙌");
    } catch (err) {
      console.error("create task failed:", err?.code, err?.message, err);
      alert("No se pudo crear la tarea.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="p-6 mb-6 border shadow-lg rounded-2xl bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-slate-100">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h3 className="flex items-center gap-2 mb-1 text-lg font-semibold">
            <span className="inline-flex items-center justify-center text-xs rounded-full w-7 h-7 bg-indigo-500/80">
              🗓️
            </span>
            Asignar tarea a un agente
          </h3>
          <p className="text-xs text-slate-300/90">
            Las tareas se muestran automáticamente en la Agenda del vendedor correspondiente.
          </p>
        </div>
        <span className="hidden px-2 py-1 text-[10px] font-semibold tracking-wide uppercase rounded-full bg-slate-800/80 text-slate-300 md:inline-flex">
          Agenda interna
        </span>
      </div>

      <form
        onSubmit={handleCreate}
        className="grid gap-3 p-3 md:grid-cols-12 bg-slate-900/30 rounded-2xl"
      >
        <select
          className="p-2 text-sm border rounded-xl md:col-span-3 bg-slate-900/60 border-slate-700 text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          value={form.userId}
          onChange={(e) => setForm((f) => ({ ...f, userId: e.target.value }))}
          required
        >
          <option value="">Asignar a…</option>
          {vendorOptions.map((v) => (
            <option key={v.uid} value={v.uid}>
              {v.label}
            </option>
          ))}
        </select>

        <input
          className="p-2 text-sm border rounded-xl md:col-span-3 bg-slate-900/60 border-slate-700 text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          placeholder="Título de la tarea"
          value={form.titulo}
          onChange={(e) => setForm((f) => ({ ...f, titulo: e.target.value }))}
          required
        />

        <input
          type="date"
          className="p-2 text-sm border rounded-xl md:col-span-2 bg-slate-900/60 border-slate-700 text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          value={form.fecha}
          onChange={(e) => setForm((f) => ({ ...f, fecha: e.target.value }))}
          required
        />
        <input
          type="time"
          className="p-2 text-sm border rounded-xl md:col-span-2 bg-slate-900/60 border-slate-700 text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          value={form.hora}
          onChange={(e) => setForm((f) => ({ ...f, hora: e.target.value }))}
        />

        <input
          className="p-2 text-sm border rounded-xl md:col-span-12 bg-slate-900/60 border-slate-700 text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          placeholder="Nota (opcional)"
          value={form.nota}
          onChange={(e) => setForm((f) => ({ ...f, nota: e.target.value }))}
        />

        <div className="flex items-center justify-between gap-2 md:col-span-12">
          <button
            disabled={saving}
            className="px-4 py-2 text-sm font-semibold text-white shadow-lg rounded-xl bg-gradient-to-r from-indigo-500 to-blue-500 shadow-indigo-500/25 hover:from-indigo-400 hover:to-blue-400 disabled:opacity-70"
          >
            {saving ? "Creando…" : "Crear tarea"}
          </button>
          <span className="text-[11px] text-slate-400">
            Tip: usá fechas futuras para recordatorios programados.
          </span>
        </div>
      </form>
    </section>
  );
}

/* ============================ MAIN ============================= */
export default function AdminPanel() {
  // Pestañas
  const [tab, setTab] = useState("dashboard");
  const [selectedVendorUid, setSelectedVendorUid] = useState(null);

  // Estado
  const [loading, setLoading] = useState(false);
  const [convs, setConvs] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [usersByUid, setUsersByUid] = useState({});

  // ✅ mapa de contacts por id (evita N getDoc)
  const contactsByIdRef = useRef({});

  // Filtros globales (sin agente)
  const [mode, setMode] = useState("7"); // soporta "today"
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
      vendors
        .filter((v) => v.active)
        .map((v) => (v.zone || "Sin zona").trim())
        .filter(Boolean)
    );
    return ["(todas)", ...Array.from(set).sort()];
  }, [vendors]);

  // ✅ Suscripción users (presencia): UNA sola vez
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "users"), (snap) => {
      const map = {};
      snap.forEach((d) => (map[d.id] = d.data()));
      setUsersByUid(map);
    });
    return () => {
      try {
        unsub && unsub();
      } catch { }
    };
  }, []);

  // ✅ Cargar vendors una vez (para zonas + resumen)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const vs = await getDocs(collection(db, "wabaNumbers"));
        if (cancelled) return;
        setVendors(vs.docs.map((d) => ({ id: d.id, ...d.data() })));
      } catch (e) {
        console.error("load vendors failed:", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ✅ Cargar conversaciones SOLO cuando estás en dashboard (y con contacts por batch)
  useEffect(() => {
    if (tab !== "dashboard") return;

    let cancelled = false;

    (async () => {
      setLoading(true);
      try {
        // 1) Conversaciones (1 request)
        const cs = await getDocs(collection(db, "conversations"));
        if (cancelled) return;

        const raw = cs.docs.map((d) => ({ id: d.id, ...d.data() }));

        // 2) Contacts en batches de 10 (en vez de getDoc por conv)
        const ids = raw.map((c) => c.id).filter(Boolean);

        // ⚠️ Guardrail para no spamear si tenés MUCHÍSIMAS convs
        // (si querés, subilo; esto evita volver a resource-exhausted)
        const MAX_CONTACTS_PREFETCH = 500; // ~50 requests (500/10)
        const idsToFetch = ids.slice(0, MAX_CONTACTS_PREFETCH);

        const contactsMap = { ...(contactsByIdRef.current || {}) };

        // fetch solo los que no estén ya cacheados
        const missing = idsToFetch.filter((id) => !contactsMap[id]);

        for (const part of chunk(missing, 10)) {
          if (cancelled) return;
          const qs = query(collection(db, "contacts"), where(documentId(), "in", part));
          const snap = await getDocs(qs);
          snap.forEach((cd) => {
            contactsMap[cd.id] = cd.data();
          });
        }

        contactsByIdRef.current = contactsMap;

        // 3) Merge (misma estructura que antes: conv + contact)
        const merged = raw.map((c) => ({
          ...c,
          contact: contactsMap[c.id] || null,
        }));

        setConvs(merged);
      } catch (e) {
        console.error("load dashboard failed:", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
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
      setFrom(ymdTZ(start));
      setTo(ymdTZ(end));
    } else if (mode === "30") {
      const end = new Date();
      const start = new Date(Date.now() - 29 * 86400000);
      setFrom(ymdTZ(start));
      setTo(ymdTZ(end));
    } else if (mode === "month") {
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      setFrom(ymdTZ(start));
      setTo(ymdTZ(end));
    }
  }, [mode]);

  // Derivados
  const range = useMemo(
    () => [+startOfDayTZ(parseLocalYMD(from)), +endOfDayTZ(parseLocalYMD(to))],
    [from, to]
  );

  const convsInRange = useMemo(() => {
    const [a, b] = range;
    return convs.filter((c) => {
      const t =
        mode === "today"
          ? tsToMs(c.lastInboundAt) || tsToMs(c.firstInboundAt) || tsToMs(c.createdAt)
          : tsToMs(c.lastMessageAt) || tsToMs(c.updatedAt) || tsToMs(c.createdAt);
      return t >= a && t <= b;
    });
  }, [convs, range, mode]);

  const vendorIndexByZone = useMemo(() => {
    const map = new Map();
    for (const v of vendors) {
      const z = (v.zone || "Sin zona").trim();
      if (!map.has(z)) map.set(z, { uids: new Set(), names: new Set() });
      if (v.ownerUid) map.get(z).uids.add(v.ownerUid);
      if (v.userUid) map.get(z).uids.add(v.userUid);
      if (v.uid) map.get(z).uids.add(v.uid);
      if (v.id) map.get(z).uids.add(v.id);
      if (v.alias) map.get(z).names.add(v.alias);
      if (v.owner) map.get(z).names.add(v.owner);
      if (v.phone) map.get(z).names.add(v.phone);
    }
    return map;
  }, [vendors]);

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
    return convsInRange.filter((c) => {
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
    return convsByZone.filter((c) => {
      const ls = Array.isArray(c.labels) ? c.labels : [];
      return ls.some((s) => set.has(s));
    });
  }, [convsByZone, labelFilter]);

  const convsFiltered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return convsByLabel;
    return convsByLabel.filter((c) => {
      const id = String(c.id || "").toLowerCase();
      const name = String(c.contact?.name || "").toLowerCase();
      return id.includes(s) || name.includes(s);
    });
  }, [convsByLabel, q]);

  useEffect(() => {
    setPage(1);
  }, [mode, from, to, zoneFilter, labelFilter, q]);

  // Paginado
  const totalItems = convsFiltered.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const pageClamped = Math.min(page, totalPages);
  const sliceStart = (pageClamped - 1) * pageSize;
  const sliceEnd = sliceStart + pageSize;
  const convsPage = convsFiltered.slice(sliceStart, sliceEnd);

  // KPIs
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
    const sinAsignar = convsFiltered.filter((c) => !c.assignedToUid && !c.assignedToName).length;

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
    () =>
      Object.entries(kpis.porEtiqueta)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 50)
        .map(([k, v]) => ({ k, v })),
    [kpis.porEtiqueta]
  );

  const agentesData = useMemo(
    () =>
      Object.entries(kpis.porAgente)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 50)
        .map(([k, v]) => ({ k, v })),
    [kpis.porAgente]
  );

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

  const vendedoresActivos = useMemo(() => vendors.filter((v) => !!v.active), [vendors]);

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
      : vendedoresPorZona[zoneFilter]?.length || 0;
  }, [zoneFilter, vendedoresActivos.length, vendedoresPorZona]);

  // Exports
  const suffix = `${from}_a_${to}`;
  const doExportPorDia = () => {
    const csv = toCSV(
      seriePorDia.map((d) => [d.k, d.v]),
      ["fecha", "conversaciones"]
    );
    downloadCSV(`conversaciones_por_dia_${suffix}.csv`, csv);
  };
  const doExportEtiquetas = () => {
    const csv = toCSV(
      Object.entries(kpis.porEtiqueta).map(([k, v]) => [k, v]),
      ["etiqueta", "conversaciones"]
    );
    downloadCSV(`conversaciones_por_etiqueta_${suffix}.csv`, csv);
  };
  const doExportAgentes = () => {
    const csv = toCSV(
      Object.entries(kpis.porAgente).map(([k, v]) => [k, v]),
      ["agente", "conversaciones"]
    );
    downloadCSV(`conversaciones_por_agente_${suffix}.csv`, csv);
  };

  // ────────────────────────────────────────────────────────────
  // UI
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-slate-100 to-indigo-100">
      <div className="px-4 py-6 mx-auto space-y-8 max-w-7xl sm:px-6 lg:px-8">
        {/* Header */}
        <header className="relative overflow-hidden border shadow-xl rounded-3xl bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 text-slate-50">
          <div className="absolute inset-0 opacity-20 bg-[radial-gradient(circle_at_top,_#4f46e5,_transparent_55%),radial-gradient(circle_at_bottom,_#0ea5e9,_transparent_55%)]" />
          <div className="relative flex flex-col gap-4 px-6 py-6 sm:px-10 sm:py-8 md:flex-row md:items-center md:justify-between">
            <div className="space-y-2">
              <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
                Panel de Administración
              </h1>
              <p className="max-w-xl text-sm sm:text-base text-slate-300">
                Vista central para controlar conversaciones, vendedores, plantillas, etiquetas y tareas del equipo.
              </p>
            </div>
            <div className="flex flex-col items-start gap-2 text-xs text-slate-300 md:items-end">
              <span className="inline-flex items-center gap-2 px-3 py-1 border rounded-full bg-slate-800/80 border-slate-700">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                Monitoreo en tiempo real
              </span>
              <span className="hidden md:block">
                Rango actual:{" "}
                <span className="font-semibold text-slate-100">
                  {from} → {to}
                </span>
              </span>
            </div>
          </div>
        </header>

        {/* Vendedores por zona (resumen) */}
        <section className="p-6 space-y-4 border shadow-lg rounded-2xl bg-white/95 backdrop-blur-md">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="mb-1 text-xl font-bold text-slate-900">🌍 Vendedores activos por zona</h3>
              <p className="text-sm text-slate-500">
                Mapa rápido de cobertura de cada zona y presencia online de los vendedores.
              </p>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {Object.entries(vendedoresPorZonaFiltrado).map(([zona, arr]) => (
              <div
                key={zona}
                className="p-4 space-y-3 border shadow-sm rounded-2xl bg-gradient-to-br from-slate-50 to-slate-100 border-slate-200/60"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center justify-center w-8 h-8 text-sm font-semibold rounded-full bg-slate-900/90 text-slate-50">
                      {zona.charAt(0).toUpperCase()}
                    </span>
                    <div>
                      <div className="font-semibold text-slate-800">{zona}</div>
                      <div className="text-xs text-slate-500">
                        {arr.length > 0 ? "Vendedores asignados a esta zona." : "Sin vendedores activos asignados."}
                      </div>
                    </div>
                  </div>
                  <div className="px-3 py-1 text-xs rounded-full bg-slate-900 text-slate-50">
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
                        className="flex flex-wrap items-center justify-between gap-2 p-2 border rounded-xl bg-white/80 border-slate-200/60"
                      >
                        <span className="text-sm font-medium text-slate-700">
                          {v.alias || v.owner || v.phone}
                          {v.phone ? <span className="text-xs text-slate-400"> · {v.phone}</span> : null}
                        </span>

                        <div className="flex items-center gap-2">
                          <span
                            className={`px-2 py-1 text-[11px] rounded-full flex items-center gap-1 ${online
                                ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                : "bg-rose-50 text-rose-700 border border-rose-200"
                              }`}
                            title={
                              u?.lastSeen
                                ? `Visto: ${new Date(tsToMs(u.lastSeen)).toLocaleString()}`
                                : undefined
                            }
                          >
                            <span className={`w-2 h-2 rounded-full ${online ? "bg-emerald-500" : "bg-rose-500"}`} />
                            {online ? "Online" : "Offline"}
                          </span>

                          <button
                            className="px-3 py-1 text-xs font-medium bg-white border rounded-lg shadow-sm border-slate-200 hover:bg-slate-50"
                            onClick={() => {
                              setSelectedVendorUid(uid);
                              setTab("vendorDetail");
                            }}
                          >
                            Ver detalle →
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </section>

        {/* Tabs */}
        <nav className="p-2 border shadow-lg rounded-2xl bg-white/90 backdrop-blur-md">
          <div className="flex flex-wrap gap-2">
            {[
              { key: "numbers", label: "📱 Números" },
              { key: "dashboard", label: "📊 Dashboard" },
              { key: "templates", label: "📝 Plantillas" },
              { key: "labels", label: "🏷️ Etiquetas" },
              { key: "tasks", label: "✅ Tareas" },
            ].map(({ key, label }) => (
              <button
                key={key}
                className={`px-5 py-2.5 rounded-2xl text-sm font-medium transition-all duration-200 ${tab === key
                    ? "text-white shadow-lg shadow-blue-500/25 bg-gradient-to-r from-blue-600 to-indigo-600"
                    : "text-slate-700 bg-white/0 hover:bg-slate-100 hover:shadow-sm"
                  }`}
                onClick={() => setTab(key)}
              >
                {label}
              </button>
            ))}
          </div>
        </nav>

        {/* Contenido por pestaña */}
        {tab === "numbers" && <AdminVendors />}
        {tab === "templates" && <TemplatesPanel />}
        {tab === "labels" && <LabelsAdmin />}

        {tab === "dashboard" && (
          <div className="space-y-8">
            {loading && (
              <div className="flex flex-col items-center justify-center gap-3 py-12">
                <div className="w-10 h-10 border-2 border-transparent rounded-full border-b-blue-600 animate-spin" />
                <span className="text-sm font-medium text-slate-600">Cargando datos del dashboard…</span>
              </div>
            )}

            {!loading && (
              <>
                {/* Filtros */}
                <section className="p-6 space-y-6 border shadow-lg rounded-2xl bg-white/95 backdrop-blur-md">
                  <div className="flex flex-wrap items-end gap-4">
                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-slate-700">Período</label>
                      <select
                        className="px-4 py-2 text-sm transition-all border rounded-xl border-slate-200 bg-white/80 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
                            className="px-4 py-2 text-sm transition-all border rounded-xl border-slate-200 bg-white/80 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            value={from}
                            onChange={(e) => setFrom(e.target.value)}
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-semibold text-slate-700">Hasta</label>
                          <input
                            type="date"
                            className="px-4 py-2 text-sm transition-all border rounded-xl border-slate-200 bg-white/80 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            value={to}
                            onChange={(e) => setTo(e.target.value)}
                          />
                        </div>
                      </>
                    )}

                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-slate-700">Zona</label>
                      <select
                        className="px-4 py-2 text-sm transition-all border rounded-xl border-slate-200 bg-white/80 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        value={zoneFilter}
                        onChange={(e) => setZoneFilter(e.target.value)}
                      >
                        {zonas.map((z) => (
                          <option key={z} value={z}>
                            {z}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="flex-1 min-w-[200px] space-y-2">
                      <label className="text-sm font-semibold text-slate-700">Buscar</label>
                      <input
                        type="text"
                        placeholder="Buscar por nombre o ID de conversación…"
                        className="w-full px-4 py-2 text-sm transition-all border rounded-xl border-slate-200 bg-white/80 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                      />
                    </div>

                    <div className="flex flex-wrap items-center gap-2 ml-auto">
                      <button
                        className="px-5 py-2 text-sm text-white transition shadow-md rounded-xl bg-gradient-to-r from-slate-600 to-slate-700 hover:from-slate-700 hover:to-slate-800"
                        onClick={() => {
                          setMode("today");
                          setZoneFilter("(todas)");
                          setLabelFilter([]);
                          setQ("");
                        }}
                        title="Resetea filtros y muestra solo HOY"
                      >
                        Hoy
                      </button>

                      <button
                        className="px-5 py-2 text-sm transition shadow-sm text-slate-800 rounded-xl bg-slate-100 hover:bg-slate-200"
                        onClick={() => {
                          setZoneFilter("(todas)");
                          setLabelFilter([]);
                          setQ("");
                          setMode("30");
                        }}
                      >
                        Limpiar filtros
                      </button>
                    </div>
                  </div>

                  {/* Filtro de etiquetas */}
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-slate-700">Etiquetas</label>
                      <select
                        multiple
                        className="min-h-[110px] w-full px-4 py-2 text-sm rounded-xl border border-slate-200 bg-white/80 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                        value={labelFilter}
                        onChange={(e) => {
                          const vals = Array.from(e.target.selectedOptions).map((o) => o.value);
                          setLabelFilter(vals);
                        }}
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
                        <div className="mt-1 text-xs text-slate-600">
                          Seleccionadas: {labelFilter.join(", ")}
                        </div>
                      )}
                    </div>

                    <div className="space-y-2 opacity-80">
                      <label className="text-sm font-semibold text-slate-700">Agentes</label>
                      <div className="px-4 py-3 text-sm border border-dashed rounded-xl bg-slate-50 text-slate-500">
                        El filtrado por vendedor/agente se hace en el detalle (VendorDetailPanel).
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-end text-xs text-slate-500">
                    Mostrando{" "}
                    <span className="mx-1 font-semibold text-slate-700">{convsFiltered.length}</span>
                    conversaciones en el rango seleccionado.
                  </div>
                </section>

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
                  data={seriePorDia.map((d) => ({ k: d.k, v: d.v }))}
                  formatter={(k) => k}
                  exportBtn={
                    <button
                      className="px-4 py-2 text-xs text-white shadow-lg sm:text-sm rounded-xl bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700"
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
                      className="px-4 py-2 text-xs text-white shadow-lg sm:text-sm rounded-xl bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700"
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
                      className="px-4 py-2 text-xs text-white shadow-lg sm:text-sm rounded-xl bg-gradient-to-r from-purple-500 to-purple-600 hover:from-purple-600 hover:to-purple-700"
                      onClick={doExportAgentes}
                    >
                      📊 Exportar CSV
                    </button>
                  }
                />

                {/* Ventas por vendedor */}
                <ListStatCard title="🛒 Ventas por vendedor" accent="#16a34a" data={ventasPorAgente} formatter={(k) => String(k)} />

                {/* Tabla de conversaciones */}
                <section className="p-6 space-y-4 border shadow rounded-2xl bg-white/95 backdrop-blur-md">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="flex items-center gap-2 text-xl font-bold text-slate-900">
                      <span>📚 Conversaciones</span>
                      <span className="px-2 py-0.5 text-[10px] rounded-full bg-slate-100 text-slate-500 border border-slate-200">
                        Vista detallada
                      </span>
                    </h3>
                    <div className="text-xs sm:text-sm text-slate-600">
                      Mostrando <span className="font-semibold">{convsPage.length}</span> de {totalItems} (pág. {pageClamped}/{totalPages})
                    </div>
                  </div>

                  {convsPage.length === 0 ? (
                    <div className="p-6 text-sm text-center border rounded-xl bg-slate-50 text-slate-500">
                      Sin resultados para los filtros actuales.
                    </div>
                  ) : (
                    <>
                      <div className="overflow-auto border rounded-xl">
                        <table className="table table-sm">
                          <thead className="bg-base-200/70">
                            <tr>
                              <th className="text-xs whitespace-nowrap">ID</th>
                              <th className="text-xs">Contacto</th>
                              <th className="text-xs">Asignado</th>
                              <th className="text-xs">Etiquetas</th>
                              <th className="text-xs whitespace-nowrap">Creada</th>
                              <th className="text-xs whitespace-nowrap">Último msj</th>
                            </tr>
                          </thead>
                          <tbody>
                            {convsPage.map((c) => (
                              <tr key={c.id} className="align-top hover">
                                <td className="font-mono text-[11px]">{c.id}</td>
                                <td>
                                  <div className="text-sm font-medium">{c.contact?.name || "—"}</div>
                                  <div className="text-xs text-slate-500">{c.contact?.phone || ""}</div>
                                </td>
                                <td className="text-xs sm:text-sm">{getAgentName(c)}</td>
                                <td className="text-xs sm:text-sm">
                                  {(Array.isArray(c.labels) ? c.labels : []).join(", ")}
                                </td>
                                <td className="text-[11px] text-slate-600 whitespace-nowrap">
                                  {tsToMs(c.createdAt) ? new Date(tsToMs(c.createdAt)).toLocaleString() : "—"}
                                </td>
                                <td className="text-[11px] text-slate-600 whitespace-nowrap">
                                  {tsToMs(c.lastMessageAt) ? new Date(tsToMs(c.lastMessageAt)).toLocaleString() : "—"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-3 mt-4">
                        <button
                          className="px-3 py-2 text-sm bg-white border rounded-lg hover:bg-slate-50 disabled:opacity-50"
                          disabled={pageClamped <= 1}
                          onClick={() => setPage((p) => Math.max(1, p - 1))}
                        >
                          ← Anterior
                        </button>
                        <div className="text-xs sm:text-sm text-slate-600">
                          Página {pageClamped} de {totalPages}
                        </div>
                        <button
                          className="px-3 py-2 text-sm bg-white border rounded-lg hover:bg-slate-50 disabled:opacity-50"
                          disabled={pageClamped >= totalPages}
                          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                        >
                          Siguiente →
                        </button>
                      </div>
                    </>
                  )}
                </section>

                {/* ✅ Conversaciones Hoy: se monta solo cuando estás en dashboard y ya cargó,
                    así evitás 2 cargas pesadas al entrar */}
                <div className="p-4 mt-4 border shadow-inner rounded-2xl bg-white/80">
                  <h3 className="flex items-center gap-2 mb-2 text-sm font-semibold text-slate-800">
                    <span>📆 Conversaciones de hoy (detalle rápido)</span>
                    <span className="px-2 py-0.5 text-[10px] rounded-full bg-slate-100 text-slate-500 border border-slate-200">
                      Embebido
                    </span>
                  </h3>
                  <ConversacionesHoy
                    collectionName="conversations"
                    adsConfig={{
                      phoneIds: ["768483333020913"],
                      labelsMatch: ["ads", "publicidad", "meta_ads"],
                      considerUTM: true,
                    }}
                    pageLimit={500}
                  />
                </div>
              </>
            )}
          </div>
        )}

        {tab === "tasks" && (
          <>
            <AdminAssignTask vendors={vendedoresActivos} />
            <TasksPanel />
          </>
        )}

        {/* Vista de detalle del vendedor */}
        {tab === "vendorDetail" && selectedVendorUid && (
          <VendorDetailPanel vendorUid={selectedVendorUid} onBack={() => setTab("dashboard")} />
        )}
      </div>
    </div>
  );
}
