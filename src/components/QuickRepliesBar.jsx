// src/components/QuickRepliesBar.jsx
import React, { useEffect, useMemo, useState, useRef } from "react";
import { db } from "../firebase";
import {
  collection,
  getDocs,
  orderBy,
  query,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
} from "firebase/firestore";
import { useAuthState } from "../hooks/useAuthState.js";
import {
  Plus,
  Save,
  X,
  Pencil,
  Trash2,
  Search,
  MessageSquarePlus,
} from "lucide-react";

/**
 * Barra de respuestas rápidas:
 * - Presets locales (siempre)
 * - Globales (colección: quickReplies, campo "ord")
 * - Personales por vendedor (users/{uid}/quickReplies) con modal CRUD
 *
 * Props:
 *  - onPick(text: string)
 *  - compact?: boolean
 */
export default function QuickRepliesBar({ onPick, compact = false }) {
  const { user } = useAuthState();
  const [globalRows, setGlobalRows] = useState([]);
  const [userRows, setUserRows] = useState([]);
  const [openUserModal, setOpenUserModal] = useState(false);

  const PRESETS = useMemo(
    () => [
      "¡Gracias por tu compra! 🧾",
      "¿Coordinamos envío? 🚚",
      "¿Te quedó alguna duda? 👇",
      "¿Te interesa ver más opciones?",
      "¡Listo! Cualquier cosa estoy acá ✨",
    ],
    []
  );

  // Globales (como ya tenías)
  useEffect(() => {
    (async () => {
      try {
        const q = query(collection(db, "quickReplies"), orderBy("ord", "asc"));
        const snap = await getDocs(q);
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setGlobalRows(list);
      } catch {
        setGlobalRows([]);
      }
    })();
  }, []);

  // Personales (escucha en vivo)
  useEffect(() => {
    if (!user?.uid) return;
    const base = collection(db, "users", user.uid, "quickReplies");
    const q = query(base, orderBy("updatedAt", "desc"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const arr = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setUserRows(arr);
      },
      () => setUserRows([])
    );
    return () => unsub();
  }, [user?.uid]);

  const items = useMemo(() => {
    const cloudGlobal = globalRows.map((r) => r.text).filter(Boolean);
    const cloudUser = userRows.map((r) => r.text).filter(Boolean);
    // Orden: personales → presets → globales (podés cambiar si preferís)
    return [...cloudUser, ...PRESETS, ...cloudGlobal];
  }, [globalRows, userRows, PRESETS]);

  if (!items.length) return null;

  return (
    <>
      <div
        className={
          "flex items-center gap-2 " +
          (compact ? "mt-2" : "mt-3") +
          " overflow-x-auto whitespace-nowrap pb-1"
        }
      >
        {/* Chips */}
        <div className="flex gap-2">
          {items.map((t, i) => (
            <button
              key={i}
              type="button"
              className="text-black rounded-full border btn btn-xs bg-base-200 border-base-300 hover:bg-base-100"
              onClick={() => onPick?.(t)}
              title={t}
            >
              {t.length > 28 ? t.slice(0, 28) + "…" : t}
            </button>
          ))}
        </div>

        {/* Botón Mis respuestas (CRUD personal) */}
        <button
          type="button"
          className="ml-2 text-black bg-white border btn btn-xs border-base-300 hover:bg-base-100"
          onClick={() => setOpenUserModal(true)}
          title="Administrar tus respuestas"
        >
          <MessageSquarePlus className="mr-1 w-4 h-4" />
          Mis respuestas
        </button>
      </div>

      <UserQuickRepliesModal
        open={openUserModal}
        onClose={() => setOpenUserModal(false)}
        onInsert={(txt) => onPick?.(txt)}
      />
    </>
  );
}

/* ===========================
   Modal CRUD (personal por UID)
   =========================== */

function UserQuickRepliesModal({ open, onClose, onInsert }) {
  const { user } = useAuthState();
  const uid = user?.uid || null;

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [queryStr, setQueryStr] = useState("");
  const [form, setForm] = useState({ id: null, title: "", text: "" });

  const inputTitleRef = useRef(null);

  useEffect(() => {
    if (!open || !uid) return;
    setLoading(true);
    const base = collection(db, "users", uid, "quickReplies");
    const q = query(base, orderBy("updatedAt", "desc"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const arr = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setItems(arr);
        setLoading(false);
      },
      () => {
        setItems([]);
        setLoading(false);
      }
    );
    return () => unsub();
  }, [open, uid]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => inputTitleRef.current?.focus(), 120);
    return () => clearTimeout(t);
  }, [open, form.id]);

  const filtered = useMemo(() => {
    const q = (queryStr || "").toLowerCase().trim();
    if (!q) return items;
    return items.filter(
      (it) =>
        (it.title || "").toLowerCase().includes(q) ||
        (it.text || "").toLowerCase().includes(q)
    );
  }, [items, queryStr]);

  const resetForm = () => setForm({ id: null, title: "", text: "" });
  const startCreate = () => {
    resetForm();
    requestAnimationFrame(() => inputTitleRef.current?.focus());
  };
  const startEdit = (it) =>
    setForm({ id: it.id, title: it.title || "", text: it.text || "" });

  const save = async () => {
    if (!uid) return;
    const title = (form.title || "").trim();
    const text = (form.text || "").trim();
    if (!title || !text) {
      alert("Completá título y contenido.");
      return;
    }
    try {
      setSaving(true);
      const base = collection(db, "users", uid, "quickReplies");
      if (!form.id) {
        await addDoc(base, {
          ownerUid: uid,
          title,
          text,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else {
        await updateDoc(doc(db, "users", uid, "quickReplies", form.id), {
          title,
          text,
          updatedAt: serverTimestamp(),
        });
      }
      resetForm();
    } catch (e) {
      alert(e?.message || "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  };

  const removeItem = async (it) => {
    if (!uid || !it?.id) return;
    const ok = confirm(`¿Eliminar "${it.title}"?`);
    if (!ok) return;
    try {
      await deleteDoc(doc(db, "users", uid, "quickReplies", it.id));
      if (form.id === it.id) resetForm();
    } catch (e) {
      alert(e?.message || "No se pudo eliminar");
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[99] bg-black/40 grid place-items-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl rounded-2xl border shadow-2xl bg-base-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex justify-between items-center p-4 border-b">
          <h3 className="text-lg font-semibold">Mis respuestas rápidas</h3>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>
            <X className="w-4 h-4" />
            Cerrar
          </button>
        </div>

        {/* Body */}
        <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-5">
          {/* Formulario */}
          <div className="md:col-span-2">
            <div className="flex justify-between items-center mb-2">
              <h4 className="font-medium">
                {form.id ? "Editar respuesta" : "Nueva respuesta"}
              </h4>
              <button className="btn btn-xs" onClick={startCreate}>
                <Plus className="w-3.5 h-3.5" /> Nuevo
              </button>
            </div>

            <label className="mb-2 w-full form-control">
              <span className="text-sm label-text">Título</span>
              <input
                ref={inputTitleRef}
                type="text"
                className="input input-sm input-bordered"
                placeholder="Ej: ¡Gracias por tu compra!"
                value={form.title}
                onChange={(e) =>
                  setForm((f) => ({ ...f, title: e.target.value }))
                }
              />
            </label>

            <label className="mb-3 w-full form-control">
              <span className="text-sm label-text">Contenido</span>
              <textarea
                className="textarea textarea-bordered min-h-[120px]"
                placeholder="Texto que se insertará en el chat"
                value={form.text}
                onChange={(e) =>
                  setForm((f) => ({ ...f, text: e.target.value }))
                }
              />
            </label>

            <div className="flex gap-2">
              <button
                className="btn btn-success btn-sm"
                onClick={save}
                disabled={saving}
              >
                <Save className="mr-1 w-4 h-4" />
                Guardar
              </button>
              {!!form.id && (
                <button className="btn btn-ghost btn-sm" onClick={resetForm}>
                  Cancelar
                </button>
              )}
            </div>
          </div>

          {/* Listado + búsqueda */}
          <div className="md:col-span-3">
            <div className="flex gap-2 items-center mb-3">
              <div className="relative flex-1">
                <Search className="absolute left-2 top-2.5 w-4 h-4 text-gray-500" />
                <input
                  className="pl-8 w-full input input-sm input-bordered"
                  placeholder="Buscar por título o contenido…"
                  value={queryStr}
                  onChange={(e) => setQueryStr(e.target.value)}
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-2 mb-3">
              {filtered.map((it) => (
                <button
                  key={it.id}
                  className="px-3 py-1 text-sm bg-white rounded-full border hover:bg-base-200"
                  title={it.text}
                  onClick={() => onInsert?.(it.text)}
                >
                  {it.title?.length > 28 ? it.title.slice(0, 28) + "…" : it.title}
                </button>
              ))}
              {!loading && filtered.length === 0 && (
                <div className="text-sm text-gray-500">Sin resultados</div>
              )}
            </div>

            <div className="overflow-hidden rounded-xl border">
              <table className="table table-zebra">
                <thead>
                  <tr>
                    <th className="w-40">Título</th>
                    <th>Contenido</th>
                    <th className="w-28 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={3} className="py-6 text-center">
                        Cargando…
                      </td>
                    </tr>
                  ) : filtered.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="py-6 text-center">
                        No hay respuestas guardadas
                      </td>
                    </tr>
                  ) : (
                    filtered.map((it) => (
                      <tr key={it.id}>
                        <td className="align-top">
                          <div className="font-medium">{it.title}</div>
                        </td>
                        <td className="align-top">
                          <div className="max-w-[520px] whitespace-pre-wrap break-words">
                            {it.text}
                          </div>
                        </td>
                        <td className="align-top">
                          <div className="flex gap-1 justify-end">
                            <button
                              className="btn btn-ghost btn-xs"
                              title="Insertar en chat"
                              onClick={() => onInsert?.(it.text)}
                            >
                              ➤ Insertar
                            </button>
                            <button
                              className="btn btn-ghost btn-xs"
                              title="Editar"
                              onClick={() => startEdit(it)}
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              className="text-red-600 btn btn-ghost btn-xs"
                              title="Eliminar"
                              onClick={() => removeItem(it)}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="p-4 text-xs text-gray-500 border-t">
          Solo vos podés ver/editar estas respuestas. Los admins pueden gestionar si es necesario.
        </div>
      </div>
    </div>
  );
}
