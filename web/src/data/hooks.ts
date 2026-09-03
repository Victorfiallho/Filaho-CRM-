// Thin react-query wrappers around the data/* modules, scoped to the active
// company — the React equivalent of app.js calling `FialhoDB.byCompany(table)`
// on every render.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listAdminUsers } from "./adminUsers";
import { listAuditLog, type AuditLogFilters } from "./auditLog";
import { getCampaignRoi } from "./campaignRoi";
import { listMyMemberships } from "./companies";
import { listCustomers } from "./customers";
import { listFiles } from "./files";
import { getFunnelSummary } from "./funnel";
import { getIntegrationSettings } from "./integrationSettings";
import { listImports } from "./imports";
import { listJobs } from "./jobs";
import { getStagnantLeads } from "./leadInsights";
import { listLeads } from "./leads";
import { listMetaAdsInsights } from "./metaAds";
import { listNotes } from "./notes";
import { getCurrentAppUser, listUsers } from "./users";

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

export function useMetaAdsInsights(companyId: string | null) {
  return useQuery({
    queryKey: ["meta_ads_insights", companyId],
    queryFn: () => listMetaAdsInsights(companyId!),
    enabled: Boolean(companyId)
  });
}

export function useStagnantLeads(companyId: string | null) {
  return useQuery({
    queryKey: ["stagnant-leads", companyId],
    queryFn: () => getStagnantLeads(companyId!),
    enabled: Boolean(companyId)
  });
}

export function useFunnelSummary(companyId: string | null, dateFrom?: string, dateTo?: string) {
  return useQuery({
    queryKey: ["funnel-summary", companyId, dateFrom, dateTo],
    queryFn: () => getFunnelSummary(companyId!, dateFrom, dateTo),
    enabled: Boolean(companyId)
  });
}

export function useCampaignRoi(companyId: string | null, dateFrom: string, dateTo: string) {
  return useQuery({
    queryKey: ["campaign-roi", companyId, dateFrom, dateTo],
    queryFn: () => getCampaignRoi(companyId!, dateFrom, dateTo),
    enabled: Boolean(companyId)
  });
}

export function useAuditLog(companyId: string | null, filters: AuditLogFilters = {}) {
  return useQuery({
    queryKey: ["audit-log", companyId, filters],
    queryFn: () => listAuditLog(companyId!, filters),
    enabled: Boolean(companyId)
  });
}

export function useNotes(companyId: string | null, entityType: string, entityId: string | null) {
  return useQuery({
    queryKey: ["notes", companyId, entityType, entityId],
    queryFn: () => listNotes(companyId!, entityType, entityId!),
    enabled: Boolean(companyId && entityId)
  });
}

export function useFiles(companyId: string | null, entityType: string, entityId: string | null) {
  return useQuery({
    queryKey: ["files", companyId, entityType, entityId],
    queryFn: () => listFiles(companyId!, entityType, entityId!),
    enabled: Boolean(companyId && entityId)
  });
}

// Small, rarely-changing lookup — long staleTime avoids refetching it every
// time a RecordModal opens.
export function useUsers() {
  return useQuery({ queryKey: ["users"], queryFn: listUsers, staleTime: 5 * 60 * 1000 });
}

export function useCurrentAppUser() {
  return useQuery({ queryKey: ["current-app-user"], queryFn: getCurrentAppUser, staleTime: 5 * 60 * 1000 });
}

// Whether the signed-in user owns at least one company — gates the "Users"
// nav link/route the same way web/api/admin-users.js gates the endpoint
// itself, so the link doesn't dead-end non-owners in a 403 page.
export function useIsOwner() {
  const { data: memberships = [], isLoading } = useQuery({
    queryKey: ["my-memberships"],
    queryFn: listMyMemberships,
    staleTime: 5 * 60 * 1000
  });
  return { isOwner: memberships.some(m => m.role === "owner"), isLoading };
}

export function useAdminUsers() {
  return useQuery({ queryKey: ["admin-users"], queryFn: listAdminUsers });
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
