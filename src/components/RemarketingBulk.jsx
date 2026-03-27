import React, { useEffect, useMemo, useRef, useState } from "react";
import { db } from "../firebase";
import { collection, query, where, orderBy, limit, getDocs } from "firebase/firestore";
import { listLabels } from "../lib/labels";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import { useNavigate } from "react-router-dom";

// ---------- Config ----------
const LOCKED_LANG = "es_AR";
const LOCKED_TEMPLATE = "promo_hogarcril_combos";
const BASE =
  import.meta.env.VITE_BACKEND_URL ||
  import.meta.env.VITE_API_BASE ||
  "";
const api = (p) => `${BASE}${p}`;

// ---------- Helpers ----------
function normPhone(raw) {
  if (!raw) return "";
  const s = String(raw).trim();
  if (!s) return "";
  const cleaned = s.startsWith("+")
    ? "+" + s.slice(1).replace(/\D+/g, "")
    : "+" + s.replace(/\D+/g, "");
  const digits = cleaned.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return "";
  return cleaned;
}

function countTemplateVars(templateBody = "") {
  const matches = templateBody.match(/\{\{\d+\}\}/g) || [];
  const maxIndex = matches
    .map((m) => parseInt(m.replace(/\{|\}/g, ""), 10))
    .reduce((a, b) => Math.max(a, b), 0);
  return maxIndex;
}

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

function chunk(arr, size = 10) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Saludo según hora local
function getTimeGreeting(d = new Date()) {
  const h = d.getHours();
  if (h < 12) return "buen día";
  if (h < 19) return "buenas tardes";
  return "buenas noches";
}

// Si la plantilla ya dice "Hola {{1}}" (o con coma), evitamos duplicar "Hola"
function fallbackForVar1FromTemplateBody(tplBody) {
  const body = String(tplBody || "").toLowerCase();
  const patterns = [
    "hola {{1}}",
    "hola, {{1}}",
    "hola {{1}},",
    "hola,{{1}}",
    "hola,{{1}},",
  ];
  const hasHolaPrefix = patterns.some((p) => body.includes(p));
  return hasHolaPrefix ? "" : getTimeGreeting();
}

// ✅ Sanitización para Meta: sin \n ni tabs dentro del parámetro
function sanitizeParamText(input) {
  if (input === "\u200B") return input;

  let x = String(input ?? "");
  x = x.replace(/\r\n?/g, "\n");
  x = x.replace(/\t+/g, " ");
  x = x.replace(/\n+/g, " ");
  x = x.replace(/ {5,}/g, "    ");
  x = x.replace(/ {2,}/g, " ");
  x = x.trim();

  const MAX_PARAM_LEN = 1000;
  if (x.length > MAX_PARAM_LEN) x = x.slice(0, MAX_PARAM_LEN - 1) + "…";
  return x;
}

function getVarLabel(idx) {
  if (idx === 0) return "{{1}} Cliente (opcional)";
  if (idx === 1) return "{{2}} Vendedora";
  return `{{${idx + 1}}} Promo ${idx - 1}`;
}

function getVarPlaceholder(idx) {
  if (idx === 0) return "Nombre del cliente";
  if (idx === 1) return "Nombre de la vendedora";
  return `Promo ${idx - 1} - Ej: ✳️ LATEX LAVABLE 20Lts + RODILLO + ENDUIDO $35.100`;
}

// ---------- fetch con token ----------
async function authFetch(path, options = {}) {
  const auth = getAuth();
  const user = auth.currentUser;
  const idToken = user ? await user.getIdToken() : null;
  const headers = new Headers(options.headers || {});
  if (idToken) headers.set("Authorization", `Bearer ${idToken}`);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return fetch(api(path), { ...options, headers });
}

// ---------- API ----------
async function sendTemplate({ phone, components = [] }) {
  const resp = await authFetch("/api/send-template", {
    method: "POST",
    body: JSON.stringify({
      phone,
      templateName: LOCKED_TEMPLATE,
      languageCode: LOCKED_LANG,
      components,
    }),
  });

  const text = await resp.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch (e) {
    console.error(e);
  }

  if (!resp.ok) {
    throw new Error(data?.error?.message || data?.error || text || `HTTP ${resp.status}`);
  }
  return data;
}

/**
 * Reglas "enviable" (mismo criterio que el backend):
 * - optIn debe ser true
 * - marketingOptIn:
 *    - true => enviable
 *    - false => NO enviable (opt-out)
 *    - undefined => enviable (compat hacia atrás)
 */
function isRowSendable(r) {
  const optIn = r?.optIn === true;
  const m = r?.marketingOptIn;
  return optIn && (m === true || m === undefined);
}

export default function RemarketingBulk({ onClose }) {
  const [templatesRaw, setTemplatesRaw] = useState([]);
  const [senderInfo, setSenderInfo] = useState(null);
  // eslint-disable-next-line no-unused-vars
  const navigate = useNavigate();

  // --- uid actual (para filtrar por assignedToUid) ---
  const [currentUid, setCurrentUid] = useState(null);
  useEffect(() => {
    const auth = getAuth();
    const unsub = onAuthStateChanged(auth, (u) => setCurrentUid(u?.uid || null));
    return () => unsub();
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await authFetch("/api/templates");
        const t = await r.text();
        const data = t ? JSON.parse(t) : {};
        const arr = Array.isArray(data) ? data : data?.templates || data?.data || [];
        if (!cancelled) setTemplatesRaw(arr || []);
      } catch (e) {
        console.error("fetch /api/templates error:", e);
        if (!cancelled) setTemplatesRaw([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await authFetch("/api/sender");
        const data = await r.json();
        if (!cancelled && r.ok) setSenderInfo(data);
      } catch (e) {
        console.error(e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const approvedTemplates = useMemo(() => {
    return (templatesRaw || []).filter((t) => {
      const st = String(t?.status || "").toUpperCase();
      const statusOk = ["APPROVED", "REINSTATED", "PAUSED", "PENDING", "IN_APPEAL"].includes(st);
      const cat = String(t?.category).toUpperCase() === "MARKETING";
      const lang = t?.language === LOCKED_LANG || t?.language?.code === LOCKED_LANG;
      const name = t?.name === LOCKED_TEMPLATE;
      return statusOk && cat && lang && name;
    });
  }, [templatesRaw]);

  const tpl = approvedTemplates[0] || null;
  const tplBody = useMemo(() => {
    const comp = (tpl?.components || []).find((c) => String(c?.type).toUpperCase() === "BODY");
    return comp?.text || tpl?.body || "";
  }, [tpl]);
  const varCount = countTemplateVars(tplBody);

  // ---------- Variables ----------
  const [mode, setMode] = useState("global");
  const [vars, setVars] = useState(() => Array.from({ length: Math.max(varCount, 1) }, () => ""));
  useEffect(() => {
    setVars(Array.from({ length: Math.max(varCount, 1) }, () => ""));
  }, [varCount]);

  // ---------- Destinatarios ----------
  const [destMode, setDestMode] = useState("tags");
  const [allLabels, setAllLabels] = useState([]);
  const [labelsLoading, setLabelsLoading] = useState(false);
  const [labelsError, setLabelsError] = useState("");
  const [selectedLabels, setSelectedLabels] = useState([]);

  const [tagRowsSendable, setTagRowsSendable] = useState([]);
  const [tagRowsOptInAll, setTagRowsOptInAll] = useState([]);
  const [tagRowsAll, setTagRowsAll] = useState([]);
  const [tagPhonesLoading, setTagPhonesLoading] = useState(false);

  const [includeNoOptIn, setIncludeNoOptIn] = useState(false);
  const [includeNoMarketingOptIn, setIncludeNoMarketingOptIn] = useState(false);

  const [showNumbers, setShowNumbers] = useState(false);

  // selección manual de teléfonos enviables
  const [selectedTagPhones, setSelectedTagPhones] = useState([]);

  const previewRows = useMemo(() => {
    if (includeNoOptIn) return tagRowsAll;
    if (includeNoMarketingOptIn) return tagRowsOptInAll;
    return tagRowsSendable;
  }, [includeNoOptIn, includeNoMarketingOptIn, tagRowsAll, tagRowsOptInAll, tagRowsSendable]);

  const selectedTagPhonesSet = useMemo(() => new Set(selectedTagPhones), [selectedTagPhones]);

  const sendRows = useMemo(() => {
    return tagRowsSendable.filter((r) => selectedTagPhonesSet.has(r.phone));
  }, [tagRowsSendable, selectedTagPhonesSet]);

  const sendPhones = useMemo(() => sendRows.map((r) => r.phone), [sendRows]);

  function toggleTagPhone(phone) {
    setSelectedTagPhones((prev) =>
      prev.includes(phone) ? prev.filter((p) => p !== phone) : [...prev, phone]
    );
  }

  function selectAllSendable() {
    setSelectedTagPhones(tagRowsSendable.map((r) => r.phone));
  }

  function clearSelectedSendable() {
    setSelectedTagPhones([]);
  }

  const numbersText = useMemo(
    () =>
      (previewRows || [])
        .map((r) => {
          const m = r.marketingOptIn;
          const mTxt = m === false ? "✗ sin marketing" : m === true ? "✓ marketing" : "○ marketing (legacy)";
          const oTxt = r.optIn ? "✓ opt-in" : "✗ sin opt-in";
          const sTxt = selectedTagPhonesSet.has(r.phone) ? "✓ seleccionado" : "— no seleccionado";
          return `${r.phone}  ${oTxt}  ${mTxt}  ${sTxt}`;
        })
        .join("\n"),
    [previewRows, selectedTagPhonesSet]
  );

  async function copyNumbersAnnotated() {
    try {
      await navigator.clipboard.writeText(numbersText);
      alert(`Copiado: ${previewRows.length} filas (con estado)`);
    } catch (e) {
      console.error("copy failed", e);
    }
  }

  async function copyOnlySendable() {
    try {
      const plain = (sendRows || []).map((r) => r.phone).join("\n");
      await navigator.clipboard.writeText(plain);
      alert(`Copiado: ${sendRows.length} números seleccionados para enviar`);
    } catch (e) {
      console.error("copy failed", e);
    }
  }

  // eslint-disable-next-line no-unused-vars
  const [rawPhones, setRawPhones] = useState("");
  const numbers = useMemo(() => {
    const rows = rawPhones
      .split(/\n|,|;|\s+/)
      .map((x) => x.trim())
      .filter(Boolean);
    const normed = rows.map(normPhone).filter(Boolean);
    return Array.from(new Set(normed));
  }, [rawPhones]);

  const [csvPreview, setCsvPreview] = useState([]);
  const fileInputRef = useRef(null);

  const onCsvUpload = async (file) => {
    if (!file) return;
    const text = await file.text();
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    const out = [];
    for (const line of lines) {
      const parts = line.split(",").map((x) => x.trim());
      const phone = normPhone(parts[0]);
      if (!phone) continue;
      const item = { phone };
      for (let i = 1; i <= varCount; i++) item[`v${i}`] = parts[i] || "";
      out.push(item);
    }

    setCsvPreview(out);
    setMode("csv");
  };

  // ---------- Confirmaciones ----------
  const [confirmOptIn, setConfirmOptIn] = useState(false);
  const [confirmTemplate, setConfirmTemplate] = useState(false);

  // ---------- Envío ----------
  const [sending, setSending] = useState(false);
  // eslint-disable-next-line no-unused-vars
  const [progress, setProgress] = useState({ sent: 0, ok: 0, fail: 0 });
  const [rowsState, setRowsState] = useState([]);
  const [delayMs, setDelayMs] = useState(800);

  // ---------- Carga de etiquetas (catálogo) ----------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLabelsLoading(true);
        setLabelsError("");

        const base = await listLabels();

        // ✅ deducimos SOLO de conversaciones del vendedor actual (assignedToUid)
        let setSlugs = new Set();
        try {
          if (!currentUid) throw new Error("no-auth");
          const q = query(
            collection(db, "conversations"),
            where("assignedToUid", "==", currentUid),
            orderBy("lastMessageAt", "desc"),
            limit(500)
          );
          const snap = await getDocs(q);
          for (const d of snap.docs) {
            const data = d.data();
            const ls = Array.isArray(data.labels) ? data.labels : [];
            ls.forEach((s) => setSlugs.add(String(s)));
          }
        } catch (e) {
          console.warn("deduce labels from conversations error:", e);
        }

        let arr;
        if (setSlugs.size === 0) {
          arr = (base || []).slice().sort((a, b) =>
            String(a.name || a.slug).localeCompare(String(b.name || b.slug))
          );
        } else {
          const baseMap = new Map();
          for (const l of base || []) baseMap.set(String(l.slug), l);

          const union = new Map();
          for (const slug of Array.from(setSlugs)) {
            const key = String(slug);
            union.set(key, baseMap.get(key) || { slug: key, name: key });
          }

          arr = Array.from(union.values()).sort((a, b) =>
            String(a.name || a.slug).localeCompare(String(b.name || b.slug))
          );
        }

        if (!cancelled) setAllLabels(arr);
      } catch (e) {
        console.error("load labels error:", e);
        if (!cancelled) {
          setLabelsError("No se pudieron cargar las etiquetas.");
          setAllLabels([]);
        }
      } finally {
        if (!cancelled) setLabelsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentUid]);

  // ---------- Buscar conversaciones por etiquetas seleccionadas ----------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!selectedLabels.length || !currentUid) {
          setTagRowsSendable([]);
          setTagRowsOptInAll([]);
          setTagRowsAll([]);
          return;
        }
        setTagPhonesLoading(true);

        // 1) optIn=true (lista "optIn all")
        const byPhoneOptIn = new Map();
        for (const ch of chunk(selectedLabels, 10)) {
          const q1 = query(
            collection(db, "conversations"),
            where("assignedToUid", "==", currentUid),
            where("optIn", "==", true),
            where("labels", "array-contains-any", ch),
            orderBy("lastMessageAt", "desc"),
            limit(1000)
          );
          const snap = await getDocs(q1);
          for (const d of snap.docs) {
            const data = d.data();
            const phone = normPhone(data.contactId || data.phone || d.id);
            if (!phone) continue;

            const t = data.lastMessageAt?.toMillis?.()
              ? data.lastMessageAt.toMillis()
              : data.lastMessageAt
                ? +new Date(data.lastMessageAt)
                : 0;

            const labelsArr = Array.isArray(data.labels) ? data.labels : [];

            byPhoneOptIn.set(phone, {
              phone,
              lastMessageAt: t,
              labels: labelsArr,
              optIn: data.optIn === true,
              marketingOptIn: data.marketingOptIn,
            });
          }
        }

        const optInArr = Array.from(byPhoneOptIn.values()).sort(
          (a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0)
        );
        const sendableArr = optInArr.filter(isRowSendable);

        if (!cancelled) {
          setTagRowsOptInAll(optInArr);
          setTagRowsSendable(sendableArr);
        }

        // 2) total sin opt-in (solo vista previa)
        const byPhoneAll = new Map();
        for (const ch of chunk(selectedLabels, 10)) {
          const q2 = query(
            collection(db, "conversations"),
            where("assignedToUid", "==", currentUid),
            where("labels", "array-contains-any", ch),
            orderBy("lastMessageAt", "desc"),
            limit(1000)
          );
          const snap = await getDocs(q2);
          for (const d of snap.docs) {
            const data = d.data();
            const phone = normPhone(data.contactId || data.phone || d.id);
            if (!phone) continue;

            const t = data.lastMessageAt?.toMillis?.()
              ? data.lastMessageAt.toMillis()
              : data.lastMessageAt
                ? +new Date(data.lastMessageAt)
                : 0;

            const labelsArr = Array.isArray(data.labels) ? data.labels : [];

            byPhoneAll.set(phone, {
              phone,
              lastMessageAt: t,
              labels: labelsArr,
              optIn: data.optIn === true,
              marketingOptIn: data.marketingOptIn,
            });
          }
        }

        const allArr = Array.from(byPhoneAll.values()).sort(
          (a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0)
        );
        if (!cancelled) setTagRowsAll(allArr);
      } catch (e) {
        console.error("search convs by labels error:", e);
        if (!cancelled) {
          setTagRowsSendable([]);
          setTagRowsOptInAll([]);
          setTagRowsAll([]);
        }
      } finally {
        if (!cancelled) setTagPhonesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedLabels, currentUid]);

  useEffect(() => {
    if (destMode === "tags" && mode === "csv") setMode("global");
  }, [destMode, mode]);

  useEffect(() => {
    if (destMode !== "tags") return;
    setSelectedTagPhones(tagRowsSendable.map((r) => r.phone));
  }, [tagRowsSendable, destMode]);

  const totalToSend = useMemo(() => {
    if (destMode === "tags") return sendPhones.length;
    return mode === "global" ? numbers.length : csvPreview.length;
  }, [destMode, sendPhones.length, mode, numbers.length, csvPreview.length]);

  const hasLockedTemplate = Boolean(tpl);

  // ----------- VALIDACIÓN: {{1}} opcional con fallback según hora -----------
  const canSend = useMemo(() => {
    if (!hasLockedTemplate) return false;
    if (!confirmOptIn || !confirmTemplate) return false;

    if (destMode === "tags") {
      if (varCount <= 0) return false;
      return totalToSend > 0 && vars.slice(0, varCount).every((v, i) => (i === 0 ? true : String(v || "").length > 0));
    }

    if (mode === "global") {
      return numbers.length > 0 && vars.slice(0, varCount).every((v, i) => (i === 0 ? true : String(v || "").length > 0));
    }

    if (mode === "csv") {
      return (
        csvPreview.length > 0 &&
        csvPreview.every(
          (r) =>
            r.phone &&
            Array.from({ length: varCount }, (_, i) => r[`v${i + 1}`]).every((x, i) => (i === 0 ? true : (x ?? "").length > 0))
        )
      );
    }

    return false;
  }, [hasLockedTemplate, confirmOptIn, confirmTemplate, destMode, totalToSend, mode, numbers, vars, csvPreview, varCount]);

  const handleSend = async () => {
    if (!canSend || sending) return;
    setSending(true);

    const MAX_PARAM_LEN = 1000;

    const applyFallbackVars = (arr) =>
      arr.slice(0, varCount).map((t, i) => {
        let out;
        if (i === 0) {
          const v = String(t || "").trim();
          const fb = v ? v : fallbackForVar1FromTemplateBody(tplBody);
          out = fb === "" ? "\u200B" : fb;
        } else {
          out = String(t || "");
        }
        if (out.length > MAX_PARAM_LEN) out = out.slice(0, MAX_PARAM_LEN - 1) + "…";
        out = sanitizeParamText(out);
        return out;
      });

    const list =
      destMode === "tags"
        ? sendPhones.map((phone) => ({ phone, vars: applyFallbackVars(vars) }))
        : mode === "global"
          ? numbers.map((phone) => ({ phone, vars: applyFallbackVars(vars) }))
          : csvPreview.map((r) => ({
            phone: r.phone,
            vars: applyFallbackVars(Array.from({ length: varCount }, (_, i) => r[`v${i + 1}`])),
          }));

    setRowsState(list.map((x) => ({ phone: x.phone, status: "pending" })));
    setProgress({ sent: 0, ok: 0, fail: 0 });

    for (let i = 0; i < list.length; i++) {
      const { phone, vars } = list[i];
      try {
        const components = [
          {
            type: "body",
            parameters: vars.map((t) => ({ type: "text", text: String(t) })),
          },
        ];

        await sendTemplate({ phone, components });
        setRowsState((prev) => prev.map((r) => (r.phone === phone ? { ...r, status: "ok" } : r)));
        setProgress((p) => ({ sent: p.sent + 1, ok: p.ok + 1, fail: p.fail }));
      } catch (err) {
        setRowsState((prev) =>
          prev.map((r) => (r.phone === phone ? { ...r, status: "fail", error: String(err?.message || err) } : r))
        );
        setProgress((p) => ({ sent: p.sent + 1, ok: p.ok, fail: p.fail + 1 }));
      }

      await sleep(delayMs || 800);
    }

    setSending(false);
  };

  return (
    <div className="modal modal-open" onClick={onClose}>
      <div
        className="modal-box w-11/12 max-w-6xl p-0 overflow-hidden bg-base-200 text-base-content"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-20 border-b border-base-300 bg-base-200/90 backdrop-blur">
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex items-center justify-center w-10 h-10 rounded-2xl bg-base-300">
                <span className="text-xl">📣</span>
              </div>
              <div className="min-w-0">
                <h2 className="text-base md:text-lg font-bold truncate">
                  Remarketing por Plantilla (WhatsApp)
                </h2>
                <p className="text-xs opacity-70 truncate">
                  Solo envía a contactos <b>enviables</b> y además podés elegir manualmente a quién enviar.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button type="button" className="btn btn-sm btn-ghost" onClick={onClose}>
                ✕
              </button>
            </div>
          </div>

          {/* Subheader / Info */}
          <div className="px-4 pb-3">
            <div className="alert bg-base-300/60 border border-base-300 py-2">
              <div className="text-sm leading-snug">
                Este módulo usa <b>solo</b> la plantilla aprobada{" "}
                <code className="px-1 py-0.5 rounded bg-base-200 border border-base-300">
                  {LOCKED_TEMPLATE}
                </code>{" "}
                (<code className="px-1 py-0.5 rounded bg-base-200 border border-base-300">{LOCKED_LANG}</code>) y envía únicamente a:
                <span className="ml-2">
                  <code className="px-1 py-0.5 rounded bg-base-200 border border-base-300">optIn=true</code>{" "}
                  +{" "}
                  <code className="px-1 py-0.5 rounded bg-base-200 border border-base-300">
                    marketingOptIn=true
                  </code>{" "}
                  (o ausente por legado)
                </span>
              </div>
            </div>

            {senderInfo && (
              <div className="mt-2 text-xs opacity-70">
                Se enviará desde <b>Phone ID</b>:{" "}
                <code className="px-1 py-0.5 rounded bg-base-300 border border-base-300">
                  {senderInfo.phoneId}
                </code>{" "}
                (env:{" "}
                <code className="px-1 py-0.5 rounded bg-base-300 border border-base-300">
                  {senderInfo.phoneEnvKey}
                </code>
                ) — vendedor:{" "}
                <code className="px-1 py-0.5 rounded bg-base-300 border border-base-300">
                  {senderInfo.seller?.email}
                </code>
              </div>
            )}
          </div>
        </div>

        {/* Body scroll */}
        <div className="p-4 space-y-4 max-h-[78vh] overflow-auto">
          {/* Plantilla */}
          <section className="card bg-base-100 border border-base-300 shadow-sm">
            <div className="card-body p-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-semibold">Plantilla</h3>
                <div className="badge badge-ghost">
                  {tpl ? "Disponible" : "No disponible"}
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2 mt-2">
                <div className="space-y-1">
                  <div className="text-xs opacity-70">Idioma</div>
                  <div className="px-3 py-2 rounded-lg bg-base-200 border border-base-300 font-mono text-sm">
                    {LOCKED_LANG}
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="text-xs opacity-70">Plantilla aprobada (MARKETING)</div>
                  <div className="px-3 py-2 rounded-lg bg-base-200 border border-base-300 font-mono text-sm">
                    {tpl ? `${LOCKED_TEMPLATE} · ${LOCKED_LANG}` : "(no disponible / no aprobada)"}
                  </div>
                </div>
              </div>

              {tplBody && tpl && (
                <div className="mt-3 p-3 rounded-xl bg-base-200 border border-base-300">
                  <div className="font-mono whitespace-pre-wrap text-sm">{tplBody}</div>
                  <div className="mt-2 text-xs opacity-70">
                    Variables detectadas en BODY: <b>{varCount}</b>{" "}
                    <span className="ml-1 font-mono">
                      ({Array.from({ length: varCount }).map((_, i) => `{{${i + 1}}}`).join(", ")})
                    </span>
                  </div>
                  <div className="mt-1 text-xs opacity-70">
                    Si <code className="px-1 py-0.5 rounded bg-base-100 border border-base-300">{"{{1}}"}</code> viene vacío, se enviará:{" "}
                    <b>{getTimeGreeting()}</b> (o vacío si el cuerpo ya comienza con <i>Hola + {"{{1}}"}</i>).
                  </div>
                </div>
              )}

              {!tpl && (
                <div className="alert alert-error mt-3">
                  <span>
                    La plantilla <b>{LOCKED_TEMPLATE}</b> ({LOCKED_LANG}) no aparece como <b>APPROVED / MARKETING</b>. Aprobala en tu WABA y recargá.
                  </span>
                </div>
              )}
            </div>
          </section>

          {/* Variables */}
          <section className="card bg-base-100 border border-base-300 shadow-sm">
            <div className="card-body p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="font-semibold">Variables</h3>

                <div className="join">
                  <label className="btn btn-sm join-item">
                    <input
                      type="radio"
                      name="mode"
                      className="radio radio-sm mr-2"
                      value="global"
                      checked={mode === "global"}
                      onChange={() => setMode("global")}
                    />
                    Mismas para todos
                  </label>

                  {destMode === "manual" && (
                    <label className="btn btn-sm join-item">
                      <input
                        type="radio"
                        name="mode"
                        className="radio radio-sm mr-2"
                        value="csv"
                        checked={mode === "csv"}
                        onChange={() => setMode("csv")}
                      />
                      Por fila (CSV)
                    </label>
                  )}
                </div>
              </div>

              {mode === "global" ? (
                <div className="grid gap-3 md:grid-cols-2 mt-3">
                  {Array.from({ length: varCount }).map((_, idx) => (
                    <div key={idx} className={idx >= 2 ? "md:col-span-2" : ""}>
                      <label className="text-xs opacity-70">
                        {getVarLabel(idx)}
                      </label>
                      <input
                        className="input input-bordered w-full mt-1 bg-base-200 border-base-300"
                        placeholder={getVarPlaceholder(idx)}
                        value={vars[idx] || ""}
                        onChange={(e) => {
                          const v = [...vars];
                          v[idx] = e.target.value;
                          setVars(v);
                        }}
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-3 space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="file"
                      accept=".csv"
                      ref={fileInputRef}
                      className="file-input file-input-bordered file-input-sm bg-base-200 border-base-300"
                      onChange={(e) => onCsvUpload(e.target.files?.[0])}
                    />
                    <button
                      type="button"
                      className="btn btn-sm btn-outline"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      Cargar CSV
                    </button>
                  </div>

                  <div className="text-xs opacity-70">
                    Formato: <code className="px-1 py-0.5 rounded bg-base-200 border border-base-300">phone,var1,var2,var3,var4,var5,var6</code> —{" "}
                    <b>v1 puede ir vacío</b> (usa “buen día / buenas tardes / buenas noches”).
                  </div>

                  {csvPreview.length > 0 && (
                    <div className="overflow-auto rounded-xl border border-base-300 max-h-56">
                      <table className="table table-zebra table-sm">
                        <thead>
                          <tr>
                            <th>phone</th>
                            {Array.from({ length: varCount }).map((_, i) => (
                              <th key={i}>{`v${i + 1}`}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {csvPreview.map((r, i) => (
                            <tr key={i}>
                              <td className="font-mono">{r.phone}</td>
                              {Array.from({ length: varCount }).map((_, j) => (
                                <td key={j}>{r[`v${j + 1}`]}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>

          {/* Destinatarios */}
          <section className="card bg-base-100 border border-base-300 shadow-sm">
            <div className="card-body p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="font-semibold">Destinatarios</h3>

                <div className="join">
                  <label className="btn btn-sm join-item">
                    <input
                      type="radio"
                      name="dest"
                      className="radio radio-sm mr-2"
                      value="tags"
                      checked={destMode === "tags"}
                      onChange={() => setDestMode("tags")}
                    />
                    Por etiquetas
                  </label>
                </div>
              </div>

              {destMode === "tags" ? (
                <div className="mt-3 space-y-3">
                  <LabelsBlock
                    labelsLoading={labelsLoading}
                    labelsError={labelsError}
                    allLabels={allLabels}
                    selectedLabels={selectedLabels}
                    setSelectedLabels={setSelectedLabels}
                  />

                  <div className="text-xs opacity-70">
                    Seleccionadas: <b>{selectedLabels.length}</b> · Enviables:{" "}
                    <b>{tagRowsSendable.length}</b> · Marcados para enviar:{" "}
                    <b>{sendRows.length}</b>{" "}
                    <span className="opacity-70">
                      (optIn: {tagRowsOptInAll.length} · total: {tagRowsAll.length})
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-4">
                    <label className="label cursor-pointer justify-start gap-2">
                      <input
                        type="checkbox"
                        className="checkbox checkbox-sm"
                        checked={includeNoMarketingOptIn}
                        onChange={(e) => setIncludeNoMarketingOptIn(e.target.checked)}
                        disabled={includeNoOptIn}
                      />
                      <span className="label-text">
                        Ver coincidencias con <b>marketingOptIn=false</b> (solo vista previa)
                      </span>
                    </label>

                    <label className="label cursor-pointer justify-start gap-2">
                      <input
                        type="checkbox"
                        className="checkbox checkbox-sm"
                        checked={includeNoOptIn}
                        onChange={(e) => setIncludeNoOptIn(e.target.checked)}
                      />
                      <span className="label-text">
                        Ver coincidencias <b>sin</b> opt-in (solo vista previa)
                      </span>
                    </label>
                  </div>

                  {tagPhonesLoading ? (
                    <div className="flex items-center gap-2 text-sm opacity-70">
                      <span className="loading loading-spinner loading-sm"></span>
                      Buscando conversaciones…
                    </div>
                  ) : previewRows.length > 0 ? (
                    <>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          className="btn btn-sm btn-outline"
                          onClick={selectAllSendable}
                          disabled={!tagRowsSendable.length}
                        >
                          Seleccionar todos los enviables
                        </button>

                        <button
                          type="button"
                          className="btn btn-sm btn-ghost"
                          onClick={clearSelectedSendable}
                          disabled={!selectedTagPhones.length}
                        >
                          Limpiar selección
                        </button>
                      </div>

                      <div className="alert bg-base-300/60 border border-base-300 py-2">
                        <span className="text-sm">
                          Se enviará únicamente a <b>{sendRows.length}</b> contactos seleccionados.
                        </span>
                      </div>

                      <PreviewTable
                        rows={previewRows}
                        selectedPhones={selectedTagPhones}
                        onTogglePhone={toggleTagPhone}
                        sendablePhones={tagRowsSendable.map((r) => r.phone)}
                      />

                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          className="btn btn-sm btn-outline"
                          onClick={() => setShowNumbers((v) => !v)}
                        >
                          {showNumbers ? "Ocultar números" : `Ver números (${previewRows.length})`}
                        </button>

                        <button
                          type="button"
                          className="btn btn-sm btn-ghost"
                          onClick={copyNumbersAnnotated}
                          title="Copia teléfono + estado"
                        >
                          Copiar con estado
                        </button>

                        <button
                          type="button"
                          className="btn btn-sm btn-ghost"
                          onClick={copyOnlySendable}
                          title="Copia solo los teléfonos seleccionados para enviar"
                        >
                          Copiar solo números seleccionados
                        </button>
                      </div>

                      {showNumbers && (
                        <textarea
                          readOnly
                          className="textarea textarea-bordered w-full min-h-[160px] font-mono text-sm bg-base-200 border-base-300"
                          value={numbersText}
                          placeholder="No hay coincidencias para las etiquetas seleccionadas."
                        />
                      )}
                    </>
                  ) : (
                    <div className="text-sm opacity-70">Elegí 1+ etiquetas para listar destinatarios.</div>
                  )}
                </div>
              ) : null}
            </div>
          </section>

          {/* Cumplimiento */}
          <section className="card bg-base-100 border border-base-300 shadow-sm">
            <div className="card-body p-4 space-y-2">
              <h3 className="font-semibold">Cumplimiento</h3>

              <label className="label cursor-pointer justify-start gap-3">
                <input
                  type="checkbox"
                  className="checkbox checkbox-sm"
                  checked={confirmOptIn}
                  onChange={(e) => setConfirmOptIn(e.target.checked)}
                />
                <span className="label-text">
                  Confirmo que los contactos tienen permiso para recibir <b>marketing</b> (o modo legado) y se respeta opt-out.
                </span>
              </label>

              <label className="label cursor-pointer justify-start gap-3">
                <input
                  type="checkbox"
                  className="checkbox checkbox-sm"
                  checked={confirmTemplate}
                  onChange={(e) => setConfirmTemplate(e.target.checked)}
                />
                <span className="label-text">
                  Confirmo que usaré <b>la plantilla aprobada</b> por Meta.
                </span>
              </label>
            </div>
          </section>

          {/* Resultado por número */}
          {rowsState.length > 0 && (
            <section className="card bg-base-100 border border-base-300 shadow-sm">
              <div className="card-body p-4">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-semibold">Resultado por número</h3>
                  <div className="badge badge-ghost">{rowsState.length}</div>
                </div>

                <div className="overflow-auto rounded-xl border border-base-300 max-h-96 mt-3">
                  <table className="table table-zebra table-sm">
                    <thead>
                      <tr>
                        <th>Teléfono</th>
                        <th>Estado</th>
                        <th>Detalle</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rowsState.map((r) => (
                        <tr key={r.phone}>
                          <td className="font-mono">{r.phone}</td>
                          <td>
                            {r.status === "pending"
                              ? "⏳ Enviando"
                              : r.status === "ok"
                                ? "✅ OK"
                                : "❌ Error"}
                          </td>
                          <td className="opacity-80">{r.error || ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="mt-3 text-xs opacity-70 space-y-1">
                  <p>💡 Tip: si recibís <code className="px-1 py-0.5 rounded bg-base-200 border border-base-300">429 Too Many Requests</code>, aumentá el delay o dividí en tandas.</p>
                  <p>🔒 Fuera de 24h, <b>solo</b> se pueden enviar <i>template messages</i> aprobados.</p>
                  <p>🛑 Opt-out: si el usuario manda “BAJA/STOP/NO MÁS…”, queda en <code className="px-1 py-0.5 rounded bg-base-200 border border-base-300">marketingOptIn=false</code>.</p>
                </div>
              </div>
            </section>
          )}
        </div>

        {/* Footer sticky actions */}
        <div className="sticky bottom-0 z-20 border-t border-base-300 bg-base-200/90 backdrop-blur">
          <div className="px-4 py-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              className={`btn btn-primary ${(!canSend || sending) ? "btn-disabled" : ""}`}
              disabled={!canSend || sending}
              onClick={handleSend}
            >
              {sending ? (
                <>
                  <span className="loading loading-spinner loading-sm"></span>
                  Enviando…
                </>
              ) : (
                `Enviar a ${totalToSend} contactos`
              )}
            </button>

            {!tpl && (
              <div className="text-sm text-error">
                No se puede enviar: la plantilla bloqueada aún no está aprobada/visible.
              </div>
            )}

            <div className="ml-auto flex items-center gap-2">
              <span className="text-sm opacity-70">Delay</span>
              <input
                type="number"
                min={100}
                step={100}
                className="input input-bordered input-sm w-24 bg-base-200 border-base-300"
                value={delayMs}
                onChange={(e) => setDelayMs(parseInt(e.target.value || "800", 10))}
              />
              <span className="text-sm opacity-70">ms</span>
            </div>
          </div>
        </div>
      </div>

      <div className="modal-backdrop">
        <button onClick={onClose}>close</button>
      </div>
    </div>
  );
}

function LabelsBlock({ labelsLoading, labelsError, allLabels, selectedLabels, setSelectedLabels }) {
  if (labelsLoading) {
    return (
      <div className="flex items-center gap-2 text-sm opacity-70">
        <span className="loading loading-spinner loading-sm"></span>
        Cargando etiquetas…
      </div>
    );
  }
  if (labelsError) return <div className="text-sm text-error">{labelsError}</div>;

  return (
    <div className="rounded-xl border border-base-300 bg-base-200 p-3">
      <div className="grid gap-2 md:grid-cols-3">
        {allLabels.map((l) => {
          const on = selectedLabels.includes(l.slug);
          return (
            <label key={l.slug} className="label cursor-pointer justify-start gap-2">
              <input
                type="checkbox"
                className="checkbox checkbox-sm"
                checked={on}
                onChange={() =>
                  setSelectedLabels((prev) => (on ? prev.filter((s) => s !== l.slug) : [...prev, l.slug]))
                }
              />
              <span className="label-text">{l.name || l.slug}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

function PreviewTable({ rows, selectedPhones = [], onTogglePhone, sendablePhones = [] }) {
  const fmtMkt = (v) => (v === false ? "✗" : v === true ? "✓" : "○");

  const selectedSet = useMemo(() => new Set(selectedPhones), [selectedPhones]);
  const sendableSet = useMemo(() => new Set(sendablePhones), [sendablePhones]);

  return (
    <div className="overflow-auto rounded-xl border border-base-300">
      <table className="table table-zebra table-sm">
        <thead>
          <tr>
            <th>Enviar</th>
            <th>Teléfono (E.164)</th>
            <th>Último mensaje</th>
            <th>Etiquetas</th>
            <th>Opt-in</th>
            <th>Marketing</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const selectable = sendableSet.has(r.phone);
            const checked = selectedSet.has(r.phone);

            return (
              <tr key={r.phone} className={!selectable ? "opacity-60" : ""}>
                <td>
                  <input
                    type="checkbox"
                    className="checkbox checkbox-sm"
                    checked={checked}
                    disabled={!selectable}
                    onChange={() => onTogglePhone?.(r.phone)}
                    title={
                      selectable
                        ? "Incluir en el envío"
                        : "No enviable por reglas de opt-in / marketing"
                    }
                  />
                </td>

                <td className="font-mono">{r.phone}</td>

                <td className="opacity-80">
                  {r.lastMessageAt ? new Date(r.lastMessageAt).toLocaleString() : "—"}
                </td>

                <td className="opacity-80">
                  {(Array.isArray(r.labels) ? r.labels : []).join(", ")}
                </td>

                <td>{r.optIn ? "✓" : "—"}</td>
                <td>{fmtMkt(r.marketingOptIn)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}