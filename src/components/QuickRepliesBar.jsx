// src/components/QuickRepliesBar.jsx
import React, { useEffect, useMemo, useState, useRef } from "react";
import { createPortal } from "react-dom";
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
        <div className="flex gap-2">
          {items.map((t, i) => (
            <button
              key={i}
              type="button"
              className="text-white border rounded-full btn btn-xs bg-base-200 border-base-300 hover:bg-base-100"
              onClick={() => onPick?.(t)}
              title={t}
            >
              {t.length > 28 ? t.slice(0, 28) + "…" : t}
            </button>
          ))}
        </div>

        <button
          type="button"
          className="ml-2 text-black bg-white border btn btn-xs border-base-300 hover:bg-base-100"
          onClick={() => setOpenUserModal(true)}
          title="Administrar tus respuestas"
        >
          <MessageSquarePlus className="w-4 h-4 mr-1" />
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

  const modal = (
    <div
      className="fixed inset-0 z-[150] bg-black/50 grid place-items-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-5xl h-[90vh] min-h-0 rounded-2xl border shadow-2xl bg-base-100 overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="text-lg font-semibold">Mis respuestas rápidas</h3>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>
            <X className="w-4 h-4" />
            Cerrar
          </button>
        </div>

        <div className="grid flex-1 min-h-0 grid-cols-1 gap-4 p-4 overflow-hidden md:grid-cols-5">
          <div className="h-full min-h-0 pr-1 overflow-y-auto md:col-span-2 overscroll-contain">
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-medium">
                {form.id ? "Editar respuesta" : "Nueva respuesta"}
              </h4>
              <button className="btn btn-xs" onClick={startCreate}>
                <Plus className="w-3.5 h-3.5" /> Nuevo
              </button>
            </div>

            <label className="w-full mb-2 form-control">
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

            <label className="w-full mb-3 form-control">
              <span className="text-sm label-text">Contenido</span>
              <textarea
                className="textarea textarea-bordered min-h-[140px] max-h-[38vh]"
                placeholder="Texto que se insertará en el chat"
                value={form.text}
                onChange={(e) =>
                  setForm((f) => ({ ...f, text: e.target.value }))
                }
              />
            </label>

            <div className="sticky bottom-0 flex gap-2 py-2 bg-base-100">
              <button
                className="btn btn-success btn-sm"
                onClick={save}
                disabled={saving}
              >
                <Save className="w-4 h-4 mr-1" />
                Guardar
              </button>
              {!!form.id && (
                <button className="btn btn-ghost btn-sm" onClick={resetForm}>
                  Cancelar
                </button>
              )}
            </div>
          </div>

          <div className="flex flex-col h-full min-h-0 overflow-hidden md:col-span-3">
            <div className="flex items-center gap-2 mb-3 shrink-0">
              <div className="relative flex-1">
                <Search className="absolute left-2 top-2.5 w-4 h-4 text-gray-500" />
                <input
                  className="w-full pl-8 input input-sm input-bordered"
                  placeholder="Buscar por título o contenido…"
                  value={queryStr}
                  onChange={(e) => setQueryStr(e.target.value)}
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-2 pr-1 mb-3 overflow-y-auto max-h-24 shrink-0 overscroll-contain">
              {filtered.map((it) => (
                <button
                  key={it.id}
                  className="px-3 py-1 text-sm bg-white border rounded-full hover:bg-base-200"
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

            <div className="flex-1 min-h-0 overflow-x-hidden overflow-y-auto border rounded-xl overscroll-contain">
              <table className="table table-fixed table-zebra table-pin-rows">
                <thead>
                  <tr>
                    <th className="w-40">Título</th>
                    <th>Contenido</th>
                    <th className="text-right w-36">Acciones</th>
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
                          <div className="font-medium break-words">{it.title}</div>
                        </td>
                        <td className="align-top">
                          <div className="pr-1 overflow-y-auto break-words whitespace-pre-wrap max-h-56">
                            {it.text}
                          </div>
                        </td>
                        <td className="align-top">
                          <div className="flex justify-end gap-1">
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
          Solo vos podés ver y editar estas respuestas.
        </div>
      </div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(modal, document.body) : modal;
}
