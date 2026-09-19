import { Routes, Route, Navigate } from "react-router-dom";
import Shell from "./components/Shell";
import { useAuth } from "./auth/session";
import Login from "./pages/Login";
import Overview from "./pages/Overview";
import Stores from "./pages/Stores";
import Research from "./pages/Research";
import Analytics from "./pages/Analytics";
import Insights from "./pages/Insights";
import Competitors from "./pages/Competitors";
import Studio from "./pages/Studio";
import Publish from "./pages/Publish";
import Assets from "./pages/Assets";
import Tasks from "./pages/Tasks";
import Connectors from "./pages/Connectors";
import Accounts from "./pages/Accounts";
import Distribute from "./pages/Distribute";
import Editing from "./pages/Editing";
import AfterSales from "./pages/AfterSales";

function RequireAuth({ children }: { children: JSX.Element }) {
  const { meta, principal, ready } = useAuth();
  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-carbon text-sm text-mute">
        正在连接 ECOS 服务…
      </div>
    );
  }
  if (meta?.auth_enabled && !principal) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <RequireAuth>
            <Shell />
          </RequireAuth>
        }
      >
        <Route path="/" element={<Overview />} />
        <Route path="/stores" element={<Stores />} />
        <Route path="/research" element={<Research />} />
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/insights" element={<Insights />} />
        <Route path="/competitors" element={<Competitors />} />
        <Route path="/studio" element={<Studio />} />
        <Route path="/publish" element={<Publish />} />
        <Route path="/assets" element={<Assets />} />
        <Route path="/editing" element={<Editing />} />
        <Route path="/after-sales" element={<AfterSales />} />
        <Route path="/tasks" element={<Tasks />} />
        <Route path="/connectors" element={<Connectors />} />
        <Route path="/accounts" element={<Accounts />} />
        <Route path="/distribute" element={<Distribute />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
