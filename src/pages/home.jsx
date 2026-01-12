import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { signOut } from "firebase/auth";
import { auth, db, ensurePushToken, listenForegroundMessages } from "../firebase";
import { doc, onSnapshot, updateDoc, serverTimestamp } from "firebase/firestore";
import { useAuthState } from "../hooks/useAuthState.js";

import usePresence from "../hooks/usePresence";

import ConversationsList from "../components/ConversationsList.jsx";
import ChatWindow from "../components/ChatWindow.jsx";
import NewConversation from "../components/NewConversation.jsx";
import AdminPanel from "../components/AdminPanel.jsx";
import RemarketingBulk from "../components/RemarketingBulk.jsx";

// 👇 NUEVO: import de la Agenda
import AgendaCalendario from "../components/AgendaCalendario.jsx";

export default function Home() {
  const { user } = useAuthState();
  const navigate = useNavigate();
  const { convId } = useParams();

  // activa presencia del vendedor apenas entra a Home (área de vendedor)
  usePresence({
    // si tenés el teléfono del vendedor en algún store/ctx, devolvelo acá (opcional)
    getSellerPhone: () => null,
  });

  // UI local
  const [showRemarketing, setShowRemarketing] = useState(false);

  // 👇 NUEVO: estado para abrir/cerrar la Agenda
  const [showAgenda, setShowAgenda] = useState(false);

  const [currentConvMeta, setCurrentConvMeta] = useState(null);
  const [assignLoading, setAssignLoading] = useState(false);

  // Vista móvil: "list" | "chat"
  const decoded = convId ? decodeURIComponent(convId) : null;
  const [mobileView, setMobileView] = useState(decoded ? "chat" : "list");

  useEffect(() => {
    // si usás daisyUI theme
    document.documentElement.setAttribute("data-theme", "crm");
  }, []);

  // Si cambia la URL (abrís una conversación), en mobile pasamos a "chat"
  useEffect(() => {
    if (decoded) setMobileView("chat");
  }, [decoded]);

  // ESC para cerrar remarketing o agenda
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

  // Suscripción a la conversación actual para verificar permisos
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

  // === NUEVO: Push — token + navegar al tocar la notificación ===
  useEffect(() => {
    if (!user) return;

    // Guarda/actualiza el token FCM del vendedor
    ensurePushToken();

    // Mensajes en foreground (opcional: reemplazá por un toast/badge)
    let unsub = () => {};
    (async () => {
      unsub = await listenForegroundMessages((info) => {
        console.log("[FCM] foreground:", info);
      });
    })();

    // Mensaje del SW para navegar (cuando se toca la notificación)
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

  const adminEmails = useMemo(() => ["alainismael95@gmail.com", "fede_rudiero@gmail.com"], []);
  const isAdmin = !!user?.email && adminEmails.includes(user.email);

  // 🔒 Si el usuario es admin, aseguramos que el modal de remarketing esté cerrado
  useEffect(() => {
    if (isAdmin && showRemarketing) {
      setShowRemarketing(false);
    }
  }, [isAdmin, showRemarketing]);

  // Verificar si el usuario puede acceder a la conversación
  const canAccess = useMemo(() => {
    if (!user || !currentConvMeta) return false;
    if (isAdmin) return true; // Admin puede acceder a todo
    if (currentConvMeta.assignedToUid === user.uid) return true; // Usuario asignado puede acceder
    return false;
  }, [user, currentConvMeta, isAdmin]);

  // Función para asignarse la conversación
  const handleAssignToMe = async () => {
    if (!decoded || !user) return;

    setAssignLoading(true);
    try {
      await updateDoc(doc(db, "conversations", decoded), {
        assignedToUid: user.uid,
        assignedToEmail: user.email,
        assignedAt: serverTimestamp()
      });
    } catch (error) {
      console.error("Error al asignarse la conversación:", error);
    } finally {
      setAssignLoading(false);
    }
  };

  // Renderizar panel de asignación cuando no hay acceso
  const renderAssignPanel = () => (
    <div className="flex items-center justify-center flex-1 p-4 bg-gray-50 dark:bg-gray-900">
      <div className="w-full max-w-md p-6 bg-white border border-gray-200 rounded-lg shadow-lg dark:bg-gray-800 dark:border-gray-700">
        <div className="text-center">
          <div className="flex items-center justify-center w-16 h-16 mx-auto mb-4 bg-yellow-100 rounded-full dark:bg-yellow-900/20">
            <svg className="w-8 h-8 text-yellow-600 dark:text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <h3 className="mb-2 text-lg font-semibold text-gray-900 dark:text-white">
            Chat no asignado
          </h3>
          <p className="mb-6 text-gray-600 dark:text-gray-400">
            Este chat no está asignado a vos. Para poder ver los mensajes y responder, necesitás asignártelo.
          </p>
          <button
            onClick={handleAssignToMe}
            disabled={assignLoading}
            className="w-full px-4 py-2 font-medium text-white transition-colors duration-200 bg-blue-600 rounded-lg hover:bg-blue-700 disabled:bg-blue-400"
          >
            {assignLoading ? "Asignando..." : "Asignarme este chat"}
          </button>
        </div>
      </div>
    </div>
  );

  const openConv = (id) => {
    navigate(`/home/${encodeURIComponent(id)}`);
    setMobileView("chat"); // En móviles, al abrir una conv saltamos al chat
  };

  const currentConvId = decoded;

  // logout del vendedor: marcamos offline antes de salir
  const logoutVendedor = async () => {
    try {
      const uid = auth.currentUser?.uid;
      if (uid) {
        await updateDoc(doc(db, "users", uid), {
          online: false,
          lastSeen: serverTimestamp(),
        });
      }
    } catch (e){console.log(e)}
    await signOut(auth);
    navigate("/", { replace: true });
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center justify-between border-b bg-[#E8F5E9] border-[#CDEBD6] p-3 md:p-4">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold truncate md:text-xl">CRM WhatsApp</h1>
          <p className="text-xs text-gray-500 truncate">
            {user?.email} {isAdmin ? "(admin)" : ""}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Mobile: switch Lista/Chat */}
          {!isAdmin && (
            <div className="join md:hidden">
              <button
                className={
                  "join-item btn btn-xs " +
                  (mobileView === "list"
                    ? "btn-success text-white"
                    : "bg-white text-black border-[#CDEBD6]")
                }
                onClick={() => setMobileView("list")}
                title="Ver lista"
              >
                Lista
              </button>
              <button
                className={
                  "join-item btn btn-xs " +
                  (mobileView === "chat"
                    ? "btn-success text-white"
                    : "bg-white text-black border-[#CDEBD6]")
                }
                onClick={() => setMobileView("chat")}
                title="Ver chat"
              >
                Chat
              </button>
            </div>
          )}

          {/* Botón Remarketing SOLO para no-admin (desktop) */}
          {!isAdmin && (
            <button
              className="hidden px-3 py-1 text-sm border rounded md:inline-flex"
              onClick={() => setShowRemarketing(true)}
              title="Abrir Remarketing por plantillas"
            >
              Remarketing
            </button>
          )}

          {/* 👇 Botón Agenda (desktop) */}
          <button
            className="hidden px-3 py-1 text-sm border rounded md:inline-flex"
            onClick={() => setShowAgenda(true)}
            title="Abrir Agenda del vendedor"
          >
            Agenda
          </button>

          {/* Botones para vendedores (usuarios no-admin) */}
          {!isAdmin && <NewConversation onOpen={openConv} />}

          <button
            className="px-2 py-1 text-sm border rounded"
            onClick={logoutVendedor}
            title="Cerrar sesión"
          >
            Salir
          </button>
        </div>
      </header>

      {/* Contenido */}
      <div className="flex-1 min-h-0">
        {isAdmin ? (
          <AdminPanel />
        ) : (
          <>
            {/* Desktop ≥ md: layout 4/8 clásico */}
            <div className="hidden h-full grid-cols-12 md:grid">
              <aside className="h-full min-h-0 col-span-4 overflow-y-auto border-r">
                <ConversationsList
                  activeId={currentConvId || ""}
                  onSelect={openConv}
                  restrictOthers
                />
              </aside>

              {/* ocupar todo el ancho del slot y ocultar overflow-x */}
              <main className="flex w-full h-full min-h-0 col-span-8 overflow-x-hidden">
                {currentConvId ? (
                  canAccess ? (
                    <ChatWindow
                      key={currentConvId}
                      conversationId={currentConvId}
                      convMeta={currentConvMeta}
                    />
                  ) : (
                    renderAssignPanel()
                  )
                ) : (
                  <div className="flex items-center justify-center flex-1 text-gray-500">
                    Elegí una conversación o creá una nueva.
                  </div>
                )}
              </main>
            </div>

            {/* Mobile ≤ md: panel único conmutado */}
            <div className="h-full md:hidden">
              {/* 👇 Barra superior en móvil: Agenda + Remarketing, lado a lado */}
              <div className="flex gap-2 p-2 border-b">
                <button
                  className="flex-1 btn btn-sm"
                  onClick={() => setShowAgenda(true)}
                  title="Abrir Agenda"
                >
                  Agenda
                </button>
                <button
                  className="flex-1 btn btn-sm"
                  onClick={() => setShowRemarketing(true)}
                  title="Abrir Remarketing por plantillas"
                >
                  Remarketing
                </button>
              </div>

              {mobileView === "list" && (
                <div className="h-full min-h-0 overflow-hidden">
                  <ConversationsList
                    activeId={currentConvId || ""}
                    onSelect={openConv}
                    restrictOthers
                  />
                </div>
              )}
              {mobileView === "chat" && (
                <div className="w-full h-full min-h-0 overflow-x-hidden">
                  {currentConvId ? (
                    canAccess ? (
                      <ChatWindow
                        key={currentConvId}
                        conversationId={currentConvId}
                        convMeta={currentConvMeta}
                        onBack={() => setMobileView("list")}
                        mobile
                      />
                    ) : (
                      renderAssignPanel()
                    )
                  ) : (
                    <div className="flex items-center justify-center h-full p-4 text-center text-gray-500">
                      Abrí una conversación desde <b className="mx-1">Lista</b>.
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Modal Remarketing — SOLO no-admin */}
      {!isAdmin && showRemarketing && (
        <RemarketingBulk onClose={() => setShowRemarketing(false)} />
      )}

      {/* 👇 Modal con AgendaCalendario (responsive, grande) */}
      {showAgenda && (
        <div className="modal modal-open">
          <div className="w-11/12 max-w-6xl modal-box">
            <div className="flex items-center justify-between gap-3 mb-2">
              <h3 className="text-lg font-bold">Agenda del vendedor</h3>
              <button className="btn btn-sm" onClick={() => setShowAgenda(false)} aria-label="Cerrar">✕</button>
            </div>
            {/* Altura grande con scroll interno para que no afecte el layout del chat */}
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
