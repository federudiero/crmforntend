import { useEffect, useMemo, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../../../../firebase";

export default function useConversationMeta({ conversationId, user }) {
    const [convMeta, setConvMeta] = useState(null);
    const [convSlugs, setConvSlugs] = useState([]);

    useEffect(() => {
        if (!conversationId) return;
        const unsub = onSnapshot(
            doc(db, "conversations", String(conversationId)),
            (snap) => {
                const data = snap.data() || {};
                setConvMeta(data || null);
                setConvSlugs(Array.isArray(data.labels) ? data.labels : []);
            },
            (err) => console.error("onSnapshot(conversation) error:", err)
        );
        return () => unsub();
    }, [conversationId]);

    const isAdmin = useMemo(() => {
        const email = (user?.email || "").toLowerCase();
        return ["federudiero@gmail.com", "alainismael95@gmail.com", "fede_rudiero@gmail.com"].includes(email);
    }, [user?.email]);

    const canRead = useMemo(() => {
        const assignedToUid = convMeta?.assignedToUid || null;
        const assignedEmail = convMeta?.assignedToEmail || convMeta?.assignedEmail || null;
        const assignedList = Array.isArray(convMeta?.assignedTo) ? convMeta.assignedTo : [];

        if (isAdmin) return true;

        const meUid = user?.uid || "";
        const meEmail = (user?.email || "").toLowerCase();

        if (!assignedToUid && !assignedEmail && assignedList.length === 0) return false;

        const emailMatches = typeof assignedEmail === "string" && assignedEmail.toLowerCase() === meEmail;

        const listMatches = assignedList.some((x) => {
            const s = String(x || "");
            return s === meUid || s.toLowerCase() === meEmail;
        });

        return (assignedToUid && assignedToUid === meUid) || emailMatches || listMatches;
    }, [convMeta, user?.uid, user?.email, isAdmin]);

    const canWrite = useMemo(() => !!canRead, [canRead]);

    return { convMeta, convSlugs, canRead, canWrite, isAdmin };
}
