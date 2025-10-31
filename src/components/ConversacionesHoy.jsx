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

function startEndOfDayInLocalTZ(date) {
  const y = date.getFullYear();
  const m = date.getMonth();
  const d = date.getDate();
  const start = new Date(y, m, d, 0, 0, 0, 0);
  const end = new Date(y, m, d, 23, 59, 59, 999);
  return { start, end };
}

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
  pageLimit = 200, // fetch máximo por día
}) {
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [{ start, end }, setRange] = useState(() =>
    startEndOfDayInLocalTZ(new Date()),
  );

  const [loading, setLoading] = useState(true);
  const [nuevasHoy, setNuevasHoy] = useState([]);
  const [activasHoy, setActivasHoy] = useState([]);
  const [modo, setModo] = useState("nuevas"); // "nuevas" | "activas"
  const [search, setSearch] = useState("");

  // 🔸 Paginado cliente fijo en 10 por página
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10; // ⬅️ fijo en 10

  useEffect(() => {
    setRange(startEndOfDayInLocalTZ(selectedDate));
  }, [selectedDate]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      try {
        const colRef = collection(db, collectionName);

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
          .reduce((acc, x) => (acc.some((y) => y.id === x.id) ? acc : [...acc, x]), []);

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
  }, [collectionName, start, end, pageLimit]);

  // Reset page al cambiar filtros
  useEffect(() => {
    setCurrentPage(1);
  }, [modo, selectedDate, search]);

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

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(rows.length / pageSize)),
    [rows.length, pageSize],
  );

  const pagedRows = useMemo(() => {
    const startIdx = (currentPage - 1) * pageSize;
    return rows.slice(startIdx, startIdx + pageSize);
  }, [rows, currentPage, pageSize]);

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
      (modo === "nuevas" ? "nuevas_" : "activas_") +
      format(selectedDate, "yyyy-MM-dd") +
      ".csv";
    a.href = url;
    a.download = fname;
    a.click();
    URL.revokeObjectURL(url);
  }

  const dateStr = format(selectedDate, "yyyy-MM-dd");

  // Helpers paginación
  const goToPage = (p) => setCurrentPage(Math.min(Math.max(1, p), totalPages));
  const Pagination = () => {
    // 10 botones numerados visibles
    const windowSize = 10;
    const half = Math.floor(windowSize / 2);

    let startP = Math.max(1, currentPage - half);
    let endP = Math.min(totalPages, startP + windowSize - 1);
    if (endP - startP + 1 < windowSize) {
      startP = Math.max(1, endP - windowSize + 1);
    }

    const pages = [];
    for (let p = startP; p <= endP; p++) pages.push(p);

    return (
      <div className="join">
        <button
          className="join-item btn btn-xs"
          onClick={() => goToPage(currentPage - 1)}
          disabled={currentPage <= 1}
        >
          «
        </button>

        {startP > 1 && (
          <>
            <button className="join-item btn btn-xs" onClick={() => goToPage(1)}>
              1
            </button>
            {startP > 2 && <button className="join-item btn btn-xs btn-ghost">…</button>}
          </>
        )}

        {pages.map((p) => (
          <button
            key={p}
            className={`join-item btn btn-xs ${p === currentPage ? "btn-primary" : ""}`}
            onClick={() => goToPage(p)}
          >
            {p}
          </button>
        ))}

        {endP < totalPages && (
          <>
            {endP < totalPages - 1 && <button className="join-item btn btn-xs btn-ghost">…</button>}
            <button className="join-item btn btn-xs" onClick={() => goToPage(totalPages)}>
              {totalPages}
            </button>
          </>
        )}

        <button
          className="join-item btn btn-xs"
          onClick={() => goToPage(currentPage + 1)}
          disabled={currentPage >= totalPages}
        >
          »
        </button>
      </div>
    );
  };

  return (
    <div className="w-full space-y-6">
      {/* HEADER */}
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-bold tracking-tight md:text-3xl">
          Conversaciones del día
        </h2>
        <p className="text-sm opacity-70">
          {dateStr} • <b>Nuevas</b> usa <code>firstInboundAt</code> (fallback{" "}
          <code>createdAt</code>). <b>Activas</b> usa <code>lastInboundAt</code>.
        </p>
      </div>

      {/* CONTROLES + ACCIONES */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Modo */}
        <div className="border shadow-sm card bg-base-100 border-base-300">
          <div className="p-4 card-body">
            <div className="flex items-center justify-between">
              <span className="font-medium">Vista</span>
              <div className="join">
                <button
                  className={`btn btn-sm join-item ${
                    modo === "nuevas" ? "btn-primary" : "btn-ghost"
                  }`}
                  onClick={() => setModo("nuevas")}
                >
                  Nuevas
                </button>
                <button
                  className={`btn btn-sm join-item ${
                    modo === "activas" ? "btn-primary" : "btn-ghost"
                  }`}
                  onClick={() => setModo("activas")}
                >
                  Activas
                </button>
              </div>
            </div>
            <p className="mt-2 text-xs opacity-70">
              Cambiá entre conversaciones <b>Nuevas</b> y <b>Activas</b> del día.
            </p>
          </div>
        </div>

        {/* Fecha */}
        <div className="border shadow-sm card bg-base-100 border-base-300">
          <div className="p-4 card-body">
            <label className="mb-2 text-sm font-medium">Fecha</label>
            <input
              type="date"
              className="w-full input input-sm input-bordered"
              value={format(selectedDate, "yyyy-MM-dd")}
              onChange={(e) => setSelectedDate(new Date(e.target.value))}
            />
            <p className="mt-2 text-xs opacity-70">
              Mostrando resultados de <b>{dateStr}</b>.
            </p>
          </div>
        </div>

        {/* Buscar + Exportar */}
        <div className="border shadow-sm card bg-base-100 border-base-300">
          <div className="p-4 card-body">
            <label className="mb-2 text-sm font-medium">Buscar</label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                className="w-full input input-sm input-bordered"
                placeholder="Número, texto, vendedor…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <button className="btn btn-sm btn-outline" onClick={handleExport} title="Exportar CSV">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 3a1 1 0 011 1v8.586l2.293-2.293a1 1 0 011.414 1.414l-4.001 4a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L11 12.586V4a1 1 0 011-1z" />
                  <path d="M5 20a2 2 0 01-2-2v-2a1 1 0 112 0v2h14v-2a1 1 0 112 0v2a2 2 0 01-2 2H5z" />
                </svg>
                <span className="hidden ml-1 sm:inline">CSV</span>
              </button>
            </div>
            {/* pageSize fijo en 10: no se muestra selector */}
          </div>
        </div>
      </div>

      {/* STATS */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="border shadow stats bg-base-100 border-base-300">
          <div className="stat">
            <div className="stat-title">Total {modo === "nuevas" ? "Nuevas" : "Activas"}</div>
            <div className="stat-value text-primary">{counters.total}</div>
            <div className="stat-desc">Conversaciones listadas</div>
          </div>
        </div>
        <div className="border shadow stats bg-base-100 border-base-300">
          <div className="stat">
            <div className="stat-title">Únicos</div>
            <div className="stat-value">{counters.unicos}</div>
            <div className="stat-desc">Por contactId / id</div>
          </div>
        </div>
      </div>

      {/* TABLA */}
      <div className="border shadow-sm card bg-base-100 border-base-300">
        <div className="p-0 card-body">
          <div className="overflow-x-auto rounded-lg">
            <table className="table table-sm">
              <thead className="sticky top-0 z-10 bg-base-200/90 backdrop-blur supports-[backdrop-filter]:bg-base-200/60">
                <tr>
                  <th className="w-12">#</th>
                  <th className="min-w-[160px]">Número</th>
                  <th className="min-w-[160px]">Vendedor</th>
                  <th className="min-w-[120px]">1er Inbound</th>
                  <th className="min-w-[120px]">Created</th>
                  <th className="min-w-[120px]">Last Inbound</th>
                  <th className="min-w-[360px]">Último Texto</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={7} className="opacity-70">Cargando…</td>
                  </tr>
                )}
                {!loading && pagedRows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="opacity-70">Sin resultados para el día seleccionado.</td>
                  </tr>
                )}
                {!loading && pagedRows.map((c, i) => {
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
                    <tr key={c.id} className="hover">
                      <td>{(currentPage - 1) * pageSize + i + 1}</td>
                      <td className="font-mono">{c.contactId || "-"}</td>
                      <td>
                        {c.assignedToName ? (
                          <span className="badge badge-ghost">{c.assignedToName}</span>
                        ) : c.assignedToEmail ? (
                          <span className="badge badge-ghost">{c.assignedToEmail}</span>
                        ) : ("-")}
                      </td>
                      <td>{firstInboundStr}</td>
                      <td>{createdStr}</td>
                      <td>{inboundStr}</td>
                      <td className="max-w-[520px]">
                        <span className="line-clamp-1">{c.lastMessageText || "-"}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Footer tabla con paginación */}
          <div className="flex flex-col gap-3 p-3 text-xs border-t border-base-300 sm:flex-row sm:items-center sm:justify-between">
            <span className="opacity-70">
              Mostrando <b>{pagedRows.length}</b> de <b>{rows.length}</b> filas • Página <b>{currentPage}</b> de <b>{totalPages}</b> • {modo === "nuevas" ? "Nuevas" : "Activas"} del <b>{dateStr}</b>
            </span>
            <div className="flex items-center gap-3">
              <button className="btn btn-xs" onClick={() => goToPage(1)} disabled={currentPage === 1}>Primero</button>
              <button className="btn btn-xs" onClick={() => goToPage(currentPage - 1)} disabled={currentPage === 1}>Anterior</button>
              <Pagination />
              <button className="btn btn-xs" onClick={() => goToPage(currentPage + 1)} disabled={currentPage === totalPages}>Siguiente</button>
              <button className="btn btn-xs" onClick={() => goToPage(totalPages)} disabled={currentPage === totalPages}>Último</button>
              <button className="btn btn-xs btn-outline" onClick={handleExport}>Exportar CSV</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
