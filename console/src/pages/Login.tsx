import { useState, type FormEvent } from "react";
import { KeyRound, LogIn } from "lucide-react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/session";
import type { ApiErr } from "../api/client";

export default function Login() {
  const { meta, principal, login } = useAuth();
  const navigate = useNavigate();
  const [userId, setUserId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (meta?.auth_enabled === false) return <Navigate to="/" replace />;
  if (principal) return <Navigate to="/" replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const id = userId.trim();
    if (!id) return;
    setBusy(true);
    setError("");
    try {
      await login(id);
      navigate("/", { replace: true });
    } catch (err) {
      setError((err as ApiErr).detail ?? "登录失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-carbon px-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-2xl border border-line bg-panel p-6 shadow-2xl"
      >
        <div className="mb-1 flex items-center gap-2 text-lg font-semibold text-ink">
          <KeyRound size={18} className="text-[#00ff99]" />
          ECOS 控制台登录
        </div>
        <p className="mb-5 text-xs text-mute">
          {meta?.auth_mode === "local"
            ? "本地自签模式：输入用户 ID 换取令牌（演示环境）"
            : "企业 IdP 模式：请携带网关下发的 Bearer 令牌"}
        </p>
        <input
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          placeholder="用户 ID，如 operator-1"
          className="mb-3 w-full rounded-xl border border-line bg-carbon px-3.5 py-2.5 text-sm text-ink placeholder:text-mute/60"
          autoFocus
        />
        {meta?.auth_mode === "local" && (
          <div className="mb-3 flex gap-2">
            {["admin-1", "operator-1", "approver-1", "viewer-1"].map((u) => (
              <button
                key={u}
                type="button"
                onClick={() => setUserId(u)}
                className="rounded-lg border border-line px-2 py-1 text-[11px] text-mute hover:text-ink"
              >
                {u}
              </button>
            ))}
          </div>
        )}
        {error && <div className="mb-3 rounded-lg border border-[#E33E3E]/40 bg-[#E33E3E]/10 px-3 py-2 text-xs text-[#E33E3E]">{error}</div>}
        <button
          type="submit"
          disabled={busy || !userId.trim()}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#00ff99] px-4 py-2.5 text-sm font-semibold text-black disabled:opacity-40"
        >
          <LogIn size={15} />
          {busy ? "登录中…" : "登录"}
        </button>
      </form>
    </div>
  );
}
