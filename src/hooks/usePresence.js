// src/hooks/usePresence.js
import { useEffect, useRef } from "react";
import { auth, db } from "../firebase";
import { onAuthStateChanged } from "firebase/auth";
import { doc, setDoc, updateDoc, serverTimestamp } from "firebase/firestore";

function normalizePhone(s) {
  if (!s) return null;
  const digits = String(s).replace(/\D+/g, "");
  return digits.replace(/^54/, "").replace(/^9(?=\d{10}$)/, "");
}

/**
 * Hook para marcar presencia del vendedor.
 * - online=true al logueo
 * - lastSeen heartbeat cada 45s
 * - offline al cerrar sesión o pestaña
 */
export default function usePresence({ getSellerPhone } = {}) {
  const hbRef = useRef(null);

  useEffect(() => {
    const stop = onAuthStateChanged(auth, async (user) => {
      // limpiamos heartbeat previo
      if (hbRef.current) clearInterval(hbRef.current);
      hbRef.current = null;

      if (!user) return;

      const userRef = doc(db, "users", user.uid);

      // Al logueo: asegurar doc y dejar online=true
      try {
        await setDoc(
          userRef,
          {
            online: true,
            lastSeen: serverTimestamp(),
            email: (user.email || "").toLowerCase() || null,
            phone: normalizePhone(getSellerPhone?.() || null),
            ua: navigator.userAgent || null,
          },
          { merge: true }
        );
      } catch {}

      // Heartbeat cada 45s para mantener lastSeen fresco
      hbRef.current = setInterval(async () => {
        try {
          await updateDoc(userRef, { online: true, lastSeen: serverTimestamp() });
        } catch {}
      }, 45_000);

      // Best-effort: offline al cerrar pestaña
      const onHide = async () => {
        try {
          await updateDoc(userRef, { online: false, lastSeen: serverTimestamp() });
        } catch {}
      };
      window.addEventListener("pagehide", onHide);
      window.addEventListener("beforeunload", onHide);

      // cleanup al cambiar de usuario o desmontar
      return () => {
        window.removeEventListener("pagehide", onHide);
        window.removeEventListener("beforeunload", onHide);
        if (hbRef.current) clearInterval(hbRef.current);
        hbRef.current = null;
      };
    });

    return () => {
      if (hbRef.current) clearInterval(hbRef.current);
      stop && stop();
    };
  }, [getSellerPhone]);
}
