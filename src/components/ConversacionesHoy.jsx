// src/components/ConversacionesHoy.jsx
// Requiere: firebase v9 modular, date-fns
// npm i date-fns

import React, { useEffect, useMemo, useState } from "react";
import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  Timestamp,
  where,
} from "firebase/firestore";
import { db } from "../firebase.js"; // 👈 ajustá la ruta a tu proyecto
import { format } from "date-fns";

function startEndOfTodayInLocalTZ() {
  // AR (-03:00) usando hora local del navegador
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  const start = new Date(y, m, d, 0, 0, 0, 0);
  const end = new Date(y, m, d, 23, 59, 59, 999);
  return { start, end };
}

// Date -> Firestore Timestamp
const ts = (date) => Timestamp.fromDate(date);

function toCSV(rows) {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  const head = cols.join(",");
  const body = rows
    .map((r) =>
      cols
        .map((c) => {
          const v = r[c] ?? "";
          const s =
            typeof v === "string"
              ? v.replace(/"/g, '""').replace(/\n/g, " ").trim()
              : String(v);
          return `"${s}"`;
        })
        .join(","),
    )
    .join("\n");
  return head + "\n" + body;
}

export default function ConversacionesHoy({
  collectionName = "conversations",
  pageLimit = 200, // subí si hace falta
}) {
  const [{ start, end }] = useState(() => startEndOfTodayInLocalTZ());
  const [loading, setLoading] = useState(true);
  const [nuevasHoy, setNuevasHoy] = useState([]);  // firstInboundAt/createdAt hoy
  const [activasHoy, setActivasHoy] = useState([]); // lastInboundAt hoy
  const [modo, setModo] = useState("nuevas"); // "nuevas" | "activas"
  const [search, setSearch] = useState("");

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      try {
        const colRef = collection(db, collectionName);

        // 1) NUEVAS de hoy = firstInboundAt en [start, end]
        //    Fallback: createdAt en [start, end] (históricos que aún no tienen firstInboundAt)
        const qNuevasPrimeraVez = query(
          colRef,
          where("firstInboundAt", ">=", ts(start)),
          where("firstInboundAt", "<=", ts(end)),
          orderBy("firstInboundAt", "desc"),
          limit(pageLimit),
        );
        const qNuevasFallback = query(
          colRef,
          where("createdAt", ">=", ts(start)),
          where("createdAt", "<=", ts(end)),
          orderBy("createdAt", "desc"),
          limit(pageLimit),
        );

        const [snapN1, snapN2] = await Promise.all([
          getDocs(qNuevasPrimeraVez),
          getDocs(qNuevasFallback),
        ]);

        const arrN = [...snapN1.docs, ...snapN2.docs]
          .map((d) => ({ id: d.id, ...d.data() }))
          // dedupe por id si vino en ambas consultas
          .reduce((acc, x) => (acc.some((y) => y.id === x.id) ? acc : [...acc, x]), []);

        // 2) ACTIVAS de hoy = lastInboundAt en [start, end]
        const qActivas = query(
          colRef,
          where("lastInboundAt", ">=", ts(start)),
          where("lastInboundAt", "<=", ts(end)),
          orderBy("lastInboundAt", "desc"),
          limit(pageLimit),
        );
        const snapA = await getDocs(qActivas);
        const arrA = snapA.docs.map((d) => ({ id: d.id, ...d.data() }));

        if (!mounted) return;
        setNuevasHoy(arrN);
        setActivasHoy(arrA);
      } catch (err) {
        console.error("ConversacionesHoy error:", err);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collectionName]);

  const rows = useMemo(() => {
    const base = modo === "nuevas" ? nuevasHoy : activasHoy;

    const q = search.trim().toLowerCase();
    const afterSearch = q
      ? base.filter((c) => {
          const fields = [
            c.contactId,
            c.lastMessageText,
            c.assignedToName,
            c.assignedToEmail,
          ]
            .filter(Boolean)
            .map((x) => String(x).toLowerCase());
          return fields.some((f) => f.includes(q));
        })
      : base;

    // Orden: nuevas => firstInboundAt/createdAt desc, activas => lastInboundAt desc
    const sorted = [...afterSearch].sort((a, b) => {
      const fa =
        modo === "nuevas"
          ? (a.firstInboundAt?.toMillis?.() || a.createdAt?.toMillis?.() || 0)
          : (a.lastInboundAt?.toMillis?.() || 0);
      const fb =
        modo === "nuevas"
          ? (b.firstInboundAt?.toMillis?.() || b.createdAt?.toMillis?.() || 0)
          : (b.lastInboundAt?.toMillis?.() || 0);
      return fb - fa;
    });

    return sorted;
  }, [modo, nuevasHoy, activasHoy, search]);

  const counters = useMemo(() => {
    const uniques = new Set(rows.map((r) => r.contactId || r.id));
    return {
      total: rows.length,
      unicos: uniques.size,
    };
  }, [rows]);

  function handleExport() {
    const compact = rows.map((r) => ({
      id: r.id,
      contactId: r.contactId || "",
      firstInboundAt: r.firstInboundAt?.toDate
        ? format(r.firstInboundAt.toDate(), "yyyy-MM-dd HH:mm:ss")
        : "",
      createdAt: r.createdAt?.toDate
        ? format(r.createdAt.toDate(), "yyyy-MM-dd HH:mm:ss")
        : "",
      lastInboundAt: r.lastInboundAt?.toDate
        ? format(r.lastInboundAt.toDate(), "yyyy-MM-dd HH:mm:ss")
        : "",
      assignedToName: r.assignedToName || "",
      assignedToEmail: r.assignedToEmail || "",
      lastMessageText: r.lastMessageText || "",
    }));
    const csv = toCSV(compact);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const fname =
      (modo === "nuevas" ? "nuevas_hoy_" : "activas_hoy_") +
      format(new Date(), "yyyy-MM-dd") +
      ".csv";
    a.href = url;
    a.download = fname;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4 w-full">
      <div className="flex flex-wrap gap-2 items-center">
        <div className="text-lg font-semibold">
          Conversaciones de hoy ({format(new Date(), "yyyy-MM-dd")})
        </div>
        <div className="flex gap-2 items-center ml-auto">
          <select
            className="select select-bordered select-sm"
            value={modo}
            onChange={(e) => setModo(e.target.value)}
            title="Modo de vista"
          >
            <option value="nuevas">Nuevas hoy (firstInboundAt)</option>
            <option value="activas">Activas hoy (lastInboundAt)</option>
          </select>

          <input
            className="input input-bordered input-sm"
            placeholder="Buscar número, texto, vendedor…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: 260 }}
          />

          <button className="btn btn-sm" onClick={handleExport}>
            Exportar CSV
          </button>
        </div>
      </div>

      <div className="shadow stats">
        <div className="stat">
          <div className="stat-title">Total</div>
          <div className="stat-value text-primary">{counters.total}</div>
          <div className="stat-desc">
            Únicos: <b>{counters.unicos}</b>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-base-300">
        <table className="table table-zebra table-sm">
          <thead>
            <tr>
              <th>#</th>
              <th>Número</th>
              <th>Vendedor</th>
              <th>1er Inbound</th>
              <th>Created</th>
              <th>Last Inbound</th>
              <th>Último Texto</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={7} className="opacity-70">
                  Cargando…
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={7} className="opacity-70">
                  Sin resultados para hoy.
                </td>
              </tr>
            )}
            {!loading &&
              rows.map((c, i) => {
                const firstInboundStr = c.firstInboundAt?.toDate
                  ? format(c.firstInboundAt.toDate(), "HH:mm:ss")
                  : "-";
                const createdStr = c.createdAt?.toDate
                  ? format(c.createdAt.toDate(), "HH:mm:ss")
                  : "-";
                const inboundStr = c.lastInboundAt?.toDate
                  ? format(c.lastInboundAt.toDate(), "HH:mm:ss")
                  : "-";
                return (
                  <tr key={c.id}>
                    <td>{i + 1}</td>
                    <td className="font-mono">{c.contactId || "-"}</td>
                    <td>{c.assignedToName || c.assignedToEmail || "-"}</td>
                    <td>{firstInboundStr}</td>
                    <td>{createdStr}</td>
                    <td>{inboundStr}</td>
                    <td className="max-w-[360px] truncate">
                      {c.lastMessageText || "-"}
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      <p className="text-xs opacity-70">
        Nota: “Nuevas hoy” usa <code>firstInboundAt</code> (y cae a{" "}
        <code>createdAt</code> si el histórico no lo tiene). “Activas hoy” usa{" "}
        <code>lastInboundAt</code>.
      </p>
    </div>
  );
}
