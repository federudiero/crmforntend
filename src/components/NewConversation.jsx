// src/components/NewConversation.jsx
import React, { useEffect, useState } from "react";
import { sendMessage } from "../services/api";
import { db } from "../firebase";
import { collection, getDocs, query, where } from "firebase/firestore";
import { useAuthState } from "../hooks/useAuthState.js";

export default function NewConversation({ onOpen }) {
  const { user } = useAuthState();

  const [to, setTo] = useState("+549");
  const [text, setText] = useState("Hola");
  const [loading, setLoading] = useState(false);

  const [senders, setSenders] = useState([]);
  const [selectedSender, setSelectedSender] = useState("");

  // Carga emisores: allowedUids u ownerUid (dedup + orden por phone)
  useEffect(() => {
    let cancelled = false;

    async function loadSenders() {
      try {
        if (!user?.uid) {
          setSenders([]);
          setSelectedSender("");
          return;
        }

        let rows = [];

        // allowedUids me incluye
        const qAllowed = query(
          collection(db, "wabaNumbers"),
          where("active", "==", true),
          where("allowedUids", "array-contains", user.uid)
        );
        const snapAllowed = await getDocs(qAllowed);
        snapAllowed.forEach(d => rows.push({ id: d.id, ...d.data() }));

        // ownerUid soy yo
        const qOwner = query(
          collection(db, "wabaNumbers"),
          where("active", "==", true),
          where("ownerUid", "==", user.uid)
        );
        const snapOwner = await getDocs(qOwner);
        snapOwner.forEach(d => rows.push({ id: d.id, ...d.data() }));

        // dedup por id
        const seen = {};
        rows = rows.filter(r => (seen[r.id] ? false : (seen[r.id] = true)));

        // ordenar por phone
        rows.sort((a, b) => (a.phone || "").localeCompare(b.phone || ""));

        if (cancelled) return;

        setSenders(rows);
        setSelectedSender(prev => (prev ? prev : (rows[0]?.waPhoneId || "")));
      } catch (err) {
        console.error("loadSenders error:", err);
        if (!cancelled) {
          setSenders([]);
          setSelectedSender("");
        }
      }
    }

    loadSenders();
    return () => {
      cancelled = true;
    };
  }, [user?.uid]);

  // Render de opciones del select
  function renderSenderOptions() {
    if (senders.length === 0) {
      return <option value="">(Sin emisores asignados)</option>;
    }
    return senders.map(s => (
      <option key={s.id} value={s.waPhoneId || ""}>
        {s.phone || "(sin número)"}
      </option>
    ));
  }

  // Crear conversación
  async function create() {
    const phone = (to || "").trim();
    if (!phone || loading) return;

    if (!selectedSender) {
      alert("No tenés un emisor asignado para enviar.");
      return;
    }
    if (!phone.startsWith("+")) {
      alert("Usá formato internacional (ej: +54911...).");
      return;
    }

    setLoading(true);
    try {
      const payload = { to: phone, text, fromWaPhoneId: selectedSender };
      const r = await sendMessage(payload);
      const convId =
        r?.results?.[0]?.to ? r.results[0].to : phone;

      if (onOpen) onOpen(convId);
      setText("");
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

  const noSender = senders.length === 0 || !selectedSender;
  const singleSender = senders.length === 1;
  const singleSenderPhone = singleSender ? (senders[0].phone || "") : "";

  return (
    <div className="flex flex-wrap items-center gap-2 text-black">
      {/* Vendedor (emisor) */}
      {singleSender ? (
        <div className="join">
          <span className="pointer-events-none join-item btn btn-sm">Vendedor</span>
          <input
            className="w-48 pointer-events-none join-item input input-sm input-bordered bg-base-200 focus:outline-none"
            value={singleSenderPhone}
            readOnly
            tabIndex={-1}
            title="Único emisor asignado"
          />
        </div>
      ) : (
        <div className="join">
          <span className="pointer-events-none join-item btn btn-sm">Vendedor</span>
          <select
            className="join-item select select-sm select-bordered"
            title="Enviar desde (emisor)"
            value={selectedSender}
            onChange={e => setSelectedSender(e.target.value)}
            disabled={senders.length <= 1}
          >
            {renderSenderOptions()}
          </select>
        </div>
      )}

      {/* Cliente (destino) */}
      <div className="join">
        <span className="pointer-events-none join-item btn btn-sm">Cliente</span>
        <input
          className="w-40 join-item input input-sm input-bordered"
          placeholder="+549..."
          value={to}
          onChange={e => setTo(e.target.value)}
          onKeyDown={onKeyDown}
          title="Número del cliente (E.164)"
        />
      </div>

      {/* Mensaje inicial */}
      <div className="join">
        <span className="pointer-events-none join-item btn btn-sm">Mensaje</span>
        <input
          className="w-56 join-item input input-sm input-bordered"
          placeholder="Mensaje inicial"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={onKeyDown}
          title="Primer mensaje"
        />
      </div>

      {/* Acción */}
      <button
        disabled={loading || noSender}
        onClick={create}
        className="btn btn-sm btn-primary"
        type="button"
        title={noSender ? "Sin emisor asignado" : "Crear conversación"}
      >
        {loading ? "Enviando..." : "Nueva"}
      </button>
    </div>
  );
}
