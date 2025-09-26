// src/components/TasksPanel.jsx
import React, { useEffect,  useState } from "react";
import { db } from "../firebase";
import {
  addDoc, collection, deleteDoc, doc,  getDocs, orderBy, query, serverTimestamp,
  updateDoc
} from "firebase/firestore";
import { useAuthState } from "../hooks/useAuthState.js";

/**
 * Gestión de tareas sencillas para seguimiento de clientes.
 * Colección: tasks
 * Campos: { title, dueAt, note, contactId, conversationId, assignedToUid, assignedToName, done, createdAt, provinciaId }
 */
export default function TasksPanel({ provinciaId }) {
  const { user } = useAuthState();
  const [rows, setRows] = useState([]);
  const [filter, setFilter] = useState("pending"); // pending | mine | all | done

  const [form, setForm] = useState({
    title: "",
    dueAt: "",
    note: "",
    contactId: "",
    conversationId: "",
  });

  const load = async () => {
    const q = query(collection(db, "tasks"), orderBy("dueAt", "asc"));
    const snap = await getDocs(q);
    const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    setRows(list);
  };

  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!form.title || !form.dueAt) { alert("Faltan campos."); return; }
    const payload = {
      ...form,
      assignedToUid: user?.uid || "",
      assignedToName: user?.displayName || user?.email || "",
      done: false,
      createdAt: serverTimestamp(),
      provinciaId: provinciaId || null,
    };
    await addDoc(collection(db, "tasks"), payload);
    setForm({ title: "", dueAt: "", note: "", contactId: "", conversationId: "" });
    await load();
  };

  const toggleDone = async (t) => {
    await updateDoc(doc(db, "tasks", t.id), { done: !t.done });
    await load();
  };

  const remove = async (t) => {
    if (!confirm("¿Eliminar la tarea?")) return;
    await deleteDoc(doc(db, "tasks", t.id));
    await load();
  };

  const filtered = rows.filter(r => {
    if (filter === "done") return !!r.done;
    if (filter === "mine") return !r.done && r.assignedToUid === user?.uid;
    if (filter === "pending") return !r.done;
    return true;
  });

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-lg font-semibold">Tareas y recordatorios</h2>

      <div className="grid gap-2 md:grid-cols-5">
        <input className="input input-bordered" placeholder="Título"
          value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
        <input type="datetime-local" className="input input-bordered"
          value={form.dueAt} onChange={e => setForm(f => ({ ...f, dueAt: e.target.value }))} />
        <input className="input input-bordered" placeholder="Nota (opcional)"
          value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} />
        <input className="input input-bordered" placeholder="contactId (opcional)"
          value={form.contactId} onChange={e => setForm(f => ({ ...f, contactId: e.target.value }))} />
        <div className="flex gap-2">
          <button className="btn btn-primary" onClick={save}>Crear</button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-sm opacity-70">Ver:</span>
        <select className="select select-bordered select-sm" value={filter} onChange={e => setFilter(e.target.value)}>
          <option value="pending">Pendientes</option>
          <option value="mine">Mías</option>
          <option value="all">Todas</option>
          <option value="done">Resueltas</option>
        </select>
      </div>

      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Hecha</th><th>Título</th><th>Vence</th><th>Asignada</th><th>Notas</th><th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(t => (
              <tr key={t.id}>
                <td>
                  <input type="checkbox" className="checkbox checkbox-sm" checked={!!t.done} onChange={() => toggleDone(t)} />
                </td>
                <td>{t.title}</td>
                <td>{t.dueAt ? new Date(t.dueAt).toLocaleString() : "-"}</td>
                <td>{t.assignedToName || "-"}</td>
                <td className="max-w-[400px] whitespace-pre-wrap">{t.note || ""}</td>
                <td>
                  <button className="btn btn-ghost btn-xs" onClick={() => remove(t)}>Eliminar</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
