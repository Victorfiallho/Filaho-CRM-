// Thin react-query wrappers around the data/* modules, scoped to the active
// company — the React equivalent of app.js calling `FialhoDB.byCompany(table)`
// on every render.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listCustomers } from "./customers";
import { getIntegrationSettings } from "./integrationSettings";
import { listImports } from "./imports";
import { listJobs } from "./jobs";
import { listLeads } from "./leads";

export function useCustomers(companyId: string | null) {
  return useQuery({
    queryKey: ["customers", companyId],
    queryFn: () => listCustomers(companyId!),
    enabled: Boolean(companyId)
  });
}

export function useLeads(companyId: string | null) {
  return useQuery({
    queryKey: ["leads", companyId],
    queryFn: () => listLeads(companyId!),
    enabled: Boolean(companyId)
  });
}

export function useJobs(companyId: string | null) {
  return useQuery({
    queryKey: ["jobs", companyId],
    queryFn: () => listJobs(companyId!),
    enabled: Boolean(companyId)
  });
}

export function useImportsHistory(companyId: string | null) {
  return useQuery({
    queryKey: ["imports", companyId],
    queryFn: () => listImports(companyId!),
    enabled: Boolean(companyId)
  });
}

export function useIntegrationSettings() {
  return useQuery({
    queryKey: ["integration_settings"],
    queryFn: getIntegrationSettings
  });
}

export function useInvalidateCompanyData(companyId: string | null) {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ["customers", companyId] });
    queryClient.invalidateQueries({ queryKey: ["leads", companyId] });
    queryClient.invalidateQueries({ queryKey: ["jobs", companyId] });
    queryClient.invalidateQueries({ queryKey: ["imports", companyId] });
  };
}
