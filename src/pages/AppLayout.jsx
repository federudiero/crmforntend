import { useNavigate, useParams } from "react-router-dom";
import { signOut } from "firebase/auth";
import { auth } from "../firebase";
import { useAuthState } from "../hooks/useAuthState.js";

import ConversationsList from "../components/ConversationsList.jsx";
import ChatWindow from "../components/ChatWindow.jsx";
import NewConversation from "../components/NewConversation.jsx";

export default function AppLayout() {
  const { user } = useAuthState();
  const { convId } = useParams();
  const navigate = useNavigate();

  const openConv = (id) => navigate(`/app/${encodeURIComponent(id)}`);

  return (
    <div className="flex flex-col h-full">
      {/* Topbar global */}
      <header className="flex items-center justify-between p-4 border-b border-gray-200">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold truncate">CRM WhatsApp</h1>
          <p className="text-xs text-gray-500 truncate">{user?.email}</p>
        </div>
        <div className="flex items-center gap-2">
          <NewConversation onOpen={openConv} />
          <button
            className="px-2 py-1 text-sm border rounded"
            onClick={async () => { await signOut(auth); navigate("/", { replace: true }); }}
          >
            Salir
          </button>
        </div>
      </header>

      {/* Contenido: lista + chat */}
      <div className="grid flex-1 min-h-0 grid-cols-12">
        <aside className="min-h-0 col-span-4 overflow-y-auto border-r border-gray-200">
          <ConversationsList activeId={convId || ""} onSelect={openConv} />
        </aside>

        <main className="min-h-0 col-span-8">
          {convId ? (
            <ChatWindow conversationId={decodeURIComponent(convId)} />
          ) : (
            <div className="flex items-center justify-center h-full text-gray-500">
              Elegí una conversación o creá una nueva.
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
