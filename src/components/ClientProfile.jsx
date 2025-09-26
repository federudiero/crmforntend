// src/components/ClientProfile.jsx
import React, { useEffect, useMemo, useState } from "react";
import { db } from "../firebase";
import {
  collection, doc, getDoc, getDocs, limit, orderBy, query,
  setDoc, updateDoc, serverTimestamp
} from "firebase/firestore";
import { PRESET_LABELS } from "../lib/labels";
import { useAuthState } from "../hooks/useAuthState.js";

export default function ClientProfile({ contactId: propContactId, conversationId, phone }) {
  const { user } = useAuthState();
  const isAdmin =
    !!user?.email &&
    ["federudiero@gmail.com", "fede_rudiero@gmail.com"].includes(user.email);

  const [assignedToMe, setAssignedToMe] = useState(false);

  // Fallback robusto: usa contactId > phone > conversationId
  const contactId = useMemo(
    () => String(propContactId || phone || conversationId || ""),
    [propContactId, phone, conversationId]
  );

  const [contact, setContact] = useState(null);
  const [contactExists, setContactExists] = useState(false); // ⬅️ nuevo
  const [labels, setLabels] = useState([]);
  const [notes, setNotes] = useState("");
  const [msgs, setMsgs] = useState([]);

  // Cargar contacto
  useEffect(() => {
    (async () => {
      if (!contactId) return;
      try {
        const ref = doc(db, "contacts", String(contactId));
        const snap = await getDoc(ref);
        setContactExists(snap.exists()); // ⬅️ nuevo
        if (snap.exists()) {
          const data = snap.data();
          setContact({ id: snap.id, ...data });
          setNotes(data.notes || "");
        } else {
          // shape mínimo local (NO se sube 'id')
          setContact({ id: contactId, name: "", phone: phone || "", email: "" });
        }
      } catch (e) {
        console.error("load contact error:", e);
      }
    })();
  }, [contactId, phone]);

  // Cargar últimos mensajes + etiquetas y determinar si está asignada a mí
  useEffect(() => {
    (async () => {
      if (!conversationId) return;
      try {
        const q = query(
          collection(db, "conversations", String(conversationId), "messages"),
          orderBy("timestamp", "desc"),
          limit(30)
        );
        const snap = await getDocs(q);
        const arr = snap.docs.map(d => ({ id: d.id, ...d.data() })).reverse();
        setMsgs(arr);

        const convRef = doc(db, "conversations", String(conversationId));
        const convSnap = await getDoc(convRef);
        if (convSnap.exists()) {
          const cdata = convSnap.data();
          setLabels(cdata.labels || []);
          setAssignedToMe(!!user?.uid && cdata.assignedToUid === user.uid);
        } else {
          setAssignedToMe(false);
        }
      } catch (e) {
        console.error("load conversation messages/labels error:", e);
      }
    })();
  }, [conversationId, user?.uid]);

  const allLabels = useMemo(() => PRESET_LABELS, []);

  // Puede editar: admin o vendedor asignado
  const canEdit = isAdmin || assignedToMe;
  const readOnly = !canEdit;

  const save = async () => {
    if (!contact?.id || !canEdit) return;
    try {
      const ref = doc(db, "contacts", String(contact.id));

      // 🔒 Solo campos permitidos por reglas
      const payload = {
        name: contact?.name || "",
        phone: contact?.phone || "",
        email: contact?.email || "",
        notes: notes || "",
        updatedAt: serverTimestamp(),
      };
      if (!contactExists) payload.createdAt = serverTimestamp();

      await setDoc(ref, payload, { merge: true });

      // Sincroniza etiquetas con la conversación (esto sí está permitido en /conversations)
      if (conversationId) {
        await updateDoc(doc(db, "conversations", String(conversationId)), { labels });
      }
      alert("Ficha guardada.");
      setContactExists(true);
    } catch (e) {
      alert("No se pudo guardar la ficha. " + (e?.message || ""));
    }
  };

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-lg font-semibold">Ficha del cliente</h2>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <label className="block text-sm">Nombre</label>
          <input
            className="w-full input input-bordered"
            value={contact?.name || ""}
            onChange={e => setContact(c => ({ ...(c||{}), name: e.target.value }))}
            disabled={readOnly}
          />

          <label className="block mt-2 text-sm">Teléfono</label>
          <input
            className="w-full input input-bordered"
            value={contact?.phone || ""}
            onChange={e => setContact(c => ({ ...(c||{}), phone: e.target.value }))}
            disabled={readOnly}
          />

          <label className="block mt-2 text-sm">Email</label>
          <input
            className="w-full input input-bordered"
            value={contact?.email || ""}
            onChange={e => setContact(c => ({ ...(c||{}), email: e.target.value }))}
            disabled={readOnly}
          />
        </div>

        <div>
          <label className="block text-sm">Etiquetas</label>
          <div className="flex flex-wrap gap-2 mt-1">
            {allLabels.map(l => {
              const on = labels.includes(l.slug);
              return (
                <button
                  key={l.slug}
                  type="button"
                  className={"badge " + (on ? ("badge-" + (l.color || "neutral")) : "badge-outline")}
                  onClick={() => {
                    setLabels(prev => on ? prev.filter(s => s !== l.slug) : [...prev, l.slug]);
                  }}
                >{l.name}</button>
              );
            })}
          </div>

          <label className="block mt-4 text-sm">Notas internas</label>
          <textarea
            className="textarea textarea-bordered w-full min-h-[100px]"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            disabled={readOnly}
          />
          {!canEdit && (
            <div className="mt-2 text-xs text-warning">
              Solo el administrador o el vendedor asignado pueden guardar cambios (reglas de Firestore).
            </div>
          )}
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <button className="btn btn-ghost" onClick={() => window.history.back()}>Volver</button>
        <button className="btn btn-primary" onClick={save} disabled={!canEdit}>Guardar</button>
      </div>

      <div className="divider">Últimos mensajes</div>
      <ul className="space-y-2">
        {msgs.map(m => (
          <li key={m.id} className="p-2 rounded bg-base-200">
            <div className="text-xs opacity-60">
              {new Date(m.timestamp?.toDate?.() || m.timestamp).toLocaleString()}
            </div>
            <div>{m.text || m.body || m.message || ""}</div>
          </li>
        ))}
        {!msgs.length && <div className="text-sm opacity-60">Sin mensajes…</div>}
      </ul>
    </div>
  );
}
