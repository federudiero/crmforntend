// src/hooks/useTypingPresence.js
import { useEffect, useRef } from "react";
import { getDatabase, ref, update, onDisconnect, serverTimestamp } from "firebase/database";

/**
 * useTypingPresence(conversationId, userId, typing)
 * - Marca presencia POR CONVERSACIÓN en RTDB:
 *   presence/{conversationId}/{userId} = { online, typing, lastSeen }
 * - Úsalo junto al composer (cuando el agente escribe).
 */
export default function useTypingPresence(conversationId, userId, typing) {
  const prev = useRef(false);

  useEffect(() => {
    if (!conversationId || !userId) return;

    const rtdb = getDatabase();
    const base = ref(rtdb, `presence/${conversationId}/${userId}`);

    // al montar: online true
    update(base, { online: true, typing: false, lastSeen: serverTimestamp() });

    // best-effort desconexión
    onDisconnect(base).update({ online: false, typing: false, lastSeen: serverTimestamp() });

    return () => {
      update(base, { online: false, typing: false, lastSeen: serverTimestamp() });
    };
  }, [conversationId, userId]);

  // actualizar typing sólo si cambió
  useEffect(() => {
    if (!conversationId || !userId) return;
    if (prev.current === typing) return;
    prev.current = typing;

    const rtdb = getDatabase();
    const base = ref(rtdb, `presence/${conversationId}/${userId}`);
    update(base, { typing, online: true, lastSeen: serverTimestamp() });
  }, [conversationId, userId, typing]);
}
