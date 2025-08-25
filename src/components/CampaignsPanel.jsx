// src/components/CampaignsPanel.jsx
import React, { useEffect,  useState } from "react";
import { db } from "../firebase";
import {
  addDoc, collection, doc, getDocs, orderBy, query, updateDoc
} from "firebase/firestore";
import { PRESET_LABELS } from "../lib/labels";

/**
 * Panel para crear campañas programadas y AB testing.
 * Crea documentos en `campaigns` que después un worker/servidor usa para enviar.
 */
export default function CampaignsPanel() {
  const [rows, setRows] = useState([]);

  const [form, setForm] = useState({
    name: "",
    scheduleAt: "",
    labelsAny: [], // segmentación por etiquetas
    province: "",  // opcional
    lastPurchaseDays: "", // opcional
    abEnabled: false,
    aTemplate: "",
    aVars: "",
    bTemplate: "",
    bVars: "",
    abSplit: 50,
  });

  const load = async () => {
    const q = query(collection(db, "campaigns"), orderBy("scheduleAt", "desc"));
    const snap = await getDocs(q);
    setRows(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  };
  useEffect(() => { load(); }, []);

  const toggleLabel = (slug) => {
    setForm(f => {
      const on = f.labelsAny.includes(slug);
      return { ...f, labelsAny: on ? f.labelsAny.filter(s => s !== slug) : [...f.labelsAny, slug] };
    });
  };

  const save = async () => {
    if (!form.name || !form.scheduleAt || !form.aTemplate) {
      alert("Completá nombre, horario y plantilla A.");
      return;
    }
    const payload = {
      ...form,
      status: "scheduled", // scheduled | running | done | error
      createdAt: new Date().toISOString(),
    };
    await addDoc(collection(db, "campaigns"), payload);
    setForm({
      name: "", scheduleAt: "", labelsAny: [], province: "", lastPurchaseDays: "",
      abEnabled: false, aTemplate: "", aVars: "", bTemplate: "", bVars: "", abSplit: 50
    });
    await load();
  };

  const cancel = async (c) => {
    if (!confirm("¿Cancelar la campaña?")) return;
    await updateDoc(doc(db, "campaigns", c.id), { status: "cancelled" });
    await load();
  };

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-lg font-semibold">Campañas programadas / AB Testing</h2>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <input className="w-full input input-bordered" placeholder="Nombre de la campaña"
            value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          <label className="text-sm">Fecha y hora (programación)</label>
          <input type="datetime-local" className="w-full input input-bordered"
            value={form.scheduleAt} onChange={e => setForm(f => ({ ...f, scheduleAt: e.target.value }))} />

          <div className="mt-2">
            <div className="mb-1 text-sm font-medium">Segmentación por etiquetas (OR)</div>
            <div className="flex flex-wrap gap-2">
              {PRESET_LABELS.map(l => {
                const on = form.labelsAny.includes(l.slug);
                return (
                  <button key={l.slug}
                    type="button"
                    className={"badge " + (on ? ("badge-" + (l.color || "neutral")) : "badge-outline")}
                    onClick={() => toggleLabel(l.slug)}
                  >
                    {l.name}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 mt-2">
            <input className="input input-bordered" placeholder="Provincia (opcional)"
              value={form.province} onChange={e => setForm(f => ({ ...f, province: e.target.value }))} />
            <input className="input input-bordered" placeholder="Última compra ≤ N días (opcional)"
              value={form.lastPurchaseDays} onChange={e => setForm(f => ({ ...f, lastPurchaseDays: e.target.value }))} />
          </div>

          <div className="mt-3 form-control">
            <label className="cursor-pointer label">
              <span className="label-text">Activar A/B Testing</span>
              <input type="checkbox" className="toggle" checked={form.abEnabled}
                onChange={e => setForm(f => ({ ...f, abEnabled: e.target.checked }))} />
            </label>
          </div>
        </div>

        <div className="space-y-2">
          <div className="p-3 rounded bg-base-200">
            <div className="font-medium">Variante A</div>
            <input className="w-full mt-1 input input-bordered" placeholder="Nombre plantilla A"
              value={form.aTemplate} onChange={e => setForm(f => ({ ...f, aTemplate: e.target.value }))} />
            <textarea className="w-full mt-1 textarea textarea-bordered" placeholder='Variables (JSON), ej: ["Fede"]'
              value={form.aVars} onChange={e => setForm(f => ({ ...f, aVars: e.target.value }))} />
          </div>

          <div className={"p-3 rounded " + (form.abEnabled ? "bg-base-200" : "bg-base-300 opacity-60 pointer-events-none")}>
            <div className="font-medium">Variante B</div>
            <input className="w-full mt-1 input input-bordered" placeholder="Nombre plantilla B"
              value={form.bTemplate} onChange={e => setForm(f => ({ ...f, bTemplate: e.target.value }))} />
            <textarea className="w-full mt-1 textarea textarea-bordered" placeholder='Variables (JSON)'
              value={form.bVars} onChange={e => setForm(f => ({ ...f, bVars: e.target.value }))} />
            <label className="mt-2 text-sm">Split (%) para A (resto va a B)</label>
            <input type="number" className="w-full input input-bordered"
              min={1} max={99} value={form.abSplit}
              onChange={e => setForm(f => ({ ...f, abSplit: Number(e.target.value || 50) }))} />
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <button className="btn btn-primary" onClick={save}>Guardar campaña</button>
      </div>

      <div className="divider">Programadas</div>
      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr><th>Nombre</th><th>Horario</th><th>Segmento</th><th>AB</th><th>Estado</th><th></th></tr>
          </thead>
          <tbody>
            {rows.map(c => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td>{c.scheduleAt}</td>
                <td>{(c.labelsAny || []).join(", ") || "(todos)"}</td>
                <td>{c.abEnabled ? `${c.abSplit}% / ${100-c.abSplit}%` : "—"}</td>
                <td>{c.status || "-"}</td>
                <td>
                  <button className="btn btn-ghost btn-xs" onClick={() => cancel(c)}>Cancelar</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
