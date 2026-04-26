import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Search,
  ShieldX,
} from "lucide-react";
import { checkTemplateEligibility } from "../services/api.js";

function normPhone(raw) {
  if (!raw) return "";
  const s = String(raw).trim();
  if (!s) return "";

  const cleaned = s.startsWith("+")
    ? "+" + s.slice(1).replace(/\D+/g, "")
    : "+" + s.replace(/\D+/g, "");

  return cleaned;
}

function fmtFlag(v) {
  if (v === true) return "true";
  if (v === false) return "false";
  return "undefined";
}

function getStatusUi(status, canSend) {
  if (canSend) {
    return {
      tone: "alert-success",
      badge: "badge-success",
      Icon: CheckCircle2,
      title:
        status === "sendable_legacy"
          ? "Se puede enviar (legacy)"
          : "Se puede enviar",
    };
  }

  if (status === "opted_out") {
    return {
      tone: "alert-error",
      badge: "badge-error",
      Icon: ShieldX,
      title: "Bloqueado por opt-out",
    };
  }

  if (
    status === "missing_conversation" ||
    status === "missing_optin" ||
    status === "missing_marketing_optin"
  ) {
    return {
      tone: "alert-warning",
      badge: "badge-warning",
      Icon: AlertTriangle,
      title: "No cumple política",
    };
  }

  return {
    tone: "alert-info",
    badge: "badge-info",
    Icon: Search,
    title: "Sin verificar",
  };
}

export default function TemplateEligibilityChecker({
  initialPhone = "",
  templateName = "promo_hogarcril_combos",
  onResult,
  autoCheck = false,
  className = "",
  conversationId = "",
  fromWaPhoneId = "",
}) {
  const [phone, setPhone] = useState(initialPhone || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  useEffect(() => {
    setPhone(initialPhone || "");
  }, [initialPhone]);

  const normalizedPhone = useMemo(() => normPhone(phone), [phone]);
  const ui = getStatusUi(result?.status, result?.canSend);

  async function runCheck(manualPhone) {
    const target = normPhone(manualPhone ?? phone);
    if (!target) {
      setError("Ingresá un número válido.");
      setResult(null);
      onResult?.(null);
      return;
    }

    setLoading(true);
    setError("");

    try {
      const data = await checkTemplateEligibility({
        phone: target,
        templateName,
        conversationId,
        fromWaPhoneId,
      });

      const decorated = {
        ...data,
        checkedPhone: target,
        checkedAt: Date.now(),
      };

      setResult(decorated);
      onResult?.(decorated);
    } catch (e) {
      const msg = e?.message || "No se pudo verificar el permiso.";
      setError(msg);
      setResult(null);
      onResult?.(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!autoCheck) return;
    if (!normalizedPhone || normalizedPhone.replace(/\D/g, "").length < 10) return;

    const t = setTimeout(() => {
      runCheck(normalizedPhone);
    }, 500);

    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoCheck, normalizedPhone, templateName, conversationId, fromWaPhoneId]);

  return (
    <div className={`card bg-base-100 border border-base-300 shadow-sm ${className}`}>
      <div className="gap-3 p-4 card-body">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold">Chequeo de permiso para plantilla</h3>
            <p className="text-sm opacity-70">
              Valida si el número tiene opt-in antes de enviar la plantilla.
            </p>
          </div>
          <div className="badge badge-outline">{templateName}</div>
        </div>

        <div className="flex flex-col gap-2 md:flex-row">
          <input
            type="tel"
            className="w-full input input-bordered"
            placeholder="+5493512345678"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />

          <button
            type="button"
            className={`btn btn-primary ${loading ? "btn-disabled" : ""}`}
            onClick={() => runCheck()}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Search className="w-4 h-4" />
            )}
            Chequear
          </button>
        </div>

        {!!error && (
          <div className="text-sm alert alert-error">
            <span>{error}</span>
          </div>
        )}

        {result && (
          <div className={`alert ${ui.tone} items-start`}>
            <ui.Icon className="w-5 h-5 mt-0.5" />
            <div className="w-full">
              <div className="flex flex-wrap items-center gap-2">
                <strong>{ui.title}</strong>
                <span className={`badge ${ui.badge}`}>{result.status}</span>
              </div>

              <div className="mt-1 text-sm">{result.reason}</div>

              <div className="grid grid-cols-1 gap-2 mt-3 text-sm md:grid-cols-2">
                <div className="p-3 border rounded-lg border-base-300 bg-base-100/70">
                  <div>
                    <b>Número canónico:</b> {result?.phone?.convId || normalizedPhone}
                  </div>
                  <div>
                    <b>optIn:</b> {fmtFlag(result?.conversation?.optIn ?? result?.optIn)}
                  </div>
                  <div>
                    <b>marketingOptIn:</b>{" "}
                    {fmtFlag(
                      result?.conversation?.marketingOptIn ?? result?.marketingOptIn
                    )}
                  </div>
                </div>

                <div className="p-3 border rounded-lg border-base-300 bg-base-100/70">
                  <div>
                    <b>Modo backend:</b>{" "}
                    {result?.policy?.requireMarketingOptIn
                      ? "estricto"
                      : "legacy permitido"}
                  </div>

                  <div>
                    <b>Último inbound:</b>{" "}
                    {result?.conversation?.lastInboundAt
                      ? new Date(result.conversation.lastInboundAt).toLocaleString("es-AR")
                      : "—"}
                  </div>

                  <div>
                    <b>Puede enviar:</b> {result?.canSend ? "Sí" : "No"}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
