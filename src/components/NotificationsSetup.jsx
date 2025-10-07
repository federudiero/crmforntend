import { useEffect } from "react";
import { messagingPromise } from "../firebase";

export default function NotificationsSetup() {
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const messaging = await messagingPromise;
        if (!mounted) return;
        if (!messaging) return; // no soportado o sin permisos
        // Nada más por ahora; el token ya se solicita en firebase.js
      } catch (e) {
        console.warn("NotificationsSetup error:", e?.message || e);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);
  return null;
}