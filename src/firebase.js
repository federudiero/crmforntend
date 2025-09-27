import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

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
