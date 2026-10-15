import { Navigate, Route, Routes } from "react-router-dom";
import Shell from "./components/Shell";
import AuditLog from "./pages/AuditLog";
import Calendar from "./pages/Calendar";
import CompanyFinancials from "./pages/CompanyFinancials";
import CompanyPicker from "./pages/CompanyPicker";
import Customers from "./pages/Customers";
import Dashboard from "./pages/Dashboard";
import ImportCenter from "./pages/ImportCenter";
import Integrations from "./pages/Integrations";
import Jobs from "./pages/Jobs";
import Login from "./pages/Login";
import MapRoutes from "./pages/MapRoutes";
import Pipeline from "./pages/Pipeline";
import ProjectFinancials from "./pages/ProjectFinancials";
import QuoteEditor from "./pages/QuoteEditor";
import Quotes from "./pages/Quotes";
import Reports from "./pages/Reports";
import ResetPassword from "./pages/ResetPassword";
import Services from "./pages/Services";
import UserManagement from "./pages/UserManagement";
import Profile from "./pages/Profile";
import Messages from "./pages/Messages";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/companies" element={<CompanyPicker />} />
      <Route element={<Shell />}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/pipeline" element={<Pipeline />} />
        <Route path="/quotes" element={<Quotes />} />
        <Route path="/quotes/:quoteId" element={<QuoteEditor />} />
        <Route path="/pipeline/quotes/:quoteId" element={<QuoteEditor />} />
        <Route path="/customers" element={<Customers />} />
        <Route path="/messages" element={<Messages />} />
        <Route path="/jobs" element={<Jobs />} />
        <Route path="/jobs/:jobId/financials" element={<ProjectFinancials />} />
        <Route path="/calendar" element={<Calendar />} />
        <Route path="/map" element={<MapRoutes />} />
        <Route path="/import" element={<ImportCenter />} />
        <Route path="/integrations" element={<Integrations />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/company-financials" element={<CompanyFinancials />} />
        <Route path="/audit-log" element={<AuditLog />} />
        <Route path="/services" element={<Services />} />
        <Route path="/users" element={<UserManagement />} />
        <Route path="/profile" element={<Profile />} />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
