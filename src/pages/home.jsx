// src/pages/home.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useNavigationType } from "react-router-dom";
import { signOut } from "firebase/auth";
import { auth, db, ensurePushToken, listenForegroundMessages } from "../firebase";
import { doc, onSnapshot, updateDoc, serverTimestamp } from "firebase/firestore";
import { useAuthState } from "../hooks/useAuthState.js";
import { Menu } from "lucide-react";

import usePresence from "../hooks/usePresence";

import ConversationsList from "../components/ConversationsList.jsx";
import ChatWindow from "../components/chatwindow/ChatWindow.jsx";
import AdminPanel from "../components/AdminPanel.jsx";
import RemarketingBulk from "../components/RemarketingBulk.jsx";
import AgendaCalendario from "../components/AgendaCalendario.jsx";
import {
  getInboxRegionByEmail,
  isConversationAssignedToUser,
  isConversationInRegion,
  isConversationUnassigned,
} from "../lib/inboxRegion.js";

export default function Home() {
  const { user } = useAuthState();
  const navigate = useNavigate();
  const { convId } = useParams();

  const navType = useNavigationType();
  const injectedRef = useRef(false);

  usePresence({
    getSellerPhone: () => null,
  });

  const [showRemarketing, setShowRemarketing] = useState(false);
  const [showAgenda, setShowAgenda] = useState(false);

  const [currentConvMeta, setCurrentConvMeta] = useState(null);
  const [assignLoading, setAssignLoading] = useState(false);

  const decoded = convId ? decodeURIComponent(convId) : null;
  const [mobileView, setMobileView] = useState(decoded ? "chat" : "list");

  useEffect(() => {
    setMobileView(decoded ? "chat" : "list");
  }, [decoded]);

  useEffect(() => {
    if (!decoded) return;
    if (injectedRef.current) return;

    const idx = window.history.state?.idx;

    if (navType === "POP" && (idx === 0 || idx == null)) {
      injectedRef.current = true;

      const chatUrl = `/home/${encodeURIComponent(decoded)}`;

      navigate("/home", { replace: true });
      Promise.resolve().then(() => navigate(chatUrl, { replace: false }));
    }
  }, [decoded, navType, navigate]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") {
        setShowRemarketing(false);
        setShowAgenda(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!decoded) {
      setCurrentConvMeta(null);
      return;
    }

    const unsubscribe = onSnapshot(
      doc(db, "conversations", decoded),
      (docSnap) => {
        if (docSnap.exists()) {
          setCurrentConvMeta({ id: docSnap.id, ...docSnap.data() });
        } else {
          setCurrentConvMeta(null);
        }
      },
      (error) => {
        console.error("Error al suscribirse a conversación:", error);
        setCurrentConvMeta(null);
      }
    );

    return unsubscribe;
  }, [decoded]);

  useEffect(() => {
    if (!user) return;

    ensurePushToken();

    let unsub = () => {};
    (async () => {
      unsub = await listenForegroundMessages((info) => {
        console.log("[FCM] foreground:", info);
      });
    })();

    const onSwMsg = (event) => {
      if (event?.data?.__SW_NAVIGATE__) {
        const url = event.data.__SW_NAVIGATE__;
        navigate(url, { replace: false });
      }
    };

    navigator.serviceWorker?.addEventListener?.("message", onSwMsg);

    return () => {
      unsub?.();
      navigator.serviceWorker?.removeEventListener?.("message", onSwMsg);
    };
  }, [user, navigate]);

  const adminEmails = useMemo(
    () =>
      ["alainismael95@gmail.com", "fede_rudiero@gmail.com"].map((e) =>
        e.toLowerCase()
      ),
    []
  );

  const currentEmail = String(user?.email || "").trim().toLowerCase();
  const currentUid = String(user?.uid || "").trim();

  const isAdmin = !!user?.email && adminEmails.includes(currentEmail);

  const inboxRegion = useMemo(() => getInboxRegionByEmail(currentEmail), [currentEmail]);
  const isRegionalInboxUser = !!inboxRegion;

  useEffect(() => {
    if (isAdmin && showRemarketing) {
      setShowRemarketing(false);
    }
  }, [isAdmin, showRemarketing]);

  const convIsInMyRegion = useMemo(() => {
    if (!currentConvMeta || !inboxRegion) return false;
    return isConversationInRegion(currentConvMeta, inboxRegion);
  }, [currentConvMeta, inboxRegion]);

  const convIsAssignedToMe = useMemo(() => {
    if (!currentConvMeta || !user) return false;
    return isConversationAssignedToUser(currentConvMeta, {
      uid: currentUid,
      email: currentEmail,
    });
  }, [currentConvMeta, user, currentUid, currentEmail]);

  const convIsUnassigned = useMemo(() => {
    if (!currentConvMeta) return false;
    return isConversationUnassigned(currentConvMeta);
  }, [currentConvMeta]);

  const canAccess = useMemo(() => {
    if (!user || !currentConvMeta) return false;
    if (isAdmin) return true;

    if (isRegionalInboxUser) {
      if (!convIsInMyRegion) return false;
      return convIsAssignedToMe;
    }

    return convIsAssignedToMe;
  }, [
    user,
    currentConvMeta,
    isAdmin,
    isRegionalInboxUser,
    convIsInMyRegion,
    convIsAssignedToMe,
  ]);

  const shouldShowAssignPanel = useMemo(() => {
    if (!currentConvMeta || !isRegionalInboxUser) return false;
    return convIsInMyRegion && convIsUnassigned;
  }, [currentConvMeta, isRegionalInboxUser, convIsInMyRegion, convIsUnassigned]);

  const handleAssignToMe = async () => {
    if (!decoded || !user) return;

    setAssignLoading(true);
    try {
      await updateDoc(doc(db, "conversations", decoded), {
        assignedToUid: user.uid,
        assignedToEmail: user.email,
        assignedToName: user.displayName || user.email || "Agente",
        assignedAt: serverTimestamp(),
      });
    } catch (error) {
      console.error("Error al asignarse la conversación:", error);
    } finally {
      setAssignLoading(false);
    }
  };

  const renderAssignPanel = () => (
    <div className="flex items-center justify-center flex-1 p-4 bg-base-200 text-base-content">
      <div className="w-full max-w-md p-6 border shadow-lg bg-base-100 border-base-300 rounded-box">
        <div className="text-center">
          <div className="flex items-center justify-center w-16 h-16 mx-auto mb-4 rounded-full bg-warning text-warning-content">
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"
              />
            </svg>
          </div>

          <h3 className="mb-2 text-lg font-semibold">Chat no asignado</h3>
          <p className="mb-6 opacity-70">
            Este chat no está asignado a vos. Para poder ver los mensajes y responder,
            necesitás asignártelo.
          </p>

          <button
            onClick={handleAssignToMe}
            disabled={assignLoading}
            className={"w-full btn btn-primary " + (assignLoading ? "btn-disabled" : "")}
          >
            {assignLoading ? (
              <>
                <span className="loading loading-spinner loading-sm" />
                Asignando...
              </>
            ) : (
              "Asignarme este chat"
            )}
          </button>
        </div>
      </div>
    </div>
  );

  const renderNoAccessPanel = () => (
    <div className="flex items-center justify-center flex-1 p-4 bg-base-200 text-base-content">
      <div className="w-full max-w-md p-6 text-center border shadow-lg bg-base-100 border-base-300 rounded-box">
        <h3 className="mb-2 text-lg font-semibold">Sin acceso</h3>
        <p className="opacity-70">
          Este chat no pertenece a tu región o está asignado a otro vendedor.
        </p>
      </div>
    </div>
  );

  const openConv = (id) => {
    navigate(`/home/${encodeURIComponent(id)}`, { replace: false });
  };

  const currentConvId = decoded;
  const hideMobileTopHeader = !isAdmin && mobileView === "chat" && !!decoded;

  const logoutVendedor = async () => {
    try {
      const uid = auth.currentUser?.uid;
      if (uid) {
        await updateDoc(doc(db, "users", uid), {
          online: false,
          lastSeen: serverTimestamp(),
        });
      }
    } catch (e) {
      console.log(e);
    }

    await signOut(auth);
    navigate("/", { replace: true });
  };

  const renderConversationList = () => {
    return (
      <ConversationsList
        activeId={currentConvId || ""}
        onSelect={openConv}
        allowedPhoneIds={inboxRegion?.phoneIds || []}
        allowedEmails={inboxRegion?.emails || []}
        title={inboxRegion?.label || "Conversaciones"}
      />
    );
  };

  return (
    <div className="flex flex-col h-full bg-base-200 text-base-content">
      <header
        className={
          (hideMobileTopHeader ? "hidden md:flex " : "flex ") +
          "items-center justify-between p-3 border-b md:p-4 bg-base-100 border-base-300"
        }
      >
        <div className="min-w-0">
          <h1 className="text-lg font-semibold truncate md:text-xl">CRM WhatsApp</h1>
          <p className="text-xs truncate opacity-60">
            {user?.email} {isAdmin ? "(admin)" : ""}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {!isAdmin && (
            <div className="join md:hidden">
              <button
                className={
                  "join-item btn btn-xs " +
                  (mobileView === "list" ? "btn-primary" : "btn-outline")
                }
                onClick={() => navigate("/home", { replace: false })}
                title="Ver lista"
              >
                Lista
              </button>

              <button
                className={
                  "join-item btn btn-xs " +
                  (mobileView === "chat" ? "btn-primary" : "btn-outline")
                }
                onClick={() => {
                  if (currentConvId) {
                    navigate(`/home/${encodeURIComponent(currentConvId)}`, {
                      replace: false,
                    });
                  } else {
                    navigate("/home", { replace: false });
                  }
                }}
                title="Ver chat"
              >
                Chat
              </button>
            </div>
          )}

          {!isAdmin && (
            <button
              className="hidden btn btn-sm btn-outline md:inline-flex"
              onClick={() => setShowRemarketing(true)}
              title="Abrir Remarketing por plantillas"
            >
              Remarketing
            </button>
          )}

          <button
            className="hidden btn btn-sm btn-outline md:inline-flex"
            onClick={() => setShowAgenda(true)}
            title="Abrir Agenda del vendedor"
          >
            Agenda
          </button>

          {!isAdmin && (
            <div className="dropdown dropdown-end md:hidden">
              <label tabIndex={0} className="btn btn-sm btn-outline btn-square" title="Menú">
                <Menu className="w-5 h-5" />
              </label>

              <ul
                tabIndex={0}
                className="dropdown-content z-[100] menu menu-sm mt-3 p-2 shadow bg-base-100 rounded-box w-56 border border-base-300"
              >
                <li>
                  <button onClick={() => setShowAgenda(true)} type="button">
                    Agenda
                  </button>
                </li>

                <li>
                  <button onClick={() => setShowRemarketing(true)} type="button">
                    Remarketing
                  </button>
                </li>

                <li className="my-1 border-t border-base-300" />

                <li>
                  <button onClick={logoutVendedor} type="button">
                    Salir
                  </button>
                </li>
              </ul>
            </div>
          )}

          <button
            className="hidden btn btn-sm btn-outline md:inline-flex"
            onClick={logoutVendedor}
            title="Cerrar sesión"
          >
            Salir
          </button>
        </div>
      </header>

      <div className="flex-1 min-h-0">
        {isAdmin ? (
          <AdminPanel />
        ) : (
          <>
            {/* Desktop */}
            <div className="hidden h-full grid-cols-12 md:grid">
              <aside className="h-full min-h-0 col-span-4 overflow-hidden border-r bg-base-100 border-base-300">
                {renderConversationList()}
              </aside>

              <main className="flex w-full h-full min-h-0 col-span-8 overflow-x-hidden bg-base-100">
                {currentConvId ? (
                  canAccess ? (
                    <ChatWindow
                      key={currentConvId}
                      conversationId={currentConvId}
                      convMeta={currentConvMeta}
                    />
                  ) : shouldShowAssignPanel ? (
                    renderAssignPanel()
                  ) : (
                    renderNoAccessPanel()
                  )
                ) : (
                  <div className="flex items-center justify-center flex-1 opacity-60">
                    Elegí una conversación.
                  </div>
                )}
              </main>
            </div>

            {/* Mobile */}
            <div className="h-full md:hidden">
              <div
                className={
                  "h-full min-h-0 overflow-hidden bg-base-100 " +
                  (mobileView === "list" ? "" : "hidden")
                }
              >
                {renderConversationList()}
              </div>

              <div
                className={
                  "h-full min-h-0 w-full overflow-x-hidden bg-base-100 " +
                  (mobileView === "chat" ? "" : "hidden")
                }
              >
                {currentConvId ? (
                  canAccess ? (
                    <ChatWindow
                      key={currentConvId}
                      conversationId={currentConvId}
                      convMeta={currentConvMeta}
                      onBack={() => navigate("/home", { replace: false })}
                      mobile
                    />
                  ) : shouldShowAssignPanel ? (
                    renderAssignPanel()
                  ) : (
                    renderNoAccessPanel()
                  )
                ) : (
                  <div className="flex items-center justify-center h-full p-4 text-center opacity-60">
                    Abrí una conversación desde <b className="mx-1">Lista</b>.
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {!isAdmin && showRemarketing && (
        <RemarketingBulk onClose={() => setShowRemarketing(false)} />
      )}

      {showAgenda && (
        <div className="modal modal-open">
          <div className="w-11/12 max-w-6xl modal-box">
            <div className="flex items-center justify-between gap-3 mb-2">
              <h3 className="text-lg font-bold">Agenda del vendedor</h3>
              <button
                className="btn btn-sm btn-outline"
                onClick={() => setShowAgenda(false)}
                aria-label="Cerrar"
              >
                ✕
              </button>
            </div>

            <div className="h-[70vh] overflow-auto">
              <AgendaCalendario />
            </div>
          </div>

          <div className="modal-backdrop" onClick={() => setShowAgenda(false)}>
            <button>close</button>
          </div>
        </div>
      )}
    </div>
  );
}