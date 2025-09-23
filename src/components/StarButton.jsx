import React, { useEffect, useState } from "react";
import { useDestacadosChat } from "../hooks/useDestacadosChat";

export default function StarButton({ chatId, messageId, texto }) {
  const { estaDestacado, onToggle, ready } = useDestacadosChat(chatId);
  const [destacado, setDestacado] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let m = true;
    (async () => {
      if (!ready) return;
      const st = await estaDestacado(messageId);
      if (m) setDestacado(!!st.existe);
    })();
    return () => { m = false; };
  }, [chatId, messageId, ready, estaDestacado]);

  const handleClick = async () => {
    if (loading || !ready) return;
    setLoading(true);
    try {
      const final = await onToggle({ messageId, texto });
      setDestacado(final);
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      className={`btn btn-ghost btn-xs ${destacado ? "text-yellow-500" : "text-base-content/60"}`}
      onClick={handleClick}
      title={destacado ? "Quitar de destacados" : "Agregar a destacados"}
      disabled={loading || !ready}
    >
      {destacado ? "⭐" : "☆"}
    </button>
  );
}
