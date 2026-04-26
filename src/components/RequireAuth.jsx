import { useEffect, useRef, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { collection, doc, onSnapshot, query, where } from "firebase/firestore";
import { signOut } from "firebase/auth";
import { useAuthState } from "../hooks/useAuthState.js";
import { auth, db } from "../firebase";
import NotificationsSetup from "./NotificationsSetup.jsx";
import {
  dedupeVendorRows,
  isEffectivelyActive,
  normalizeEmail,
} from "../lib/userAccess";

export default function RequireAuth() {
  const { user, loading } = useAuthState();
  const loc = useLocation();

  const [accessLoading, setAccessLoading] = useState(true);
  const [allowed, setAllowed] = useState(null);
  const signoutDoneRef = useRef(false);

  useEffect(() => {
    signoutDoneRef.current = false;

    if (!user?.uid) {
      setAccessLoading(false);
      setAllowed(null);
      return;
    }

    setAccessLoading(true);
    setAllowed(null);

    let profile = {};
    let vendorRowsByUid = [];
    let vendorRowsByEmail = [];

    const readiness = {
      profile: false,
      byUid: false,
      byEmail: !normalizeEmail(user.email),
    };

    const publish = () => {
      if (!readiness.profile || !readiness.byUid || !readiness.byEmail) return;

      const linkedRows = dedupeVendorRows([...vendorRowsByUid, ...vendorRowsByEmail]);
      setAllowed(isEffectivelyActive({ profile, vendorRows: linkedRows }));
      setAccessLoading(false);
    };

    const unsubProfile = onSnapshot(
      doc(db, "users", String(user.uid)),
      (snap) => {
        profile = snap.exists() ? snap.data() || {} : {};
        readiness.profile = true;
        publish();
      },
      () => {
        profile = {};
        readiness.profile = true;
        publish();
      }
    );

    const unsubByUid = onSnapshot(
      query(collection(db, "wabaNumbers"), where("ownerUid", "==", String(user.uid))),
      (snap) => {
        vendorRowsByUid = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        readiness.byUid = true;
        publish();
      },
      () => {
        vendorRowsByUid = [];
        readiness.byUid = true;
        publish();
      }
    );

    let unsubByEmail = () => {};
    const normalizedEmail = normalizeEmail(user.email);
    if (normalizedEmail) {
      unsubByEmail = onSnapshot(
        query(collection(db, "wabaNumbers"), where("owner", "==", normalizedEmail)),
        (snap) => {
          vendorRowsByEmail = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          readiness.byEmail = true;
          publish();
        },
        () => {
          vendorRowsByEmail = [];
          readiness.byEmail = true;
          publish();
        }
      );
    }

    return () => {
      unsubProfile();
      unsubByUid();
      unsubByEmail();
    };
  }, [user?.uid, user?.email]);

  useEffect(() => {
    if (loading) return;
    if (!user?.uid) return;
    if (accessLoading) return;
    if (allowed !== false) return;
    if (signoutDoneRef.current) return;

    signoutDoneRef.current = true;
    signOut(auth).catch(() => {});
  }, [loading, user?.uid, accessLoading, allowed]);

  if (loading || (user && accessLoading)) return null;
  if (!user) return <Navigate to="/" replace state={{ from: loc }} />;
  if (allowed === false) return <Navigate to="/" replace state={{ from: loc }} />;
  if (allowed == null) return null;

  return (
    <>
      <NotificationsSetup />
      <Outlet />
    </>
  );
}
