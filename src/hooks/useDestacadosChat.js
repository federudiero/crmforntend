import { useEffect, useState, useCallback, useMemo } from "react";
import { useAuthState } from "./useAuthState.js";
import {
  listarDestacadosDeUsuario,
  buscarDestacado,
  toggleDestacado,
  eliminarDestacado,
} from "../services/destacados.service";

export function useDestacadosChat(chatId) {
  const { user } = useAuthState();
  const userEmail = useMemo(() => (user?.email || "").toLowerCase(), [user?.email]);
  const userUid = user?.uid || "";
  const ready = !!userUid; // trabajamos con UID (email puede venir vacío)

  const [items, setItems] = useState([]);
  const [cargando, setCargando] = useState(true);

  const cargar = useCallback(async () => {
    if (!chatId || !ready) return;
    setCargando(true);
    const data = await listarDestacadosDeUsuario({ chatId, userEmail, userUid });
    data.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    setItems(data);
    setCargando(false);
  }, [chatId, ready, userEmail, userUid]);

  useEffect(() => { cargar(); }, [cargar]);

  const estaDestacado = async (messageId) => {
    if (!ready) return { existe: false, docId: null };
    return await buscarDestacado({ chatId, userEmail, userUid, messageId });
  };

  const onToggle = async ({ messageId, texto }) => {
    if (!ready) return false;
    const final = await toggleDestacado({ chatId, userEmail, userUid, messageId, texto });
    await cargar();
    return final;
  };

  const quitar = async (docId) => {
    if (!ready) return;
    await eliminarDestacado({ chatId, docId });
    setItems((prev) => prev.filter((i) => i.id !== docId));
  };

  return { items, cargando, cargar, estaDestacado, onToggle, quitar, userEmail, userUid, ready };
}
