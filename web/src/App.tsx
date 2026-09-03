import { Navigate, Route, Routes } from "react-router-dom";
import Shell from "./components/Shell";
import AuditLog from "./pages/AuditLog";
import Calendar from "./pages/Calendar";
import CompanyPicker from "./pages/CompanyPicker";
import Customers from "./pages/Customers";
import Dashboard from "./pages/Dashboard";
import ImportCenter from "./pages/ImportCenter";
import Integrations from "./pages/Integrations";
import Jobs from "./pages/Jobs";
import Login from "./pages/Login";
import MapRoutes from "./pages/MapRoutes";
import Pipeline from "./pages/Pipeline";
import Reports from "./pages/Reports";
import ResetPassword from "./pages/ResetPassword";
import UserManagement from "./pages/UserManagement";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/companies" element={<CompanyPicker />} />
      <Route element={<Shell />}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/pipeline" element={<Pipeline />} />
        <Route path="/customers" element={<Customers />} />
        <Route path="/jobs" element={<Jobs />} />
        <Route path="/calendar" element={<Calendar />} />
        <Route path="/map" element={<MapRoutes />} />
        <Route path="/import" element={<ImportCenter />} />
        <Route path="/integrations" element={<Integrations />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/audit-log" element={<AuditLog />} />
        <Route path="/users" element={<UserManagement />} />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
