const admin = require("firebase-admin");
const serviceAccount = require("./serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

async function setAdmin(email) {
  try {
    const user = await admin.auth().getUserByEmail(email);
    await admin.auth().setCustomUserClaims(user.uid, {
      admin: true,
      role: "admin",
    });
    console.log(`✅ Claims admin asignados al usuario: ${email}`);
    process.exit(0);
  } catch (err) {
    console.error("❌ Error asignando claims:", err);
    process.exit(1);
  }
}

const email = process.argv[2];
if (!email) {
  console.error("❌ Tenés que pasar un email");
  process.exit(1);
}

setAdmin(email);
