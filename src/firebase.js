import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
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

// Inicializar Storage solo si el bucket está configurado
let storage = null;
try {
  if (firebaseConfig.storageBucket) {
    console.log("Inicializando Firebase Storage con bucket:", firebaseConfig.storageBucket);
    storage = getStorage(app);
    console.log("Firebase Storage inicializado correctamente");
  } else {
    console.warn("Storage bucket no configurado:", firebaseConfig.storageBucket);
  }
} catch (error) {
  console.error("Error inicializando Firebase Storage:", error.message);
}

export { storage };

// =============================
// Firebase Cloud Messaging (FCM)
// =============================
// Clave VAPID para web push (configurada vía .env)
export const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY || "";

// messagingPromise: inicializa FCM solo si el navegador lo soporta
// y si hay service worker registrado en /sw.js
export const messagingPromise = (async () => {
  try {
    // Registrar Service Worker en "/sw.js" si no está registrado
    try {
      const existing = await navigator.serviceWorker.getRegistration("/sw.js");
      if (!existing) {
        await navigator.serviceWorker.register("/sw.js");
        await navigator.serviceWorker.ready;
      }
    } catch (e) {
      console.warn("SW registro/ready fallo:", e?.message || e);
    }

    const supported = await isSupported();
    if (!supported) {
      console.warn("FCM no soportado por este navegador");
      return null;
    }
    const messaging = getMessaging(app);
    // Intentar obtener token de notificaciones (pide permiso si es necesario)
    if (!VAPID_KEY) {
      console.warn("VAPID_KEY faltante: configure VITE_FIREBASE_VAPID_KEY");
      return messaging;
    }
    try {
      const reg = await navigator.serviceWorker.getRegistration("/sw.js");
      const token = await getToken(messaging, {
        vapidKey: VAPID_KEY,
        serviceWorkerRegistration: reg,
      });
      if (token) {
        console.log("FCM token obtenido", token.slice(0, 10) + "…");
      } else {
        console.log("No se obtuvo token FCM (usuario no concedió permiso)");
      }
    } catch (err) {
      console.warn("Error obteniendo token FCM:", err?.message || err);
    }
    // Listener de mensajes foreground (opcional; los UI pueden suscribirse aparte)
    onMessage(messaging, (payload) => {
      console.log("FCM foreground message", payload);
    });
    return messaging;
  } catch (e) {
    console.warn("Fallo inicializando FCM:", e?.message || e);
    return null;
  }
})();
