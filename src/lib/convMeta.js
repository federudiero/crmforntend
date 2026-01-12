import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { db } from "../firebase";

/**
 * users/{uid}/convMeta/{convId} = { pinned?: boolean, archived?: boolean, mute?: boolean }
 */
export function convMetaRef(uid, convId) {
  return doc(db, `users/${uid}/convMeta/${convId}`);
}

export async function toggleMeta(uid, convId, key) {
  // key: "pinned" | "archived" | "mute"
  const ref = convMetaRef(uid, convId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, { [key]: true });
  } else {
    const curr = !!(snap.data() && snap.data()[key]);
    await updateDoc(ref, { [key]: !curr });
  }
}
