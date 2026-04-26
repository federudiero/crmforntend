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

function isPermissionDenied(error) {
  const code = String(error?.code || "").toLowerCase();
  const message = String(error?.message || "").toLowerCase();
  return code === "permission-denied" || message.includes("missing or insufficient permissions");
}

/**
 * Hook para marcar presencia del vendedor.
 * - online=true al logueo
 * - lastSeen heartbeat cada 45s
 * - offline al cerrar pestaña
 *
 * Importante:
 * - limpia correctamente intervalos y listeners al cambiar auth
 * - evita writes después del logout
 */
export default function usePresence({ getSellerPhone } = {}) {
  const hbRef = useRef(null);
  const detachWindowHandlersRef = useRef(() => {});

  useEffect(() => {
    const clearRuntime = () => {
      if (hbRef.current) {
        clearInterval(hbRef.current);
        hbRef.current = null;
      }

      try {
        detachWindowHandlersRef.current?.();
      } catch (e) {console.warn("usePresence detach window handlers error:", e);
        // no-op
      }

      detachWindowHandlersRef.current = () => {};
    };

    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      // limpiar SIEMPRE lo previo al cambiar auth state
      clearRuntime();

      if (!user?.uid) return;

      const uid = String(user.uid);
      const userRef = doc(db, "users", uid);

      // marcar online al loguear
      void (async () => {
        try {
          const normalizedPhone = normalizePhone(getSellerPhone?.() || null);

          const payload = {
            online: true,
            lastSeen: serverTimestamp(),
            email: (user.email || "").toLowerCase() || null,
            ua: navigator.userAgent || null,
          };

          if (normalizedPhone) {
            payload.phone = normalizedPhone;
          }

          await setDoc(userRef, payload, { merge: true });
        } catch (e) {
          if (!isPermissionDenied(e)) {
            console.error("usePresence setDoc error:", e);
          }
        }
      })();

      // heartbeat cada 45s
      hbRef.current = window.setInterval(() => {
        // si ya no es el mismo usuario autenticado, no escribir
        if (auth.currentUser?.uid !== uid) return;

        void updateDoc(userRef, {
          online: true,
          lastSeen: serverTimestamp(),
        }).catch((e) => {
          if (!isPermissionDenied(e)) {
            console.error("usePresence heartbeat error:", e);
          }
        });
      }, 45_000);

      // best-effort offline al ocultar/cerrar
      const markOffline = () => {
        // si ya cerró sesión, no intentar escribir
        if (auth.currentUser?.uid !== uid) return;

        void updateDoc(userRef, {
          online: false,
          lastSeen: serverTimestamp(),
        }).catch((e) => {
          if (!isPermissionDenied(e)) {
            console.error("usePresence markOffline error:", e);
          }
        });
      };

      window.addEventListener("pagehide", markOffline);
      window.addEventListener("beforeunload", markOffline);

      detachWindowHandlersRef.current = () => {
        window.removeEventListener("pagehide", markOffline);
        window.removeEventListener("beforeunload", markOffline);
      };
    });

    return () => {
      clearRuntime();
      unsubscribeAuth?.();
    };
  }, [getSellerPhone]);
}