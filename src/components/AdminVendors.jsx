// src/components/AdminVendors.jsx
import { useEffect, useMemo, useState } from "react";
import {
  collection,
  getDocs,
  addDoc,
  doc,
  updateDoc,
  deleteDoc,
  setDoc,
} from "firebase/firestore";
import { db } from "../firebase";

/** Normaliza a E.164 (+549...) */
function normPhone(s) {
  const v = String(s || "").trim();
  if (!v) return "";
  if (!v.startsWith("+")) return "+" + v.replace(/\D/g, "");
  return "+" + v.slice(1).replace(/\D/g, "");
}

export default function AdminVendors() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  // ⬇️ sumamos ownerUid
  const [form, setForm] = useState({
    phone: "",
    waPhoneId: "",
    zone: "",
    alias: "",
    active: true,
    owner: "",    // responsable (email o nombre)
    ownerUid: "", // UID del vendedor (Auth)
    notes: "",
  });

  const load = async () => {
    setLoading(true);
    const snap = await getDocs(collection(db, "wabaNumbers"));
    setRows(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  // 🔁 Crea/actualiza perfil users/{uid} si hay ownerUid
  const upsertUserProfile = async ({
    ownerUid,
    owner,
    alias,
    waPhoneId,
    phone,
    zone,
  }) => {
    const uid = (ownerUid || "").trim();
    if (!uid) return; // si no hay UID, no hacemos nada
    await setDoc(
      doc(db, "users", uid),
      {
        email: owner || "",
        name: alias || "",
        role: "seller",
        waPhoneId: waPhoneId || "",
        phone: phone || "",
        zone: zone || "",
        alias: alias || "",
        active: true,
        updatedAt: Date.now(),
      },
      { merge: true }
    );
  };

  const add = async (e) => {
    e?.preventDefault?.();
    const phone = normPhone(form.phone);
    if (!phone || phone.length < 7) return alert("Número inválido");
    if (!form.waPhoneId?.trim()) return alert("Falta el Phone ID (Meta)");
    if (!form.zone?.trim()) return alert("Falta la zona");

    const payload = {
      phone,
      waPhoneId: form.waPhoneId.trim(),
      zone: form.zone.trim(),
      alias: form.alias?.trim() || phone,
      active: !!form.active,
      owner: form.owner?.trim() || "",
      ownerUid: form.ownerUid?.trim() || "",
      notes: form.notes?.trim() || "",
      createdAt: Date.now(),
    };

    // 1) guardamos el número en wabaNumbers
    await addDoc(collection(db, "wabaNumbers"), payload);

    // 2) si hay UID, creamos/actualizamos el perfil del vendedor
    if (payload.ownerUid) {
      await upsertUserProfile(payload);
    }

    setForm({
      phone: "",
      waPhoneId: "",
      zone: "",
      alias: "",
      active: true,
      owner: "",
      ownerUid: "",
      notes: "",
    });
    await load();
  };

  const saveInline = async (row, patch) => {
    await updateDoc(doc(db, "wabaNumbers", row.id), patch);
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, ...patch } : r)));
  };

  const remove = async (row) => {
    if (!confirm(`Eliminar número ${row.alias || row.phone}?`)) return;
    await deleteDoc(doc(db, "wabaNumbers", row.id));
    setRows((rs) => rs.filter((r) => r.id !== row.id));
  };

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter(
      (r) =>
        (r.phone || "").toLowerCase().includes(s) ||
        (r.alias || "").toLowerCase().includes(s) ||
        (r.owner || "").toLowerCase().includes(s) ||
        (r.zone || "").toLowerCase().includes(s) ||
        (r.waPhoneId || "").toLowerCase().includes(s) ||
        (r.ownerUid || "").toLowerCase().includes(s)
    );
  }, [rows, q]);

  return (
    <div className="space-y-6">
      {/* Alta */}
      <form onSubmit={add} className="grid gap-3 p-4 border rounded md:grid-cols-8">
        <input
          className="p-2 border rounded"
          placeholder="+549..."
          value={form.phone}
          onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
          required
        />
        <input
          className="p-2 border rounded"
          placeholder="Phone ID (Meta)"
          value={form.waPhoneId}
          onChange={(e) => setForm((f) => ({ ...f, waPhoneId: e.target.value }))}
          required
        />
        <input
          className="p-2 border rounded"
          placeholder="Zona (Córdoba Capital / Villa María)"
          value={form.zone}
          onChange={(e) => setForm((f) => ({ ...f, zone: e.target.value }))}
          required
        />
        <input
          className="p-2 border rounded"
          placeholder="Alias (ej. Vendedor Norte)"
          value={form.alias}
          onChange={(e) => setForm((f) => ({ ...f, alias: e.target.value }))}
        />
        <input
          className="p-2 border rounded"
          placeholder="Responsable (email)"
          value={form.owner}
          onChange={(e) => setForm((f) => ({ ...f, owner: e.target.value }))}
        />
        <input
          className="p-2 border rounded"
          placeholder="UID vendedor (Auth)"
          value={form.ownerUid}
          onChange={(e) => setForm((f) => ({ ...f, ownerUid: e.target.value }))}
        />
        <input
          className="p-2 border rounded"
          placeholder="Notas"
          value={form.notes}
          onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
        />
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
            />
            Activo
          </label>
          <button className="px-3 py-2 text-sm text-white bg-black rounded" type="submit">
            Agregar
          </button>
        </div>
      </form>

      {/* Header + buscador */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Números de vendedores</h3>
        <input
          className="p-2 border rounded"
          placeholder="Buscar (tel, alias, responsable, zona, phoneId, uid)…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {/* Tabla */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm border">
          <thead className="bg-gray-50">
            <tr>
              <th className="p-2 border">Teléfono</th>
              <th className="p-2 border">Phone ID (Meta)</th>
              <th className="p-2 border">Zona</th>
              <th className="p-2 border">Alias</th>
              <th className="p-2 border">Responsable (email)</th>
              <th className="p-2 border">UID</th>
              <th className="p-2 border">Notas</th>
              <th className="p-2 border">Estado</th>
              <th className="p-2 border">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={9} className="p-4 text-center text-gray-500">
                  Sin números aún.
                </td>
              </tr>
            )}

            {filtered.map((row) => (
              <tr key={row.id}>
                <td className="p-2 font-mono border">{row.phone}</td>

                <td className="p-2 border">
                  <input
                    className="w-full p-1 font-mono border rounded"
                    value={row.waPhoneId || ""}
                    onChange={(e) => saveInline(row, { waPhoneId: e.target.value })}
                  />
                </td>

                <td className="p-2 border">
                  <input
                    className="w-full p-1 border rounded"
                    value={row.zone || ""}
                    onChange={(e) => saveInline(row, { zone: e.target.value })}
                  />
                </td>

                <td className="p-2 border">
                  <input
                    className="w-full p-1 border rounded"
                    value={row.alias || ""}
                    onChange={(e) => saveInline(row, { alias: e.target.value })}
                  />
                </td>

                <td className="p-2 border">
                  <input
                    className="w-full p-1 border rounded"
                    value={row.owner || ""}
                    onChange={(e) => saveInline(row, { owner: e.target.value })}
                    placeholder="email del vendedor"
                  />
                </td>

                <td className="p-2 border">
                  <input
                    className="w-full p-1 font-mono border rounded"
                    value={row.ownerUid || ""}
                    onChange={(e) => saveInline(row, { ownerUid: e.target.value })}
                    placeholder="UID"
                  />
                </td>

                <td className="p-2 border">
                  <input
                    className="w-full p-1 border rounded"
                    value={row.notes || ""}
                    onChange={(e) => saveInline(row, { notes: e.target.value })}
                  />
                </td>

                <td className="p-2 border">
                  <button
                    className={
                      "px-2 py-1 rounded " +
                      (row.active ? "bg-green-600 text-white" : "bg-gray-200")
                    }
                    onClick={() => saveInline(row, { active: !row.active })}
                  >
                    {row.active ? "Activo" : "Inactivo"}
                  </button>
                </td>

                <td className="p-2 space-x-2 border">
                  <button
                    className="px-2 py-1 border rounded"
                    onClick={() => remove(row)}
                  >
                    Eliminar
                  </button>
                  <button
                    className="px-2 py-1 border rounded"
                    title="Crear/actualizar perfil users/{uid}"
                    onClick={() =>
                      upsertUserProfile({
                        ownerUid: row.ownerUid,
                        owner: row.owner,
                        alias: row.alias,
                        waPhoneId: row.waPhoneId,
                        phone: row.phone,
                        zone: row.zone,
                      }).then(() => alert("Perfil sincronizado"))
                    }
                  >
                    Perfil
                  </button>
                </td>
              </tr>
            ))}

            {loading && (
              <tr>
                <td colSpan={9} className="p-4 text-center">
                  Cargando…
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
