// src/components/AgendaCalendario.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "../firebase"; // <- usa tu export actual
// Si tus exports se llaman distinto, ajusta este import.

const TZ = "America/Argentina/Cordoba";

function startOfMonth(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), 1);
  return d;
}
function endOfMonth(date) {
  const d = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
  return d;
}
function formatYMD(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
function startOfWeekMonday(date) {
  const d = new Date(date);
  const day = (d.getDay() + 6) % 7; // 0 = Monday
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
}
function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}
function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}
function toMidnightTimestampLocal(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
  return Timestamp.fromDate(d);
}

const DAY_NAMES = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const MONTH_NAMES = [
  "enero","febrero","marzo","abril","mayo","junio",
  "julio","agosto","septiembre","octubre","noviembre","diciembre"
];

export default function AgendaCalendario() {
  const [currentUser, setCurrentUser] = useState(null);
  const [currentMonth, setCurrentMonth] = useState(() => startOfMonth(new Date()));
  const [tasks, setTasks] = useState([]); // tareas del mes visible
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ id: null, titulo: "", nota: "", done: false });

  const modalRef = useRef(null);
  const confirmRef = useRef(null);

  // Autenticación (obtener vendedor actual)
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setCurrentUser(u));
    return () => unsub?.();
  }, []);

  // Rango del mes visible
  const range = useMemo(() => {
    const start = startOfMonth(currentMonth);
    const end = endOfMonth(currentMonth);
    return { start, end };
  }, [currentMonth]);

  // Escucha tareas del mes visible para el usuario actual
  useEffect(() => {
    if (!currentUser) return;
    setLoading(true);
    const q = query(
      collection(db, "tareas"),
      where("userId", "==", currentUser.uid),
      where("fecha", ">=", Timestamp.fromDate(range.start)),
      where("fecha", "<=", Timestamp.fromDate(range.end)),
      orderBy("fecha", "asc"),
      
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const arr = [];
        snap.forEach((docu) => arr.push({ id: docu.id, ...docu.data() }));
        setTasks(arr);
        setLoading(false);
      },
      () => setLoading(false)
    );
    return () => unsub();
  }, [currentUser, range.start, range.end]);

  // Generar calendario (6 filas x 7 columnas, comenzando lunes)
  const calendarDays = useMemo(() => {
    const firstOfMonth = startOfMonth(currentMonth);
    const start = startOfWeekMonday(firstOfMonth);
    const days = [];
    for (let i = 0; i < 42; i++) {
      days.push(addDays(start, i));
    }
    return days;
  }, [currentMonth]);

  const tasksByYMD = useMemo(() => {
    const map = new Map();
    for (const t of tasks) {
      const jsDate = t.fecha?.toDate ? t.fecha.toDate() : new Date(t.fecha);
      const ymd = formatYMD(jsDate);
      if (!map.has(ymd)) map.set(ymd, []);
      map.get(ymd).push(t);
    }
    return map;
  }, [tasks]);

  function openModalForDate(date, task = null) {
    setSelectedDate(date);
    if (task) {
      setForm({
        id: task.id,
        titulo: task.titulo || "",
        nota: task.nota || "",
        done: !!task.done,
      });
    } else {
      setForm({ id: null, titulo: "", nota: "", done: false });
    }
    modalRef.current?.showModal();
  }

  function closeModal() {
    modalRef.current?.close();
  }

  function openConfirm() {
    confirmRef.current?.showModal();
  }
  function closeConfirm() {
    confirmRef.current?.close();
  }

  async function saveTask(e) {
    e?.preventDefault?.();
    if (!currentUser) return;
    if (!form.titulo.trim()) return;

    setSaving(true);
    const base = {
      userId: currentUser.uid,
      titulo: form.titulo.trim(),
      nota: form.nota?.trim() || "",
      done: !!form.done,
      fecha: toMidnightTimestampLocal(selectedDate),
      fechaStr: formatYMD(selectedDate),
      updatedAt: serverTimestamp(),
    };

    try {
      if (form.id) {
        await updateDoc(doc(db, "tareas", form.id), base);
      } else {
        await addDoc(collection(db, "tareas"), {
          ...base,
          createdAt: serverTimestamp(),
        });
      }
      closeModal();
    } finally {
      setSaving(false);
    }
  }

  async function toggleDone(task) {
    await updateDoc(doc(db, "tareas", task.id), {
      done: !task.done,
      updatedAt: serverTimestamp(),
    });
  }

  const [pendingDelete, setPendingDelete] = useState(null);
  function askDelete(task) {
    setPendingDelete(task);
    openConfirm();
  }
  async function confirmDelete() {
    if (!pendingDelete) return;
    await deleteDoc(doc(db, "tareas", pendingDelete.id));
    setPendingDelete(null);
    closeConfirm();
  }

  function goPrevMonth() {
    const d = new Date(currentMonth);
    d.setMonth(d.getMonth() - 1);
    setCurrentMonth(startOfMonth(d));
  }
  function goNextMonth() {
    const d = new Date(currentMonth);
    d.setMonth(d.getMonth() + 1);
    setCurrentMonth(startOfMonth(d));
  }
  function goToday() {
    const t = new Date();
    setCurrentMonth(startOfMonth(t));
    setSelectedDate(t);
  }

  const today = new Date();
  const monthTitle = `${MONTH_NAMES[currentMonth.getMonth()]} ${currentMonth.getFullYear()}`;

  return (
    <section className="p-4 space-y-4 md:p-6">
      {/* Header */}
      <div className="flex flex-wrap gap-2 justify-between items-center">
        <div className="flex gap-2 items-center">
          <button onClick={goPrevMonth} className="btn btn-sm btn-ghost" aria-label="Mes anterior">‹</button>
          <h2 className="text-xl font-bold capitalize md:text-2xl">{monthTitle}</h2>
          <button onClick={goNextMonth} className="btn btn-sm btn-ghost" aria-label="Mes siguiente">›</button>
        </div>
        <div className="flex gap-2 items-center">
          <button onClick={goToday} className="btn btn-sm">Hoy</button>
          <button
            onClick={() => openModalForDate(new Date())}
            className="btn btn-sm btn-primary"
          >
            Nueva tarea
          </button>
        </div>
      </div>

      {/* Calendario */}
      <div className="overflow-hidden rounded-2xl border shadow-sm border-base-300">
        <div className="grid grid-cols-7 text-xs font-semibold bg-base-200 md:text-sm">
          {DAY_NAMES.map((d) => (
            <div key={d} className="py-2 text-center">{d}</div>
          ))}
        </div>

        <div className="grid grid-cols-7">
          {calendarDays.map((day, idx) => {
            const isCurrentMonth = day.getMonth() === currentMonth.getMonth();
            const isToday = sameDay(day, today);
            const ymd = formatYMD(day);
            const tlist = tasksByYMD.get(ymd) || [];

            return (
              <div
                key={idx}
                className={[
                  "border border-base-200 p-2 min-h-28 relative",
                  isCurrentMonth ? "bg-base-100" : "bg-base-200/50",
                ].join(" ")}
              >
                <div className="flex justify-between items-center">
                  <button
                    onClick={() => openModalForDate(day)}
                    className={[
                      "text-sm font-semibold px-2 py-1 rounded hover:bg-base-200",
                      isToday ? "border border-primary rounded-full" : ""
                    ].join(" ")}
                    title="Agregar tarea"
                  >
                    {day.getDate()}
                  </button>
                  {tlist.length > 0 && (
                    <span className="badge badge-ghost badge-sm">{tlist.length}</span>
                  )}
                </div>

                {/* Listado compacto del día */}
                <div className="mt-2 space-y-1">
                  {tlist.slice(0, 3).map((t) => (
                    <div
                      key={t.id}
                      className={[
                        "text-xs px-2 py-1 rounded cursor-pointer border",
                        t.done ? "line-through opacity-70" : "",
                        "hover:bg-base-200"
                      ].join(" ")}
                      onClick={() => openModalForDate(day, t)}
                      title={t.nota || ""}
                    >
                      {t.titulo}
                    </div>
                  ))}
                  {tlist.length > 3 && (
                    <button
                      className="text-xs link link-primary"
                      onClick={() => openModalForDate(day)}
                    >
                      Ver todas ({tlist.length})
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Lista del día seleccionado */}
      <DayTasksPanel
        selectedDate={selectedDate}
        tasks={tasks.filter((t) => sameDay(t.fecha?.toDate?.() || new Date(t.fecha), selectedDate))}
        onNew={() => openModalForDate(selectedDate)}
        onEdit={(t) => openModalForDate(selectedDate, t)}
        onToggleDone={toggleDone}
        onDelete={askDelete}
        loading={loading}
      />

      {/* Modal Crear/Editar */}
      <dialog ref={modalRef} className="modal">
        <div className="modal-box">
          <h3 className="mb-2 text-lg font-bold">
            {form.id ? "Editar tarea" : "Nueva tarea"} — {formatYMD(selectedDate)}
          </h3>
          <form onSubmit={saveTask} className="space-y-3">
            <div className="form-control">
              <label className="label"><span className="label-text">Título *</span></label>
              <input
                className="input input-bordered"
                value={form.titulo}
                onChange={(e) => setForm((f) => ({ ...f, titulo: e.target.value }))}
                placeholder="Ej. Llamar al cliente"
                required
              />
            </div>
            <div className="form-control">
              <label className="label"><span className="label-text">Notas</span></label>
              <textarea
                className="textarea textarea-bordered min-h-24"
                value={form.nota}
                onChange={(e) => setForm((f) => ({ ...f, nota: e.target.value }))}
                placeholder="Detalles, horario estimado, etc."
              />
            </div>
            <div className="form-control">
              <label className="gap-3 justify-start cursor-pointer label">
                <input
                  type="checkbox"
                  className="checkbox"
                  checked={form.done}
                  onChange={(e) => setForm((f) => ({ ...f, done: e.target.checked }))}
                />
                <span className="label-text">Marcar como completada</span>
              </label>
            </div>

            <div className="modal-action">
              <button type="button" className="btn" onClick={closeModal}>Cancelar</button>
              <button type="submit" className={`btn btn-primary ${saving ? "loading" : ""}`} disabled={saving}>
                {form.id ? "Guardar cambios" : "Crear tarea"}
              </button>
            </div>
          </form>
        </div>
        <form method="dialog" className="modal-backdrop"><button>close</button></form>
      </dialog>

      {/* Confirmación de borrado */}
      <dialog ref={confirmRef} className="modal">
        <div className="modal-box">
          <h3 className="text-lg font-bold">Eliminar tarea</h3>
          <p className="py-2">¿Seguro que querés eliminar <b>{pendingDelete?.titulo}</b>?</p>
          <div className="modal-action">
            <button className="btn" onClick={closeConfirm}>Cancelar</button>
            <button className="btn btn-error" onClick={confirmDelete}>Eliminar</button>
          </div>
        </div>
        <form method="dialog" className="modal-backdrop"><button>close</button></form>
      </dialog>
    </section>
  );
}

function DayTasksPanel({
  selectedDate,
  tasks,
  onNew,
  onEdit,
  onToggleDone,
  onDelete,
  loading,
}) {
  return (
    <div className="border shadow-sm card bg-base-100 border-base-300">
      <div className="card-body">
        <div className="flex gap-2 justify-between items-center">
          <h3 className="text-lg card-title">Tareas — {formatYMD(selectedDate)}</h3>
          <button className="btn btn-sm btn-primary" onClick={onNew}>Nueva tarea</button>
        </div>

        {loading ? (
          <div className="py-6 text-sm text-center opacity-70">Cargando…</div>
        ) : tasks.length === 0 ? (
          <div className="py-6 text-sm text-center opacity-70">Sin tareas para este día</div>
        ) : (
          <ul className="mt-2 divide-y divide-base-200">
            {tasks.map((t) => (
              <li key={t.id} className="flex gap-2 justify-between items-start py-3">
                <div className="flex gap-3 items-start">
                  <input
                    type="checkbox"
                    className="mt-1 checkbox"
                    checked={!!t.done}
                    onChange={() => onToggleDone(t)}
                  />
                  <div>
                    <div className={`font-medium ${t.done ? "line-through opacity-70" : ""}`}>
                      {t.titulo}
                    </div>
                    {t.nota ? (
                      <div className="text-sm whitespace-pre-wrap opacity-80">{t.nota}</div>
                    ) : null}
                  </div>
                </div>

                <div className="flex gap-2 items-center">
                  <button className="btn btn-xs" onClick={() => onEdit(t)}>Editar</button>
                  <button className="btn btn-xs btn-error" onClick={() => onDelete(t)}>Borrar</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
