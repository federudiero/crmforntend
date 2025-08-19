// scripts/setAdminClaim.cjs
const { initializeApp, cert } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const serviceAccount = require("./serviceAccountKey.json");

// Inicializa Admin SDK con la service account
initializeApp({ credential: cert(serviceAccount) });

// UID por argumento o variable de entorno
const UID = process.argv[2] || process.env.ADMIN_UID;

if (!UID) {
  console.error("❌ Tenés que pasar un UID como argumento");
  process.exit(1);
}

getAuth()
  .setCustomUserClaims(UID, { admin: true, role: "admin" })
  .then(() => {
    console.log(`✅ Claim aplicada al usuario: ${UID}`);
    console.log("ℹ️ Cerrá sesión en la app y volvé a entrar para refrescar el token.");
  })
  .catch((err) => {
    console.error("❌ Error seteando claim:", err);
    process.exit(1);
  });
