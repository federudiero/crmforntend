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
    <div className="flex justify-center items-center p-6 w-full min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-slate-100">
      {/* Decoración de fondo */}
      <div className="overflow-hidden absolute inset-0 pointer-events-none">
        <div className="absolute -top-24 -left-24 w-72 h-72 rounded-full blur-3xl bg-fuchsia-500/20" />
        <div className="absolute -right-24 -bottom-24 w-72 h-72 rounded-full blur-3xl bg-cyan-500/20" />
      </div>

      <form
        onSubmit={submit}
        className="relative w-full max-w-md rounded-2xl border shadow-2xl backdrop-blur-xl border-white/10 bg-white/5"
      >
        {/* Header */}
        <div className="px-6 pt-6 pb-4">
          <div className="flex gap-3 items-center">
            <div className="relative w-10 h-10 rounded-xl shadow-md overflow-hidden">
              <img 
                src="/icono.jpg" 
                alt="Logo CRM" 
                className="w-full h-full object-cover"
              />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Ingresá</h1>
              <p className="text-sm text-slate-300">Con tu usuario de Firebase</p>
            </div>
          </div>
        </div>

        <div className="px-6">
          {/* Email */}
          <label className="text-sm font-medium text-slate-200">Email</label>
          <div className="relative mt-1">
            <div className="flex absolute inset-y-0 left-3 items-center pointer-events-none">
              <span className="text-slate-400">✉️</span>
            </div>
            <input
              type="email"
              className="py-2.5 pr-3 pl-10 w-full rounded-xl border transition outline-none border-white/10 bg-white/5 text-slate-100 placeholder:text-slate-400 focus:ring-2 focus:ring-cyan-400/50 focus:border-cyan-400/40"
              placeholder="tu@email.com"
              autoFocus
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          {/* Password */}
          <div className="mt-4">
            <label className="text-sm font-medium text-slate-200">Contraseña</label>
            <div className="flex relative items-center mt-1">
              <div className="flex absolute inset-y-0 left-3 items-center pointer-events-none">
                <span className="text-slate-400">🔒</span>
              </div>
              <input
                type={show ? "text" : "password"}
                className="py-2.5 pr-12 pl-10 w-full rounded-xl border transition outline-none border-white/10 bg-white/5 text-slate-100 placeholder:text-slate-400 focus:ring-2 focus:ring-fuchsia-400/50 focus:border-fuchsia-400/40"
                placeholder="••••••••"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                onClick={() => setShow((s) => !s)}
                title={show ? "Ocultar contraseña" : "Mostrar contraseña"}
                className="inline-flex absolute right-2 justify-center items-center px-2.5 py-1.5 rounded-lg transition text-slate-300 hover:text-white hover:bg-white/10"
              >
                {show ? "🙈" : "👁️"}
              </button>
            </div>
          </div>

          {/* Error */}
          {err && (
            <div className="px-3 py-2 mt-4 text-sm text-red-200 rounded-xl border border-red-500/40 bg-red-500/10">
              {err}
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={loading}
            className="py-2.5 mt-5 mb-6 w-full font-semibold text-white bg-gradient-to-r from-fuchsia-500 to-cyan-500 rounded-xl shadow-lg transition shadow-fuchsia-500/20 disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-white/40"
          >
            {loading ? (
              <span className="inline-flex gap-2 items-center">
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
        <div className="w-full h-2 bg-gradient-to-r from-fuchsia-500 to-cyan-500 rounded-b-2xl" />
      </form>
    </div>
  );
}
