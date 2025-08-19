// src/pages/Home.jsx
import { useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { signOut } from "firebase/auth";
import { auth } from "../firebase";
import { useAuthState } from "../hooks/useAuthState.js";

import ConversationsList from "../components/ConversationsList.jsx";
import ChatWindow from "../components/ChatWindow.jsx";
import NewConversation from "../components/NewConversation.jsx";
import AdminPanel from "../components/AdminPanel.jsx";

export default function Home() {
  const { user } = useAuthState();
  const navigate = useNavigate();
  const { convId } = useParams();

  // define admins aquí
  const adminEmails = useMemo(() => ["fede_rudiero@gmail.com"], []);
  const isAdmin = !!user?.email && adminEmails.includes(user.email);

  const openConv = (id) => navigate(`/home/${encodeURIComponent(id)}`);
  const currentConvId = convId ? decodeURIComponent(convId) : null;

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center justify-between p-4 border-b">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold truncate">CRM WhatsApp</h1>
          <p className="text-xs text-gray-500 truncate">
            {user?.email} {isAdmin ? "(admin)" : ""}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {isAdmin ? null : <NewConversation onOpen={openConv} />}
          <button
            className="px-2 py-1 text-sm border rounded"
            onClick={async () => {
              await signOut(auth);
              navigate("/", { replace: true });
            }}
            title="Cerrar sesión"
          >
            Salir
          </button>
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {isAdmin ? (
          <AdminPanel />
        ) : (
          <div className="grid h-full grid-cols-12">
            <aside className="h-full col-span-4 border-r">
              <ConversationsList
                activeId={currentConvId || ""}
                onSelect={openConv}
              />
            </aside>
            <main className="col-span-8">
              {currentConvId ? (
                <ChatWindow conversationId={currentConvId} />
              ) : (
                <div className="flex items-center justify-center h-full text-gray-500">
                  Elegí una conversación o creá una nueva.
                </div>
              )}
            </main>
          </div>
        )}
      </div>
    </div>
  );
}
