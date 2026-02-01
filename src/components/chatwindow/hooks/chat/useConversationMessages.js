import { useEffect, useState } from "react";
import { collection, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "../../../../firebase";

function sortAscByTs(m1, m2) {
    const t1 = m1?.timestamp?.toMillis?.() ?? (m1?.timestamp ? new Date(m1.timestamp).getTime() : 0);
    const t2 = m2?.timestamp?.toMillis?.() ?? (m2?.timestamp ? new Date(m2.timestamp).getTime() : 0);
    return t1 - t2;
}

export default function useConversationMessages({ conversationId, canRead, messageLimit }) {
    const [msgs, setMsgs] = useState([]);
    const [hasMoreMessages, setHasMoreMessages] = useState(false);

    useEffect(() => {
        if (!conversationId || !canRead) {
            setMsgs([]);
            setHasMoreMessages(false);
            return;
        }

        const colA = collection(db, "conversations", String(conversationId), "messages");
        const colB = collection(db, "conversations", String(conversationId), "msgs");

        const qA = query(colA, orderBy("timestamp", "desc"), limit(messageLimit));
        const qB = query(colB, orderBy("timestamp", "desc"), limit(messageLimit));

        let a = [];
        let b = [];

        const applyMerge = () => {
            const map = new Map();
            for (const m of a) map.set(m.id, m);
            for (const m of b) map.set(m.id, m);

            const arr = Array.from(map.values()).sort(sortAscByTs);

            setHasMoreMessages(arr.length >= messageLimit && (a.length === messageLimit || b.length === messageLimit));
            setMsgs(arr);
        };

        const unsubA = onSnapshot(
            qA,
            (snap) => {
                a = snap.docs.map((d) => ({ id: d.id, __col: "messages", ...d.data() }));
                applyMerge();
            },
            (err) => console.error("onSnapshot(messages) error:", err)
        );

        const unsubB = onSnapshot(
            qB,
            (snap) => {
                b = snap.docs.map((d) => ({ id: d.id, __col: "msgs", ...d.data() }));
                applyMerge();
            },
            (err) => console.error("onSnapshot(msgs) error:", err)
        );

        return () => {
            unsubA?.();
            unsubB?.();
        };
    }, [conversationId, canRead, messageLimit]);

    return { msgs, hasMoreMessages };
}
