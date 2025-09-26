// src/components/NewConversation.jsx
import React, { useEffect, useState, useRef } from "react";
import { sendMessage } from "../services/api";
import { db } from "../firebase";
import { collection, getDocs, query, where } from "firebase/firestore";
import { useAuthState } from "../hooks/useAuthState.js";

export default function NewConversation({ onOpen }) {
  const { user } = useAuthState();

  // ---- estado original (se mantiene la lógica) ----
  const [to, setTo] = useState("+549");
  const [text, setText] = useState("Hola");
  const [loading, setLoading] = useState(false);

  const [senders, setSenders] = useState([]);
  const [selectedSender, setSelectedSender] = useState("");

  // ---- modal state ----
  const [open, setOpen] = useState(false);
  const dialogRef = useRef(null);

  // Cargar emisores (igual que antes)
  useEffect(() => {
    let cancelled = false;
    async function loadSenders() {
      try {
        if (!user?.uid) {
          setSenders([]); setSelectedSender(""); return;
        }
        let rows = [];

        const qAllowed = query(
          collection(db, "wabaNumbers"),
          where("active", "==", true),
          where("allowedUids", "array-contains", user.uid)
        );
        const snapAllowed = await getDocs(qAllowed);
        snapAllowed.forEach(d => rows.push({ id: d.id, ...d.data() }));

        const qOwner = query(
          collection(db, "wabaNumbers"),
          where("active", "==", true),
          where("ownerUid", "==", user.uid)
        );
        const snapOwner = await getDocs(qOwner);
        snapOwner.forEach(d => rows.push({ id: d.id, ...d.data() }));

        const seen = {};
        rows = rows.filter(r => (seen[r.id] ? false : (seen[r.id] = true)));
        rows.sort((a, b) => (a.phone || "").localeCompare(b.phone || ""));

        if (cancelled) return;
        setSenders(rows);
        setSelectedSender(prev => (prev ? prev : (rows[0]?.waPhoneId || "")));
      } catch (err) {
        console.error("loadSenders error:", err);
        if (!cancelled) { setSenders([]); setSelectedSender(""); }
      }
    }
    loadSenders();
    return () => { cancelled = true; };
  }, [user?.uid]);

  function renderSenderOptions() {
    if (senders.length === 0) return <option value="">(Sin emisores asignados)</option>;
    return senders.map(s => (
      <option key={s.id} value={s.waPhoneId || ""}>
        {s.phone || "(sin número)"}
      </option>
    ));
  }

  async function create() {
    const phone = (to || "").trim();
    if (!phone || loading) return;

    if (!selectedSender) { alert("No tenés un emisor asignado para enviar."); return; }
    if (!phone.startsWith("+")) { alert("Usá formato internacional (ej: +54911...)."); return; }

    setLoading(true);
    try {
      const payload = { to: phone, text, fromWaPhoneId: selectedSender };
      const r = await sendMessage(payload);
      const convId = r?.results?.[0]?.to ? r.results[0].to : phone;

      // éxito → abrir conv y cerrar modal
      onOpen?.(convId);
      setText("Hola");
      setTo("+549");
      setOpen(false);
    } catch (err) {
      console.error(err);
      alert(err?.message || "No se pudo crear");
    } finally {
      setLoading(false);
    }
  }

  function onKeyDown(e) {
    if (e.key === "Enter" && !loading) create();
  }

  // accesibilidad: cerrar con ESC y clic fuera
  useEffect(() => {
    function onEsc(e) { if (e.key === "Escape") setOpen(false); }
    if (open) window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [open]);

  const noSender = senders.length === 0 || !selectedSender;
  const singleSender = senders.length === 1;
  const singleSenderPhone = singleSender ? (senders[0].phone || "") : "";

  return (
    <>
      {/* Botón que abre el modal */}
      <button
        type="button"
        className="btn btn-primary btn-sm"
        onClick={() => setOpen(true)}
        title="Crear conversación"
      >
        Nueva
      </button>

      {/* Modal (full-screen en mobile, centrado en desktop) */}
      {open && (
        <div
          ref={dialogRef}
          className="fixed inset-0 z-[10000] flex items-end md:items-center justify-center"
          role="dialog"
          aria-modal="true"
          onMouseDown={(e) => {
            // cerrar si clic fuera de la tarjeta
            if (e.target === dialogRef.current) setOpen(false);
          }}
        >
          {/* overlay */}
          <div className="absolute inset-0 bg-black/50" />

          {/* card */}
          <div className="
            relative w-full md:w-[560px] bg-base-100 md:rounded-2xl
            shadow-xl border border-base-300
            max-h-[95vh] overflow-auto
            md:mb-0 mb-0
            md:translate-y-0 translate-y-0
            md:p-6 p-4
            ">
            {/* header */}
            <div className="flex items-center justify-between gap-2 mb-3">
              <h3 className="text-lg font-semibold">Nueva conversación</h3>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setOpen(false)}
                title="Cerrar"
              >
                ✕
              </button>
            </div>

            {/* formulario: grid apilada en xs, 2 columnas en md */}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {/* Emisor */}
              {singleSender ? (
                <label className="form-control">
                  <span className="mb-1 label-text">Vendedor</span>
                  <input
                    className="pointer-events-none input input-bordered input-sm bg-base-200"
                    value={singleSenderPhone}
                    readOnly
                    tabIndex={-1}
                    aria-label="Emisor (único)"
                  />
                </label>
              ) : (
                <label className="form-control">
                  <span className="mb-1 label-text">Vendedor</span>
                  <select
                    className="select select-bordered select-sm"
                    title="Enviar desde (emisor)"
                    aria-label="Seleccionar emisor"
                    value={selectedSender}
                    onChange={(e) => setSelectedSender(e.target.value)}
                    disabled={senders.length <= 1}
                  >
                    {renderSenderOptions()}
                  </select>
                </label>
              )}

              {/* Cliente */}
              <label className="form-control">
                <span className="mb-1 label-text">Cliente</span>
                <input
                  className="input input-bordered input-sm"
                  placeholder="+549..."
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  onKeyDown={onKeyDown}
                  inputMode="tel"
                  aria-label="Número del cliente"
                />
              </label>

              {/* Mensaje (ocupa toda la fila en md) */}
              <label className="form-control md:col-span-2">
                <span className="mb-1 label-text">Mensaje</span>
                <textarea
                  className="h-24 textarea textarea-bordered"
                  placeholder="Mensaje inicial"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => (e.key === "Enter" && e.ctrlKey) && create()}
                  aria-label="Mensaje inicial"
                />
                <span className="mt-1 text-xs opacity-70">
                  Enter envía • Ctrl+Enter también
                </span>
              </label>
            </div>

            {/* acciones */}
            <div className="flex flex-col justify-end gap-2 mt-4 md:flex-row">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setOpen(false)}
              >
                Cancelar
              </button>
              <button
                disabled={loading || noSender}
                onClick={create}
                className="btn btn-primary"
                type="button"
                title={noSender ? "Sin emisor asignado" : "Crear conversación"}
                aria-label="Crear conversación"
              >
                {loading ? "Enviando..." : "Enviar y abrir chat"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
