// src/components/AdminPanel.jsx
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { auth, db } from "../firebase";
import {
  addDoc,
  collection,
  getDocs,
  doc,
  onSnapshot,
  Timestamp,
  serverTimestamp,
  query,
  where,
  documentId,
  orderBy,
  limit,
  startAfter,
  getCountFromServer,
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
function MiniStatCard({ title, value, tone = "primary" }) {
  const toneMap = {
    primary: "var(--color-primary)",
    secondary: "var(--color-secondary)",
    accent: "var(--color-accent)",
    success: "var(--color-success)",
    warning: "var(--color-warning)",
    error: "var(--color-error)",
    neutral: "var(--color-neutral)",
  };

  return (
    <div className="p-4 border border-base-300 shadow-lg rounded-2xl bg-base-100">
      <div className="text-[11px] font-semibold tracking-[0.08em] uppercase text-base-content/60">
        {title}
      </div>
      <div
        className="mt-3 text-3xl font-extrabold leading-none tabular-nums"
        style={{ color: toneMap[tone] || toneMap.primary }}
      >
        {value}
      </div>
    </div>
  );
}

function ListStatCard({
  title,
  data,
  accent = "var(--color-primary)",
  exportBtn,
  formatter = (k) => k,
}) {
  return (
    <section className="p-6 space-y-4 border border-base-300 shadow-lg rounded-2xl bg-base-100">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-base-content">{title}</h3>
          <p className="mt-1 text-xs text-base-content/60">
            Vista resumida. Ideal para detectar patrones rápidos.
          </p>
        </div>
        <div className="flex items-center gap-2">{exportBtn}</div>
      </div>

      {data.length === 0 ? (
        <div className="p-6 text-sm text-center border border-dashed border-base-300 rounded-xl bg-base-200 text-base-content/60">
          Sin datos en el período seleccionado.
        </div>
      ) : (
        <div className="max-h-[360px] overflow-y-auto pr-1">
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {data.map((d, i) => (
              <div
                key={i}
                className="p-4 transition-colors border border-base-300 shadow-sm rounded-xl bg-base-100 hover:bg-base-200"
                title={`${formatter(d.k)}: ${d.v}`}
              >
                <div
                  className="mb-1 text-3xl font-extrabold tracking-tight tabular-nums"
                  style={{ color: accent }}
                >
                  {d.v}
                </div>
                <div className="text-xs font-medium tracking-wide uppercase text-base-content/60">
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

function uniqMergeById(prev, next) {
  const map = new Map();
  for (const x of prev || []) map.set(x.id, x);
  for (const x of next || []) map.set(x.id, x);
  return Array.from(map.values());
}

function yieldToUI() {
  return new Promise((res) => {
    if (typeof requestIdleCallback !== "undefined")
      requestIdleCallback(() => res(), { timeout: 250 });
    else setTimeout(res, 0);
  });
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
    if (hm && /^\d{2}:\d{2}$/.test(hm)) [H, M] = hm.split(":").map(Number);
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
    <section className="p-6 mb-6 border shadow-lg rounded-2xl bg-base-100 border-base-300">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h3 className="flex items-center gap-2 mb-1 text-lg font-semibold text-base-content">
            <span
              className="inline-flex items-center justify-center text-xs rounded-full w-7 h-7"
              style={{ background: "var(--color-primary)", color: "var(--color-primary-content)" }}
            >
              🗓️
            </span>
            Asignar tarea a un agente
          </h3>
          <p className="text-xs text-base-content/60">
            Las tareas se muestran automáticamente en la Agenda del vendedor correspondiente.
          </p>
        </div>

        <span className="hidden badge badge-outline md:inline-flex">Agenda interna</span>
      </div>

      <form onSubmit={handleCreate} className="grid gap-3 p-3 md:grid-cols-12 bg-base-200 rounded-2xl">
        <select
          className="select select-bordered bg-base-100 text-base-content md:col-span-3"
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
          className="input input-bordered bg-base-100 text-base-content placeholder:text-base-content/50 md:col-span-3"
          placeholder="Título de la tarea"
          value={form.titulo}
          onChange={(e) => setForm((f) => ({ ...f, titulo: e.target.value }))}
          required
        />

        <input
          type="date"
          className="input input-bordered bg-base-100 text-base-content md:col-span-2"
          value={form.fecha}
          onChange={(e) => setForm((f) => ({ ...f, fecha: e.target.value }))}
          required
        />
        <input
          type="time"
          className="input input-bordered bg-base-100 text-base-content md:col-span-2"
          value={form.hora}
          onChange={(e) => setForm((f) => ({ ...f, hora: e.target.value }))}
        />

        <input
          className="input input-bordered bg-base-100 text-base-content placeholder:text-base-content/50 md:col-span-12"
          placeholder="Nota (opcional)"
          value={form.nota}
          onChange={(e) => setForm((f) => ({ ...f, nota: e.target.value }))}
        />

        <div className="flex items-center justify-between gap-2 md:col-span-12">
          <button disabled={saving} className="btn btn-primary">
            {saving ? "Creando…" : "Crear tarea"}
          </button>
          <span className="text-[11px] text-base-content/60">
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
  const [loadingFull, setLoadingFull] = useState(false);
  const [loadedAll, setLoadedAll] = useState(false);
  const [rangeCount, setRangeCount] = useState(null);

  const [convs, setConvs] = useState([]);
  const deferredConvs = useDeferredValue(convs);

  const [vendors, setVendors] = useState([]);
  const [usersByUid, setUsersByUid] = useState({});

  // Contacts (cache incremental)
  const [contactsById, setContactsById] = useState({});
  const contactsByIdRef = useRef({});
  useEffect(() => {
    contactsByIdRef.current = contactsById;
  }, [contactsById]);

  // Cache de conversaciones por rango (para volver atrás instantáneo)
  const convCacheRef = useRef(new Map());

  /* ============================================================
     ✅ NUEVO: Métrica seleccionable para que el dashboard coincida
     con ConversacionesHoy:
       - lastInboundAt (Activas)
       - firstInboundAt (Nuevas)
       - lastMessageAt (Actividad total in/out)
     ============================================================ */

  // 🔁 DEFAULT PARA COINCIDIR CON "Activas" de ConversacionesHoy:
  const [timeField, setTimeField] = useState("lastInboundAt");
  // Si querés mantener el default anterior, usá:
  // const [timeField, setTimeField] = useState("lastMessageAt");

  const CONV_TIME_FIELD = timeField;

  // Modo por campo (Timestamp vs Number) — evita “clavarse” cuando cambiás de métrica
  const timeModeByFieldRef = useRef({});
  const getFieldMode = (field) => timeModeByFieldRef.current?.[field] || "timestamp";
  const setFieldMode = (field, mode) => {
    timeModeByFieldRef.current[field] = mode;
  };

  const timeFieldMeta = useMemo(() => {
    if (CONV_TIME_FIELD === "lastMessageAt") {
      return {
        label: "Actividad (in/out)",
        shortCol: "Último msj",
        hint: "Cuenta actividad total (cliente + vendedor). Campo: lastMessageAt",
      };
    }
    if (CONV_TIME_FIELD === "lastInboundAt") {
      return {
        label: "Inbound (cliente)",
        shortCol: "Último inbound",
        hint: "Cuenta solo cuando el cliente escribió. Campo: lastInboundAt",
      };
    }
    if (CONV_TIME_FIELD === "firstInboundAt") {
      return {
        label: "Nuevas (primer inbound)",
        shortCol: "Primer inbound",
        hint: "Cuenta nuevas por primer mensaje del cliente. Campo: firstInboundAt",
      };
    }
    return { label: CONV_TIME_FIELD, shortCol: "Tiempo", hint: `Campo: ${CONV_TIME_FIELD}` };
  }, [CONV_TIME_FIELD]);

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

  // ✅ Presencia users: SUSCRIBIR SOLO a UIDs de vendedores (en chunks de 10)
  useEffect(() => {
    const uids = Array.from(
      new Set(
        (vendors || [])
          .map((v) => v.ownerUid || v.userUid || v.uid || v.id)
          .filter(Boolean)
      )
    );

    if (!uids.length) return;

    const unsubs = [];
    for (const part of chunk(uids, 10)) {
      const qs = query(collection(db, "users"), where(documentId(), "in", part));
      const unsub = onSnapshot(
        qs,
        (snap) => {
          setUsersByUid((prev) => {
            const next = { ...prev };
            snap.forEach((d) => (next[d.id] = d.data()));
            return next;
          });
        },
        (err) => console.error("users presence snapshot error:", err)
      );
      unsubs.push(unsub);
    }
    return () => {
      for (const u of unsubs) {
        try {
          u && u();
        } catch { }
      }
    };
  }, [vendors]);

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

  // Derivados de rango
  const range = useMemo(() => {
    const a = +startOfDayTZ(parseLocalYMD(from));
    const b = +endOfDayTZ(parseLocalYMD(to));
    return [a, b];
  }, [from, to]);

  const rangeKey = useMemo(
    () => `${from}__${to}__${CONV_TIME_FIELD}`,
    [from, to, CONV_TIME_FIELD]
  );

  async function buildConvQueryBounds(startMs, endMs, afterDoc, lim, mode, field) {
    const col = collection(db, "conversations");
    const startDate = new Date(startMs);
    const endDate = new Date(endMs);

    if (mode === "timestamp") {
      const qs = query(
        col,
        where(field, ">=", Timestamp.fromDate(startDate)),
        where(field, "<=", Timestamp.fromDate(endDate)),
        orderBy(field, "desc"),
        ...(afterDoc ? [startAfter(afterDoc)] : []),
        ...(lim ? [limit(lim)] : [])
      );
      return qs;
    }

    // mode === "number"
    const qs = query(
      col,
      where(field, ">=", startMs),
      where(field, "<=", endMs),
      orderBy(field, "desc"),
      ...(afterDoc ? [startAfter(afterDoc)] : []),
      ...(lim ? [limit(lim)] : [])
    );
    return qs;
  }

  async function fetchConvPage(startMs, endMs, afterDoc, lim) {
    const field = CONV_TIME_FIELD;

    const tryMode = async (mode) => {
      const qs = await buildConvQueryBounds(startMs, endMs, afterDoc, lim, mode, field);
      const snap = await getDocs(qs);
      const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const last = snap.docs[snap.docs.length - 1] || null;
      return { items, last, empty: snap.empty };
    };

    const current = getFieldMode(field);
    try {
      return await tryMode(current);
    } catch (e) {
      const msg = String(e?.message || "");
      const code = String(e?.code || "");
      const shouldFallback =
        code.includes("invalid-argument") ||
        code.includes("failed-precondition") ||
        msg.toLowerCase().includes("timestamp") ||
        msg.toLowerCase().includes("expected") ||
        msg.toLowerCase().includes("type") ||
        msg.toLowerCase().includes("order by");

      if (shouldFallback) {
        // ✅ fallback en ambos sentidos
        const nextMode = current === "timestamp" ? "number" : "timestamp";
        setFieldMode(field, nextMode);
        return await tryMode(nextMode);
      }
      throw e;
    }
  }

  async function fetchRangeCount(startMs, endMs) {
    const col = collection(db, "conversations");
    const field = CONV_TIME_FIELD;
    const mode = getFieldMode(field);

    const tryCount = async (m) => {
      const qs =
        m === "timestamp"
          ? query(
            col,
            where(field, ">=", Timestamp.fromDate(new Date(startMs))),
            where(field, "<=", Timestamp.fromDate(new Date(endMs)))
          )
          : query(col, where(field, ">=", startMs), where(field, "<=", endMs));

      const snap = await getCountFromServer(qs);
      return snap.data().count;
    };

    try {
      return await tryCount(mode);
    } catch (e) {
      const nextMode = mode === "timestamp" ? "number" : "timestamp";
      setFieldMode(field, nextMode);
      return await tryCount(nextMode);
    }
  }

  async function ensureContacts(ids, { max = 60 } = {}) {
    const contactsMap = contactsByIdRef.current || {};
    const missing = (ids || []).filter((id) => id && !contactsMap[id]).slice(0, max);
    if (!missing.length) return;

    const patch = {};
    for (const part of chunk(missing, 10)) {
      const qs = query(collection(db, "contacts"), where(documentId(), "in", part));
      const snap = await getDocs(qs);
      snap.forEach((cd) => (patch[cd.id] = cd.data()));
      await yieldToUI();
    }

    if (Object.keys(patch).length) {
      setContactsById((prev) => ({ ...prev, ...patch }));
    }
  }

  // ✅ Cargar conversaciones: SERVER FILTER + PROGRESIVO
  useEffect(() => {
    if (tab !== "dashboard") return;

    let cancelled = false;

    const PAGE_SIZE = 450; // páginas para completar el rango
    const FAST_LIMIT = 250; // primer paint rápido (1 día)
    const MAX_PER_RANGE = 6000; // guardrail (mes enorme)

    (async () => {
      setLoading(true);
      setLoadingFull(false);
      setLoadedAll(false);
      setRangeCount(null);

      const [a, b] = range;

      // 1) si ya lo tenés cacheado, pintá instantáneo
      const cached = convCacheRef.current.get(rangeKey);
      if (cached?.items?.length) {
        setConvs(cached.items);
        setLoading(false);
        setLoadingFull(!cached.loadedAll);
        setLoadedAll(!!cached.loadedAll);

        // igual refrescamos conteo (barato) por si cambió algo
        try {
          const cnt = await fetchRangeCount(a, b);
          if (!cancelled) setRangeCount(cnt);
        } catch (e) {
          console.warn("count failed:", e?.code, e?.message);
        }
      }

      // 2) conteo rápido (para que KPI “Total” sea real aunque aún no cargaste todo)
      try {
        const cnt = await fetchRangeCount(a, b);
        if (!cancelled) setRangeCount(cnt);
      } catch (e) {
        console.warn("count failed:", e?.code, e?.message);
      }

      // 3) carga progresiva: si el rango es > 1 día => primero el día “to”
      const daysInRange = Math.floor((b - a) / 86400000) + 1;
      const fastStart = +startOfDayTZ(parseLocalYMD(to));
      const fastEnd = +endOfDayTZ(parseLocalYMD(to));

      try {
        if (!cached?.items?.length) {
          if (daysInRange > 1) {
            const fast = await fetchConvPage(fastStart, fastEnd, null, FAST_LIMIT);
            if (cancelled) return;
            setConvs(fast.items);
            convCacheRef.current.set(rangeKey, { items: fast.items, loadedAll: false, last: null });
            setLoading(false);

            // contactos visibles rápido
            ensureContacts(fast.items.map((c) => c.id), { max: 40 }).catch(() => { });
          } else {
            // rango 1 día => directo
            setLoading(false);
          }
        }

        // 4) completar todo el rango “por debajo”
        setLoadingFull(true);

        let after = null;
        let totalFetched = 0;
        let merged = (convCacheRef.current.get(rangeKey)?.items || []).slice();

        while (!cancelled) {
          const page = await fetchConvPage(a, b, after, PAGE_SIZE);
          if (cancelled) return;

          if (!page.items.length) break;

          totalFetched += page.items.length;
          merged = uniqMergeById(merged, page.items);

          setConvs(merged);
          convCacheRef.current.set(rangeKey, { items: merged, loadedAll: false, last: page.last });

          after = page.last;

          // prefetechá contactos a ritmo suave (no spamear)
          ensureContacts(page.items.map((c) => c.id), { max: 25 }).catch(() => { });

          if (totalFetched >= MAX_PER_RANGE) {
            console.warn("Guardrail: se alcanzó MAX_PER_RANGE, cortando carga para evitar freeze.");
            break;
          }

          await yieldToUI();
        }

        if (!cancelled) {
          setLoadingFull(false);
          setLoadedAll(true);
          convCacheRef.current.set(rangeKey, { items: merged, loadedAll: true, last: after });
        }
      } catch (e) {
        console.error("progressive load failed:", e);
        if (!cancelled) {
          setLoading(false);
          setLoadingFull(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tab, rangeKey, range, to]);

  // Resetea paginado al cambiar filtros (sin refetch)
  useEffect(() => {
    setPage(1);
  }, [mode, from, to, zoneFilter, labelFilter, q, CONV_TIME_FIELD]);

  // Index por zona / nombre de vendors
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

  const getContact = (c) => contactsByIdRef.current?.[c.id] || c.contact || null;

  const getAgentName = (c) => {
    const uid = c.assignedToUid || "";
    const u = usersByUid[uid];
    const userName = u?.alias || u?.displayName || u?.name || "";
    const vendorName = vendorNameByUid[uid] || "";
    const assignedName = cleanAgentLabel(c.assignedToName || "");
    const name = userName || vendorName || assignedName;
    return name || (uid ? uid : "Sin asignar");
  };

  // FILTROS CLIENTE (ya viene por rango desde server, esto es extra: zona/labels/buscar)
  const convsByZone = useMemo(() => {
    if (zoneFilter === "(todas)") return deferredConvs;
    const idx = vendorIndexByZone.get(zoneFilter);
    if (!idx) return [];
    return deferredConvs.filter((c) => {
      const uid = c.assignedToUid || "";
      const name = c.assignedToName || "";
      const zone = c.assignedZone || "";
      if (zone && zone.toLowerCase() === zoneFilter.toLowerCase()) return true;
      if (uid && idx.uids.has(uid)) return true;
      if (name && idx.names.has(name)) return true;
      return false;
    });
  }, [deferredConvs, zoneFilter, vendorIndexByZone]);

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
      const name = String(getContact(c)?.name || "").toLowerCase();
      const phone = String(getContact(c)?.phone || "").toLowerCase();
      return id.includes(s) || name.includes(s) || phone.includes(s);
    });
  }, [convsByLabel, q]);

  // Paginado
  const totalItems = convsFiltered.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const pageClamped = Math.min(page, totalPages);
  const sliceStart = (pageClamped - 1) * pageSize;
  const sliceEnd = sliceStart + pageSize;
  const convsPage = convsFiltered.slice(sliceStart, sliceEnd);

  // Traé contactos SOLO de la página visible (instantáneo en UI)
  useEffect(() => {
    if (!convsPage.length) return;
    ensureContacts(convsPage.map((c) => c.id), { max: 30 }).catch(() => { });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convsPage.map((c) => c.id).join("|")]);

  // KPIs (van mejorando a medida que llega data)
  const kpis = useMemo(() => {
    const total = rangeCount ?? convsFiltered.length; // si hay count, es el real del rango
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
  }, [convsFiltered, usersByUid, vendorNameByUid, rangeCount]);

  const seriePorDia = useMemo(() => {
    const [a, b] = range;
    const map = new Map();
    for (let t = a; t <= b; t += 86400000) map.set(ymdTZ(new Date(t)), 0);

    for (const c of convsFiltered) {
      const t = tsToMs(c[CONV_TIME_FIELD]) || tsToMs(c.createdAt);
      const key = ymdTZ(new Date(t));
      if (map.has(key)) map.set(key, (map.get(key) || 0) + 1);
    }
    return Array.from(map.entries()).map(([k, v]) => ({ k, v }));
  }, [convsFiltered, range, CONV_TIME_FIELD]);

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
    <div className="min-h-screen bg-base-200 text-base-content">
      <div className="px-4 py-6 mx-auto space-y-8 max-w-7xl sm:px-6 lg:px-8">
        {/* Header */}
        <header className="relative overflow-hidden border shadow-xl rounded-3xl bg-base-100 border-base-300">
          <div
            className="absolute inset-0 opacity-15"
            style={{
              backgroundImage:
                "radial-gradient(circle at top, var(--color-primary), transparent 55%), radial-gradient(circle at bottom, var(--color-secondary), transparent 55%)",
            }}
          />
          <div className="relative flex flex-col gap-4 px-6 py-6 sm:px-10 sm:py-8 md:flex-row md:items-center md:justify-between">
            <div className="space-y-2">
              <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl text-base-content">
                Panel de Administración
              </h1>
              <p className="max-w-xl text-sm sm:text-base text-base-content/60">
                Vista central para controlar conversaciones, vendedores, plantillas, etiquetas y tareas del equipo.
              </p>
            </div>

            <div className="flex flex-col items-start gap-2 text-xs md:items-end text-base-content/60">
              <span className="inline-flex items-center gap-2 px-3 py-1 border rounded-full bg-base-200 border-base-300">
                <span className="w-2 h-2 rounded-full" style={{ background: "var(--color-success)" }} />
                Monitoreo en tiempo real
              </span>
              <span className="hidden md:block">
                Rango actual:{" "}
                <span className="font-semibold text-base-content">
                  {from} → {to}
                </span>{" "}
                <span className="badge badge-outline ml-2" title={timeFieldMeta.hint}>
                  {timeFieldMeta.label}
                </span>
              </span>
            </div>
          </div>
        </header>

        {/* Vendedores por zona (resumen) */}
        <section className="p-6 space-y-4 border shadow-lg rounded-2xl bg-base-100 border-base-300">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="mb-1 text-xl font-bold text-base-content">🌍 Vendedores activos por zona</h3>
              <p className="text-sm text-base-content/60">
                Mapa rápido de cobertura de cada zona y presencia online de los vendedores.
              </p>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {Object.entries(vendedoresPorZonaFiltrado).map(([zona, arr]) => (
              <div
                key={zona}
                className="p-4 space-y-3 border shadow-sm rounded-2xl bg-base-200 border-base-300"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className="inline-flex items-center justify-center w-8 h-8 text-sm font-semibold rounded-full"
                      style={{
                        background: "var(--color-primary)",
                        color: "var(--color-primary-content)",
                      }}
                    >
                      {zona.charAt(0).toUpperCase()}
                    </span>
                    <div>
                      <div className="font-semibold text-base-content">{zona}</div>
                      <div className="text-xs text-base-content/60">
                        {arr.length > 0
                          ? "Vendedores asignados a esta zona."
                          : "Sin vendedores activos asignados."}
                      </div>
                    </div>
                  </div>

                  <span className="badge badge-neutral">{arr.length} vendedor(es)</span>
                </div>

                <ul className="space-y-2">
                  {arr.map((v) => {
                    const uid = v.ownerUid || v.userUid || v.uid || v.id;
                    const u = usersByUid[uid];
                    const online = calcOnline(u);

                    return (
                      <li
                        key={v.id}
                        className="flex flex-wrap items-center justify-between gap-2 p-2 border rounded-xl bg-base-100 border-base-300"
                      >
                        <span className="text-sm font-medium text-base-content">
                          {v.alias || v.owner || v.phone}
                          {v.phone ? <span className="text-xs text-base-content/60"> · {v.phone}</span> : null}
                        </span>

                        <div className="flex items-center gap-2">
                          <span
                            className={`badge badge-sm ${online ? "badge-success" : "badge-error"}`}
                            title={
                              u?.lastSeen
                                ? `Visto: ${new Date(tsToMs(u.lastSeen)).toLocaleString()}`
                                : undefined
                            }
                          >
                            {online ? "Online" : "Offline"}
                          </span>

                          <button
                            className="btn btn-sm btn-ghost"
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
        <nav className="p-2 border shadow-lg rounded-2xl bg-base-100 border-base-300">
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
                className={`btn btn-sm rounded-2xl ${tab === key ? "btn-primary" : "btn-ghost"}`}
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
            {(loading || loadingFull) && (
              <div className="flex flex-col items-center justify-center gap-3 py-6">
                <span className="loading loading-spinner loading-md" />
                <span className="text-sm font-medium text-base-content/70">
                  {loading ? "Cargando rápido…" : "Completando rango en segundo plano…"}
                </span>
                {!loadedAll && (
                  <span className="text-xs text-base-content/60">
                    Tip: ya podés usar el panel; el resto llega “por debajo”.
                  </span>
                )}
              </div>
            )}

            {!loading && (
              <>
                {/* Filtros */}
                <section className="p-6 space-y-6 border shadow-lg rounded-2xl bg-base-100 border-base-300">
                  <div className="flex flex-wrap items-end gap-4">
                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-base-content/80">Período</label>
                      <select
                        className="select select-bordered bg-base-100 text-base-content"
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

                    {/* ✅ NUEVO: selector de métrica */}
                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-base-content/80">
                        Métrica
                        <span className="ml-2 badge badge-outline" title={timeFieldMeta.hint}>
                          {timeFieldMeta.label}
                        </span>
                      </label>
                      <select
                        className="select select-bordered bg-base-100 text-base-content"
                        value={CONV_TIME_FIELD}
                        onChange={(e) => setTimeField(e.target.value)}
                        title="Define qué campo de tiempo se usa para contar/filtrar el dashboard"
                      >
                        <option value="lastInboundAt">Inbound (cliente) — lastInboundAt</option>
                        <option value="lastMessageAt">Actividad (in/out) — lastMessageAt</option>
                        <option value="firstInboundAt">Nuevas (primer inbound) — firstInboundAt</option>
                      </select>
                    </div>

                    {mode === "custom" && (
                      <>
                        <div className="space-y-2">
                          <label className="text-sm font-semibold text-base-content/80">Desde</label>
                          <input
                            type="date"
                            className="input input-bordered bg-base-100 text-base-content"
                            value={from}
                            onChange={(e) => setFrom(e.target.value)}
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-semibold text-base-content/80">Hasta</label>
                          <input
                            type="date"
                            className="input input-bordered bg-base-100 text-base-content"
                            value={to}
                            onChange={(e) => setTo(e.target.value)}
                          />
                        </div>
                      </>
                    )}

                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-base-content/80">Zona</label>
                      <select
                        className="select select-bordered bg-base-100 text-base-content"
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
                      <label className="text-sm font-semibold text-base-content/80">Buscar</label>
                      <input
                        type="text"
                        placeholder="Buscar por nombre o ID de conversación…"
                        className="input input-bordered bg-base-100 text-base-content placeholder:text-base-content/50 w-full"
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                      />
                    </div>

                    <div className="flex flex-wrap items-center gap-2 ml-auto">
                      <button
                        className="btn btn-primary"
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
                        className="btn btn-ghost"
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
                      <label className="text-sm font-semibold text-base-content/80">Etiquetas</label>
                      <select
                        multiple
                        className="select select-bordered bg-base-100 text-base-content min-h-[110px] w-full"
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
                        <div className="mt-1 text-xs text-base-content/70">
                          Seleccionadas: {labelFilter.join(", ")}
                        </div>
                      )}
                    </div>

                    <div className="space-y-2 opacity-80">
                      <label className="text-sm font-semibold text-base-content/80">Agentes</label>
                      <div className="px-4 py-3 text-sm border border-dashed rounded-xl bg-base-200 border-base-300 text-base-content/60">
                        El filtrado por vendedor/agente se hace en el detalle (VendorDetailPanel).
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-end text-xs text-base-content/60">
                    Mostrando{" "}
                    <span className="mx-1 font-semibold text-base-content">{convsFiltered.length}</span>
                    conversaciones (cargadas) — total real estimado:{" "}
                    <span className="mx-1 font-semibold text-base-content">
                      {rangeCount == null ? "…" : rangeCount}
                    </span>{" "}
                    <span className="badge badge-outline ml-2" title={timeFieldMeta.hint}>
                      {timeFieldMeta.label}
                    </span>
                  </div>
                </section>

                {/* KPIs principales */}
                <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
                  <MiniStatCard
                    title={`Total conversaciones (${timeFieldMeta.label})`}
                    value={kpis.total}
                    tone="primary"
                  />
                  <MiniStatCard title="Sin asignar" value={kpis.sinAsignar} tone="warning" />
                  <MiniStatCard
                    title="Zonas activas"
                    value={Object.keys(vendedoresPorZona).length}
                    tone="success"
                  />
                  <MiniStatCard title="Vendedores activos" value={vendedoresActivos.length} tone="secondary" />
                  <MiniStatCard title="Vendedores en esta zona" value={vendedoresEnZona} tone="accent" />
                </div>

                {/* Conversaciones por día */}
                <ListStatCard
                  title={`📈 Conversaciones por día — ${timeFieldMeta.label}`}
                  accent="var(--color-primary)"
                  data={seriePorDia.map((d) => ({ k: d.k, v: d.v }))}
                  formatter={(k) => k}
                  exportBtn={
                    <button className="btn btn-primary btn-sm" onClick={doExportPorDia}>
                      📊 Exportar CSV
                    </button>
                  }
                />

                {/* Top etiquetas */}
                <ListStatCard
                  title="🏷️ Top etiquetas"
                  accent="var(--color-success)"
                  data={etiquetasData}
                  formatter={(k) => k}
                  exportBtn={
                    <button className="btn btn-success btn-sm" onClick={doExportEtiquetas}>
                      📊 Exportar CSV
                    </button>
                  }
                />

                {/* Distribución por agente */}
                <ListStatCard
                  title="👥 Conversaciones por agente"
                  accent="var(--color-secondary)"
                  data={agentesData}
                  formatter={(k) => String(k).replace(/\s*\([^)]*\)\s*$/, "")}
                  exportBtn={
                    <button className="btn btn-secondary btn-sm" onClick={doExportAgentes}>
                      📊 Exportar CSV
                    </button>
                  }
                />

                {/* Ventas por vendedor */}
                <ListStatCard
                  title="🛒 Ventas por vendedor"
                  accent="var(--color-success)"
                  data={ventasPorAgente}
                  formatter={(k) => String(k)}
                />

                {/* Tabla de conversaciones */}
                <section className="p-6 space-y-4 border shadow rounded-2xl bg-base-100 border-base-300">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="flex items-center gap-2 text-xl font-bold text-base-content">
                      <span>📚 Conversaciones</span>
                      <span className="badge badge-outline">Vista detallada</span>
                    </h3>
                    <div className="text-xs sm:text-sm text-base-content/70">
                      Mostrando <span className="font-semibold">{convsPage.length}</span> de {totalItems} (pág.{" "}
                      {pageClamped}/{totalPages})
                    </div>
                  </div>

                  {convsPage.length === 0 ? (
                    <div className="p-6 text-sm text-center border rounded-xl bg-base-200 border-base-300 text-base-content/60">
                      Sin resultados para los filtros actuales.
                    </div>
                  ) : (
                    <>
                      <div className="overflow-auto border rounded-xl bg-base-100 border-base-300">
                        <table className="table table-sm">
                          <thead className="bg-base-200/70">
                            <tr>
                              <th className="text-xs whitespace-nowrap">ID</th>
                              <th className="text-xs">Contacto</th>
                              <th className="text-xs">Asignado</th>
                              <th className="text-xs">Etiquetas</th>
                              <th className="text-xs whitespace-nowrap">Creada</th>
                              <th className="text-xs whitespace-nowrap" title={timeFieldMeta.hint}>
                                {timeFieldMeta.shortCol}
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {convsPage.map((c) => {
                              const contact = getContact(c);

                              const createdMs = tsToMs(c.createdAt);
                              const metricMs = tsToMs(c[CONV_TIME_FIELD]);
                              const activityMs = tsToMs(c.lastMessageAt);

                              return (
                                <tr key={c.id} className="align-top hover">
                                  <td className="font-mono text-[11px]">{c.id}</td>
                                  <td>
                                    <div className="text-sm font-medium">{contact?.name || "—"}</div>
                                    <div className="text-xs text-base-content/60">{contact?.phone || ""}</div>
                                  </td>
                                  <td className="text-xs sm:text-sm">{getAgentName(c)}</td>
                                  <td className="text-xs sm:text-sm">
                                    {(Array.isArray(c.labels) ? c.labels : []).join(", ")}
                                  </td>
                                  <td className="text-[11px] text-base-content/70 whitespace-nowrap">
                                    {createdMs ? new Date(createdMs).toLocaleString() : "—"}
                                  </td>

                                  <td className="text-[11px] text-base-content/70 whitespace-nowrap">
                                    {metricMs ? new Date(metricMs).toLocaleString() : "—"}
                                    {/* si la métrica NO es lastMessageAt, muestro igual la actividad total como ayuda */}
                                    {CONV_TIME_FIELD !== "lastMessageAt" && activityMs ? (
                                      <div className="text-[10px] text-base-content/50">
                                        Act.: {new Date(activityMs).toLocaleString()}
                                      </div>
                                    ) : null}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-3 mt-4">
                        <button
                          className="btn btn-ghost btn-sm"
                          disabled={pageClamped <= 1}
                          onClick={() => setPage((p) => Math.max(1, p - 1))}
                        >
                          ← Anterior
                        </button>
                        <div className="text-xs sm:text-sm text-base-content/70">
                          Página {pageClamped} de {totalPages}
                        </div>
                        <button
                          className="btn btn-ghost btn-sm"
                          disabled={pageClamped >= totalPages}
                          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                        >
                          Siguiente →
                        </button>
                      </div>
                    </>
                  )}
                </section>

                {/* Conversaciones Hoy */}
                <div className="p-4 mt-4 border shadow-inner rounded-2xl bg-base-100 border-base-300">
                  <h3 className="flex items-center gap-2 mb-2 text-sm font-semibold text-base-content">
                    <span>📆 Conversaciones de hoy (detalle rápido)</span>
                    <span className="badge badge-outline">Embebido</span>
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