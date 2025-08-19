// src/components/NewConversation.jsx
import React, { useEffect, useState } from "react";
import { sendMessage } from "../services/api";
import { db } from "../firebase";
import { collection, getDocs, query, where } from "firebase/firestore";

export default function NewConversation({ onOpen }) {
  const [to, setTo] = useState("+549");
  const [text, setText] = useState("Hola");
  const [loading, setLoading] = useState(false);

  const [senders, setSenders] = useState([]);
  const [selectedSender, setSelectedSender] = useState("");

  useEffect(function () {
    var mounted = true;
    (async function loadSenders() {
      try {
        const qRef = query(collection(db, "wabaNumbers"), where("active", "==", true));
        const snap = await getDocs(qRef);
        const rows = snap.docs
          .map(function (d) {
            const data = d.data();
            return { id: d.id, ...data };
          })
          .sort(function (a, b) {
            var byZone = (a.zone || "").localeCompare(b.zone || "");
            if (byZone !== 0) return byZone;
            return (a.alias || "").localeCompare(b.alias || "");
          });

        if (mounted) {
          setSenders(rows);
          setSelectedSender(function (prev) {
            return prev || (rows[0] && rows[0].waPhoneId) || "";
          });
        }
      } catch (err) {
        console.error(err);
      }
    })();
    return function () {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function makeSenderLabel(s) {
    var prefix = s.zone ? "[" + s.zone + "] " : "";
    var main = s.alias || s.phone;
    return prefix + main + " - " + s.phone;
  }

  function renderSenderOptions() {
    if (senders.length === 0) {
      return <option value="">(Sin emisores activos)</option>;
    }
    return senders.map(function (s) {
      return (
        <option key={s.id} value={s.waPhoneId || ""}>
          {makeSenderLabel(s)}
        </option>
      );
    });
  }

  async function create() {
    const phone = (to || "").trim();
    if (!phone || loading) return;
    setLoading(true);
    try {
      const payload = { to: phone, text: text };
      if (selectedSender) payload.fromWaPhoneId = selectedSender;

      const r = await sendMessage(payload);
      const convId =
        r && r.results && r.results[0] && r.results[0].to
          ? r.results[0].to
          : phone;

      if (onOpen) onOpen(convId);
      setText("");
    } catch (err) {
      alert((err && err.message) || "No se pudo crear");
    } finally {
      setLoading(false);
    }
  }

  function onKeyDown(e) {
    if (e.key === "Enter" && !loading) create();
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        className="p-1 border rounded"
        title="Enviar desde"
        value={selectedSender}
        onChange={function (e) {
          setSelectedSender(e.target.value);
        }}
      >
        {renderSenderOptions()}
      </select>

      <input
        className="p-1 border rounded w-36"
        placeholder="+549..."
        value={to}
        onChange={function (e) {
          setTo(e.target.value);
        }}
        onKeyDown={onKeyDown}
      />

      <input
        className="p-1 border rounded w-52"
        placeholder="Mensaje inicial"
        value={text}
        onChange={function (e) {
          setText(e.target.value);
        }}
        onKeyDown={onKeyDown}
      />

      <button
        disabled={loading}
        onClick={create}
        className="px-2 py-1 text-sm text-white bg-black rounded"
      >
        {loading ? "Enviando..." : "Nueva"}
      </button>
    </div>
  );
}