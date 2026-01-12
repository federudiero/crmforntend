// src/components/PresenceBadge.jsx
import React, { useEffect, useState } from "react";
import { getDatabase, ref, onValue } from "firebase/database";

export default function PresenceBadge({ conversationId, contactId }) {
  const [state, setState] = useState({ online: false, typing: false, lastSeen: 0 });

  useEffect(() => {
    if (!conversationId || !contactId) return;
    const rtdb = getDatabase();
    const r = ref(rtdb, `presence/${conversationId}/${contactId}`);
    const off = onValue(r, (snap) => setState(snap.val() || { online: false, typing: false, lastSeen: 0 }));
    return () => off();
  }, [conversationId, contactId]);

  if (state.typing) return <span className="text-xs text-success">escribiendo…</span>;
  if (state.online) return <span className="text-xs text-success">en línea</span>;
  const last = state.lastSeen ? new Date(state.lastSeen).toLocaleString() : "—";
  return <span className="text-xs opacity-60">visto {last}</span>;
}
