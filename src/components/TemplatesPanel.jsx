// src/components/TemplatesPanel.jsx
import { useEffect, useMemo, useState } from "react";
import {
  listTemplates, createTemplate, updateTemplate, deleteTemplate, renderTemplate
} from "../lib/templates";

// ──────────────────────────────────────────────────────────────
// PACK de plantillas (las que pediste)
// Cada item: { name, folder, body, vars }
const PACK = [
  // 1) Bienvenida / Primer contacto
  {
    name: "Bienvenida",
    folder: "Ventas",
    body: `Hola {nombre}, ¿cómo estás? Te saluda {vendedor} de atención al cliente. Contame qué necesitás y te paso precios y stock hoy {fecha}.`,
    vars: ["nombre","vendedor","fecha","link"],
  },
  {
    name: "Consulta de producto",
    folder: "Ventas",
    body: `¡Hola {nombre}! Soy {vendedor}. ¿Qué producto estás buscando? Si tenés alguna marca o rendimiento en mente, decime así te paso la mejor opción disponible hoy {fecha}.`,
    vars: ["nombre","vendedor","fecha","link"],
  },
  {
    name: "Enlace a catálogo",
    folder: "Ventas",
    body: `{nombre}, te dejo nuestro catálogo actualizado: {link}
Si te interesa algún producto, decime y te confirmo stock y precio hoy {fecha}.`,
    vars: ["nombre","vendedor","fecha","link"],
  },

  // 2) Cotización rápida
  {
    name: "Cotización simple",
    folder: "Ventas",
    body: `{nombre}, te paso una cotización rápida (validez {fecha}):
• Producto: _______
• Presentación: _______
• Precio: $______
¿Querés que te reserve o coordinamos entrega/retira?`,
    vars: ["nombre","vendedor","fecha","link"],
  },
  {
    name: "Combo sugerido",
    folder: "Ventas",
    body: `Para lo que necesitás te recomiendo este combo:
• Opción A: _______ – $______
• Opción B: _______ – $______
¿Con cuál te quedás, {nombre}? Puedo prepararlo para hoy {fecha}.`,
    vars: ["nombre","vendedor","fecha","link"],
  },
  {
    name: "Alternativa por falta de stock",
    folder: "Ventas",
    body: `{nombre}, justo ese ítem se agotó. Te propongo estas alternativas equivalentes:
• _______ – $______
• _______ – $______
Si te sirve, lo dejo reservado y coordinamos entrega hoy {fecha}.`,
    vars: ["nombre","vendedor","fecha","link"],
  },

  // 3) Reserva / Pedido
  {
    name: "Confirmar pedido",
    folder: "Ventas",
    body: `Perfecto {nombre}, tomo tu pedido:
• Ítems: _______
• Total aprox.: $______
• Retiro/Entrega: _______
¿Confirmo y lo dejamos listo para hoy {fecha}?`,
    vars: ["nombre","vendedor","fecha","link"],
  },
  {
    name: "Pedido listo para retirar",
    folder: "Logística",
    body: `{nombre}, tu pedido ya está listo para retirar hoy {fecha}.
Dirección: _______
Horario: _______
Al llegar, decí que hablaste con {vendedor}.`,
    vars: ["nombre","vendedor","fecha","link"],
  },
  {
    name: "En camino",
    folder: "Logística",
    body: `Hola {nombre}, vamos en camino con tu pedido 🚚
Ventana estimada: _______
Cualquier referencia para llegar más fácil es bienvenida. Gracias.`,
    vars: ["nombre","vendedor","fecha","link"],
  },

  // 4) Pagos
  {
    name: "Medios de pago",
    folder: "Ventas",
    body: `Estos son los medios de pago disponibles:
• Efectivo al retirar/entregar
• Transferencia bancaria (enviar comprobante)
• Tarjeta/QR (consultar)
Si elegís transferencia, te paso los datos y lo preparo hoy {fecha}.`,
    vars: ["nombre","vendedor","fecha","link"],
  },
  {
    name: "Datos para transferencia",
    folder: "Cobranza",
    body: `{nombre}, te paso los datos:
• Alias/CBU: _______
• Titular: _______
• Monto: $______
Cuando puedas enviá el comprobante por acá y lo despacho hoy {fecha}. Gracias.`,
    vars: ["nombre","vendedor","fecha","link"],
  },
  {
    name: "Confirmación de pago",
    folder: "Cobranza",
    body: `¡Gracias {nombre}! Recibimos el pago.
Dejo tu pedido confirmado para {fecha}. Si necesitás factura o comprobante, avisame y te lo envío al correo que indiques.`,
    vars: ["nombre","vendedor","fecha","link"],
  },

  // 5) Seguimiento / Postventa
  {
    name: "Seguimiento de atención",
    folder: "Seguimiento",
    body: `Hola {nombre}, soy {vendedor}. ¿Te quedó alguna duda o necesitás algo más sobre lo que hablamos? Estoy online hoy {fecha}.`,
    vars: ["nombre","vendedor","fecha","link"],
  },
  {
    name: "Recordatorio de presupuesto",
    folder: "Seguimiento",
    body: `{nombre}, paso a recordarte el presupuesto que te envié. ¿Querés que lo dejemos reservado o ajusto cantidades? Estoy para ayudarte hoy {fecha}.`,
    vars: ["nombre","vendedor","fecha","link"],
  },
  {
    name: "Gracias y cierre",
    folder: "Postventa",
    body: `¡Gracias {nombre} por tu compra! Cualquier cosa que necesites, escribime por acá.
Si querés volver a ver los productos, te dejo el link: {link}`,
    vars: ["nombre","vendedor","fecha","link"],
  },
  {
    name: "Satisfacción",
    folder: "Postventa",
    body: `{nombre}, ¿cómo te fue con el producto/servicio? Tu opinión nos ayuda a mejorar. Si está todo ok, ¡me alegra! Si no, decime y lo resolvemos hoy {fecha}.`,
    vars: ["nombre","vendedor","fecha","link"],
  },

  // 6) Problemas / Garantía
  {
    name: "Reclamo recibido",
    folder: "Soporte",
    body: `Lamento el inconveniente, {nombre}. Ya registré tu reclamo.
Te pido por favor:
• Breve descripción del problema
• Foto/video si es posible
Con eso lo resuelvo con prioridad hoy {fecha}.`,
    vars: ["nombre","vendedor","fecha","link"],
  },
  {
    name: "Cambio/Devolución",
    folder: "Soporte",
    body: `{nombre}, coordinemos el cambio/devolución:
• Dirección/Retiro: _______
• Franja horaria: _______
Te confirmo apenas quede agendado. Gracias por la paciencia.`,
    vars: ["nombre","vendedor","fecha","link"],
  },

  // 7) Info general
  {
    name: "Horarios y dirección",
    folder: "Información",
    body: `{nombre}, nuestros horarios:
• Lunes a Viernes: _______
• Sábado: _______
Dirección: _______
Ubicación/Mapa: {link}
Cualquier duda escribime, soy {vendedor}.`,
    vars: ["nombre","vendedor","fecha","link"],
  },
  {
    name: "Promoción vigente",
    folder: "Información",
    body: `{nombre}, hoy {fecha} tenemos esta promo:
• _______ – $_______
• _______ – $_______
Si te interesa, te lo dejo reservado. Cupos limitados.`,
    vars: ["nombre","vendedor","fecha","link"],
  },

  // 8) Recuperación de conversación
  {
    name: "¿Sigo en línea?",
    folder: "Seguimiento",
    body: `{nombre}, te escribo para saber si seguís interesado/a. Si querés, lo dejamos reservado para hoy {fecha} y coordinamos entrega/retira. Estoy atento, {vendedor}.`,
    vars: ["nombre","vendedor","fecha","link"],
  },
  {
    name: "Último contacto amable",
    folder: "Seguimiento",
    body: `{nombre}, hago el último seguimiento por este pedido. Si querés retomamos cuando te quede cómodo. Te dejo nuevamente el link: {link}
¡Gracias por tu tiempo!`,
    vars: ["nombre","vendedor","fecha","link"],
  },
];
// ──────────────────────────────────────────────────────────────

export default function TemplatesPanel() {
  const [items, setItems] = useState([]);
  const [q, setQ] = useState("");
  const [form, setForm] = useState({ name: "", folder: "General", body: "" });
  const [editing, setEditing] = useState(null);
  const [importing, setImporting] = useState(false);

  const [previewData, setPreviewData] = useState({
    nombre: "Juan",
    vendedor: "María",
    fecha: new Date().toLocaleDateString(),
    link: "https://tusitio.com/pedido/123",
  });

  const load = async () => setItems(await listTemplates());
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return items;
    return items.filter(
      (t) =>
        t.name.toLowerCase().includes(term) ||
        t.folder.toLowerCase().includes(term) ||
        t.body.toLowerCase().includes(term)
    );
  }, [q, items]);

  const grouped = useMemo(() => {
    const map = new Map();
    for (const t of filtered) {
      const f = t.folder || "General";
      if (!map.has(f)) map.set(f, []);
      map.get(f).push(t);
    }
    return Array.from(map.entries()).sort(([a],[b]) => a.localeCompare(b));
  }, [filtered]);

  const onSubmit = async (e) => {
    e.preventDefault();
    if (editing) {
      await updateTemplate(editing.id, form);
    } else {
      await createTemplate(form);
    }
    setForm({ name: "", folder: "General", body: "" });
    setEditing(null);
    load();
  };

  const onEdit = (t) => {
    setEditing(t);
    setForm({ name: t.name, folder: t.folder, body: t.body });
  };

  const onDelete = async (t) => {
    if (!confirm(`Eliminar plantilla "${t.name}"?`)) return;
    await deleteTemplate(t.id);
    load();
  };

  // Crear/actualizar el PACK
  const importPack = async () => {
    try {
      setImporting(true);
      const existing = await listTemplates();
      const key = (t) => `${(t.folder || "General")}__${t.name}`;
      const existingMap = new Map(existing.map(t => [key(t), t]));

      let created = 0, updated = 0, skipped = 0;
      for (const seed of PACK) {
        const data = {
          name: seed.name,
          folder: seed.folder || "General",
          body: seed.body,
          vars: seed.vars || ["nombre","vendedor","fecha","link"],
        };
        const k = key(data);
        const found = existingMap.get(k);
        if (!found) {
          await createTemplate(data);
          created++;
        } else if ((found.body || "") !== data.body || JSON.stringify(found.vars || []) !== JSON.stringify(data.vars || [])) {
          await updateTemplate(found.id, data);
          updated++;
        } else {
          skipped++;
        }
      }
      await load();
      alert(`Pack cargado.\nNuevas: ${created}\nActualizadas: ${updated}\nSin cambios: ${skipped}`);
    } catch (e) {
      console.error(e);
      alert("No se pudo importar el pack de plantillas. Revisá permisos de Firestore.");
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">Plantillas</h2>

      <div className="flex flex-wrap items-center gap-2">
        <input
          className="input input-bordered w-72"
          placeholder="Buscar…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button
          className="btn btn-sm btn-outline"
          onClick={importPack}
          disabled={importing}
          title="Crear/actualizar el pack recomendado"
        >
          {importing ? "Cargando…" : "Cargar pack recomendado"}
        </button>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Lista */}
        <div className="space-y-4">
          {grouped.map(([folder, arr]) => (
            <div key={folder} className="card bg-base-200">
              <div className="card-body">
                <h3 className="font-semibold">{folder}</h3>
                <div className="divide-y">
                  {arr.map((t) => (
                    <div key={t.id} className="flex items-start justify-between gap-3 py-3">
                      <div>
                        <div className="font-medium">{t.name}</div>
                        <div className="text-sm whitespace-pre-line opacity-70 line-clamp-2">{t.body}</div>
                      </div>
                      <div className="flex gap-2">
                        <button className="btn btn-sm" onClick={() => onEdit(t)}>Editar</button>
                        <button className="btn btn-sm btn-error" onClick={() => onDelete(t)}>Borrar</button>
                      </div>
                    </div>
                  ))}
                  {!arr.length && <div className="py-3 text-sm opacity-70">Sin plantillas</div>}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Editor + Preview */}
        <form onSubmit={onSubmit} className="card bg-base-200">
          <div className="gap-3 card-body">
            <h3 className="font-semibold">{editing ? "Editar plantilla" : "Nueva plantilla"}</h3>

            <input
              className="input input-bordered"
              placeholder="Nombre"
              value={form.name}
              onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
              required
            />

            <input
              className="input input-bordered"
              placeholder="Carpeta (ej. Ventas)"
              value={form.folder}
              onChange={(e) => setForm((s) => ({ ...s, folder: e.target.value }))}
            />

            <textarea
              className="h-40 textarea textarea-bordered"
              placeholder="Mensaje con variables {nombre} {vendedor} {fecha} {link}"
              value={form.body}
              onChange={(e) => setForm((s) => ({ ...s, body: e.target.value }))}
              required
            />

            <div className="grid grid-cols-2 gap-3">
              {Object.keys(previewData).map((k) => (
                <input
                  key={k}
                  className="input input-bordered"
                  value={previewData[k]}
                  onChange={(e) =>
                    setPreviewData((s) => ({ ...s, [k]: e.target.value }))
                  }
                  placeholder={k}
                />
              ))}
            </div>

            <div>
              <div className="mb-1 text-sm opacity-60">Vista previa:</div>
              <div className="p-3 whitespace-pre-wrap rounded bg-base-100">
                {renderTemplate(form.body, previewData)}
              </div>
            </div>

            <div className="flex gap-2">
              <button className="btn btn-primary" type="submit">
                {editing ? "Guardar cambios" : "Crear plantilla"}
              </button>
              {editing && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => { setEditing(null); setForm({ name:"", folder:"General", body:"" }); }}
                >
                  Cancelar
                </button>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
