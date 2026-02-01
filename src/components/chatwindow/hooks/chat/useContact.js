import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../../../../firebase";

export default function useContact(conversationId) {
    const [contact, setContact] = useState(null);

    useEffect(() => {
        (async () => {
            try {
                if (!conversationId) {
                    setContact(null);
                    return;
                }
                const c = await getDoc(doc(db, "contacts", String(conversationId)));
                setContact(c.exists() ? c.data() : null);
            } catch (e) {
                console.error("get contact error:", e);
                setContact(null);
            }
        })();
    }, [conversationId]);

    return contact;
}
