import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { listMyCompanies } from "../data/companies";
import { listServices } from "../data/services";
import { listStages } from "../data/stages";
import type { Company, PipelineStage } from "../domain/types";
import { useAuth } from "./AuthContext";

const ACTIVE_COMPANY_KEY = "fialho_active_company_id";

interface CompanyContextValue {
  companies: Company[];
  companiesLoading: boolean;
  activeCompanyId: string | null;
  activeCompany: Company | null;
  selectCompany: (id: string) => void;
  clearCompany: () => void;
  stages: PipelineStage[];
  services: string[];
}

const CompanyContext = createContext<CompanyContextValue | null>(null);

export function CompanyProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const [activeCompanyId, setActiveCompanyId] = useState<string | null>(() => localStorage.getItem(ACTIVE_COMPANY_KEY));

  const { data: companies = [], isLoading: companiesLoading } = useQuery({
    queryKey: ["companies", session?.user.id],
    queryFn: listMyCompanies,
    enabled: Boolean(session)
  });

  const { data: stages = [] } = useQuery({
    queryKey: ["stages", activeCompanyId],
    queryFn: () => listStages(activeCompanyId!),
    enabled: Boolean(activeCompanyId)
  });

  const { data: services = [] } = useQuery({
    queryKey: ["services", activeCompanyId],
    queryFn: () => listServices(activeCompanyId!),
    enabled: Boolean(activeCompanyId)
  });

  useEffect(() => {
    if (!session) {
      setActiveCompanyId(null);
      localStorage.removeItem(ACTIVE_COMPANY_KEY);
    }
  }, [session]);

  const selectCompany = (id: string) => {
    setActiveCompanyId(id);
    localStorage.setItem(ACTIVE_COMPANY_KEY, id);
  };

  const clearCompany = () => {
    setActiveCompanyId(null);
    localStorage.removeItem(ACTIVE_COMPANY_KEY);
    queryClient.removeQueries({ queryKey: ["stages"] });
    queryClient.removeQueries({ queryKey: ["services"] });
  };

  const activeCompany = companies.find(c => c.id === activeCompanyId) || null;

  return (
    <CompanyContext.Provider
      value={{ companies, companiesLoading, activeCompanyId, activeCompany, selectCompany, clearCompany, stages, services }}
    >
      {children}
    </CompanyContext.Provider>
  );
}

export function useCompany() {
  const ctx = useContext(CompanyContext);
  if (!ctx) throw new Error("useCompany must be used within CompanyProvider");
  return ctx;
}
