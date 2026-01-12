import React from "react";

export default function MessageChecks({ status = "sent", readBy }) {
  const tooltip =
    status === "read"
      ? `Leído por ${readBy ? Object.keys(readBy).length : 1}`
      : status === "delivered"
      ? "Entregado"
      : "Enviado";

  return (
    <span className="inline-flex items-center gap-0.5 text-xs opacity-70 select-none" title={tooltip} aria-label={tooltip}>
      {status === "sent" && <span>✓</span>}
      {status === "delivered" && (<><span>✓</span><span>✓</span></>)}
      {status === "read" && (<><span className="text-sky-500">✓</span><span className="text-sky-500">✓</span></>)}
    </span>
  );
}
