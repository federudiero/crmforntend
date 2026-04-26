import { useEffect, useMemo, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../../../../firebase";
import { isAdminUser } from "../../../../lib/userAccess";

export default function useConversationMeta({ conversationId, user }) {
    const [convMeta, setConvMeta] = useState(null);
    const [convSlugs, setConvSlugs] = useState([]);
    const [userMeta, setUserMeta] = useState(null);

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

    useEffect(() => {
        if (!user?.uid) {
            setUserMeta(null);
            return;
        }

        const unsub = onSnapshot(
            doc(db, "users", String(user.uid)),
            (snap) => setUserMeta(snap.exists() ? snap.data() || {} : {}),
            (err) => {
                console.error("onSnapshot(users/{uid}) error:", err);
                setUserMeta({});
            }
        );

        return () => unsub();
    }, [user?.uid]);

    const isAdmin = useMemo(() => {
        return isAdminUser({ email: user?.email, profile: userMeta });
    }, [user?.email, userMeta]);

    const canRead = useMemo(() => {
        const assignedToUid = convMeta?.assignedToUid || null;
        const assignedEmail = convMeta?.assignedToEmail || convMeta?.assignedEmail || null;
        const assignedList = Array.isArray(convMeta?.assignedTo) ? convMeta.assignedTo : [];

        if (isAdmin) return true;

        const meUid = user?.uid || "";
        const meEmail = String(user?.email || "").toLowerCase();

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
