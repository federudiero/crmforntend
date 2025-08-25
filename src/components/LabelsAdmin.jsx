// src/components/LabelsAdmin.jsx
import { useEffect, useMemo, useState } from "react";
import { listAllLabels, createLabel, updateLabel, deleteLabel } from "../lib/labels";

const COLORS = [
  "primary","secondary","accent","info","success","warning","error","neutral"
];

export default function LabelsAdmin() {
  const [items, setItems] = useState([]);
  const [q, setQ] = useState("");
  const [form, setForm] = useState({ name: "", slug: "", color: "neutral" });
  const [editing, setEditing] = useState(null);

  const load = async () => setItems(await listAllLabels());
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return items;
    return items.filter(i =>
      i.name.toLowerCase().includes(t) ||
      i.slug.toLowerCase().includes(t)
    );
  }, [items, q]);

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!form.slug.trim()) return alert("Slug requerido (único, sin espacios)");
    if (editing) {
      await updateLabel(editing.id, form);
    } else {
      await createLabel(form);
    }
    setForm({ name: "", slug: "", color: "neutral" });
    setEditing(null);
    load();
  };

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">Etiquetas</h2>

      <div className="flex items-center gap-2">
        <input className="input input-bordered w-72" placeholder="Buscar…" value={q} onChange={(e)=>setQ(e.target.value)} />
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Lista */}
        <div className="card bg-base-200">
          <div className="card-body">
            <div className="divide-y">
              {filtered.map(l => (
                <div key={l.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="flex items-center gap-3">
                    <div className={`badge badge-${l.color}`}>{l.name}</div>
                    <div className="text-xs opacity-60">/{l.slug}</div>
                  </div>
                  <div className="flex gap-2">
                    <button className="btn btn-sm" onClick={()=>{ setEditing(l); setForm({ name:l.name, slug:l.slug, color:l.color }); }}>Editar</button>
                    <button className="btn btn-sm btn-error" onClick={async()=>{
                      if (!confirm(`Eliminar etiqueta "${l.name}"?`)) return;
                      await deleteLabel(l.id);
                      load();
                    }}>Borrar</button>
                  </div>
                </div>
              ))}
              {!filtered.length && <div className="py-3 text-sm opacity-70">Sin etiquetas</div>}
            </div>
          </div>
        </div>

        {/* Editor */}
        <form onSubmit={onSubmit} className="card bg-base-200">
          <div className="gap-3 card-body">
            <h3 className="font-semibold">{editing ? "Editar etiqueta" : "Nueva etiqueta"}</h3>
            <input className="input input-bordered" placeholder="Nombre (visible)" value={form.name} onChange={(e)=>setForm(s=>({...s, name:e.target.value}))} required />
            <input className="input input-bordered" placeholder="Slug (único, sin espacios)" value={form.slug} onChange={(e)=>setForm(s=>({...s, slug:e.target.value.replace(/\s+/g,'-').toLowerCase()}))} required />
            <select className="select select-bordered" value={form.color} onChange={(e)=>setForm(s=>({...s, color:e.target.value}))}>
              {COLORS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <div className="flex gap-2">
              <button className="btn btn-primary" type="submit">{editing ? "Guardar" : "Crear"}</button>
              {editing && <button className="btn" type="button" onClick={()=>{ setEditing(null); setForm({ name:"", slug:"", color:"neutral" }); }}>Cancelar</button>}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
