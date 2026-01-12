import { useState } from "react";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "../firebase";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const submit = async (e) => {
    e?.preventDefault?.();
    setErr("");
    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (e) {
      setErr(e.message || "No se pudo iniciar sesión");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="relative flex items-center justify-center w-full min-h-screen p-6 bg-center bg-cover text-slate-100"
      style={{
        backgroundImage:
          "url('https://res.cloudinary.com/doxadkm4r/image/upload/v1763408194/forest-7601671_1920_c5theu.jpg')",
      }}
    >
      {/* Capa oscura para mejorar contraste */}
      <div className="absolute inset-0 bg-slate-950/70" />

      {/* Decoración de luces de colores */}
      
      {/* Contenido (formulario) */}
      <form
        onSubmit={submit}
        className="relative z-10 w-full max-w-md border shadow-2xl rounded-2xl backdrop-blur-xl border-white/10 bg-white/5"
      >
        {/* Header */}
        <div className="px-6 pt-6 pb-4">
          <div className="flex items-center gap-3">
            <div className="relative w-10 h-10 overflow-hidden shadow-md rounded-xl">
              <img
                src="/icono.jpg"
                alt="Logo CRM"
                className="object-cover w-full h-full"
              />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">CRM</h1>
             
            </div>
          </div>
        </div>

        <div className="px-6">
          {/* Email */}
          <label className="text-sm font-medium text-slate-200">Email</label>
          <div className="relative mt-1">
            <div className="absolute inset-y-0 flex items-center pointer-events-none left-3">
              <span className="text-slate-400">✉️</span>
            </div>
            <input
              type="email"
              className="w-full py-2.5 pl-10 pr-3 rounded-xl border outline-none transition border-white/10 bg-white/5 text-slate-100 placeholder:text-slate-400 focus:ring-2 focus:ring-cyan-400/50 focus:border-cyan-400/40"
              placeholder="tu@email.com"
              autoFocus
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          {/* Password */}
          <div className="mt-4">
            <label className="text-sm font-medium text-slate-200">
              Contraseña
            </label>
            <div className="relative flex items-center mt-1">
              <div className="absolute inset-y-0 flex items-center pointer-events-none left-3">
                <span className="text-slate-400">🔒</span>
              </div>
              <input
                type={show ? "text" : "password"}
                className="w-full py-2.5 pl-10 pr-12 rounded-xl border outline-none transition border-white/10 bg-white/5 text-slate-100 placeholder:text-slate-400 focus:ring-2 focus:ring-fuchsia-400/50 focus:border-fuchsia-400/40"
                placeholder="••••••••"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                onClick={() => setShow((s) => !s)}
                title={show ? "Ocultar contraseña" : "Mostrar contraseña"}
                className="absolute right-2 inline-flex items-center justify-center px-2.5 py-1.5 rounded-lg text-slate-300 transition hover:text-white hover:bg-white/10"
              >
                {show ? "🙈" : "👁️"}
              </button>
            </div>
          </div>

          {/* Error */}
          {err && (
            <div className="px-3 py-2 mt-4 text-sm text-red-200 border border-red-500/40 bg-red-500/10 rounded-xl">
              {err}
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 mt-5 mb-6 font-semibold text-white rounded-xl bg-black shadow-lg shadow-fuchsia-500/20 transition focus:outline-none focus:ring-2 focus:ring-white/40 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? (
              <span className="inline-flex items-center gap-2">
                <svg
                  className="w-4 h-4 animate-spin"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden="true"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                  />
                </svg>
                Ingresando…
              </span>
            ) : (
              "Entrar"
            )}
          </button>
        </div>

        {/* Footer decorativo */}
        <div className="w-full h-2 rounded-b-2xl bg-gradient-to-r from-fuchsia-500 to-cyan-500" />
      </form>
    </div>
  );
}
