import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore, doc, setDoc, updateDoc, arrayUnion, getDoc } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getDatabase } from "firebase/database";
import { getMessaging, getToken, onMessage, isSupported } from "firebase/messaging";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
// RTDB (para presencia por conversación)
export const rtdb = getDatabase(app);

// Storage con try/catch (no rompe si no hay bucket)
let storage = null;
try {
  if (firebaseConfig.storageBucket) {
    storage = getStorage(app);
  } else {
    console.warn("Storage bucket no configurado:", firebaseConfig.storageBucket);
  }
} catch (error) {
  console.error("Error inicializando Firebase Storage:", error?.message || error);
}
export { storage };

// =============================
// Firebase Cloud Messaging (FCM)
// =============================
export const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY || "";

/** Asegura que /sw.js esté registrado antes de FCM */
async function ensureServiceWorker() {
  try {
    const existing = await navigator.serviceWorker.getRegistration("/sw.js");
    if (!existing) {
      await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
    }
  } catch (e) {
    console.warn("SW registro/ready falló:", e?.message || e);
  }
}

/** messagingPromise: inicializa FCM si el navegador lo soporta */
export const messagingPromise = (async () => {
  try {
    await ensureServiceWorker();

    const supported = await isSupported();
    if (!supported) {
      console.warn("FCM no soportado por este navegador");
      return null;
    }

    const messaging = getMessaging(app);

    // Listener de mensajes foreground (log base; tu UI puede añadir toasts)
    onMessage(messaging, (payload) => {
      console.log("FCM foreground message", payload);
    });

    return messaging;
  } catch (e) {
    console.warn("Fallo inicializando FCM:", e?.message || e);
    return null;
  }
})();

/** Pide permiso, obtiene token y lo guarda en users/{uid}/meta/push.tokens */
export async function ensurePushToken() {
  try {
    const user = auth.currentUser;
    if (!user) return null;

    const perm = await Notification.requestPermission();
    if (perm !== "granted") return null;

    const messaging = await messagingPromise;
    if (!messaging) return null;

    if (!VAPID_KEY) {
      console.warn("VAPID_KEY faltante: configure VITE_FIREBASE_VAPID_KEY");
      return null;
    }

    const reg = await navigator.serviceWorker.getRegistration("/sw.js");
    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: reg || (await navigator.serviceWorker.ready),
    });
    if (!token) {
      console.log("No se obtuvo token FCM (usuario no concedió permiso)");
      return null;
    }

    const ref = doc(db, "users", user.uid, "meta", "push");
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, { tokens: [token], updatedAt: Date.now() });
    } else {
      await updateDoc(ref, { tokens: arrayUnion(token), updatedAt: Date.now() });
    }
    console.log("[FCM] token ok:", token.slice(0, 10) + "…");
    return token;
  } catch (err) {
    console.warn("[FCM] token error:", err?.message || err);
    return null;
  }
}

/** Suscripción opcional para manejar UI cuando llegan mensajes en foreground */
export async function listenForegroundMessages(onNotify) {
  const messaging = await messagingPromise;
  if (!messaging) return () => {};
  const unsub = onMessage(messaging, (payload) => {
    const n = payload.notification || {};
    const d = payload.data || {};
    onNotify?.({
      title: n.title || "Nuevo mensaje",
      body: n.body || "",
      conversationId: d.conversationId || d.convId || null,
    });
  });
  return unsub;
}
