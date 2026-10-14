// react-query wrappers around the data/* modules, scoped to the active company.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../state/AuthContext";
import { listAdminUsers } from "./adminUsers";
import { listAuditLog, type AuditLogFilters } from "./auditLog";
import { getCampaignRoi } from "./campaignRoi";
import { listChangeOrders, listChangeOrdersByCompany } from "./changeOrders";
import { listMyMemberships } from "./companies";
import { listCostLineItems, listCostLineItemsByCompany } from "./costLineItems";
import { listCustomers } from "./customers";
import { getFinanceSettings } from "./financeSettings";
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
import { getProjectFinancials, listProjectFinancialsByCompany } from "./projectFinancials";
import { getQuote, listCatalog, listQuotes, listQuotesForLead } from "./quotes";
import { listProfitReleases, listProfitReleasesByCompany } from "./profitReleases";
import { listRefundsByJob } from "./refunds";
import { listTransactionsByCompany, listTransactionsByJob } from "./transactions";
import { listVendors } from "./vendors";
import { getConsentStatuses, listBookingRequests, listConsentRecords } from "./consent";

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

export function useConsentRecords(companyId: string | null, contactId: string | null) {
  return useQuery({
    queryKey: ["consent_records", companyId, contactId],
    queryFn: () => listConsentRecords(companyId!, contactId!),
    enabled: Boolean(companyId && contactId)
  });
}

export function useBookingRequests(companyId: string | null, by: { leadId?: string; customerId?: string }) {
  return useQuery({
    queryKey: ["booking_requests", companyId, by.leadId || "", by.customerId || ""],
    queryFn: () => listBookingRequests(companyId!, by),
    enabled: Boolean(companyId && (by.leadId || by.customerId))
  });
}

export function useConsentStatuses(companyId: string | null) {
  return useQuery({
    queryKey: ["consent_status", companyId],
    queryFn: () => getConsentStatuses(companyId!),
    enabled: Boolean(companyId)
  });
}

// Who is signed in: cached for 5 minutes, so keyed by the auth user and run
// only once a session exists. Unkeyed, a signed-out visit cached "no
// memberships" and the next login lost the owner-only features until reload.
function useSignedInUserId() {
  const { session, loading } = useAuth();
  return { userId: session?.user.id ?? null, authLoading: loading };
}

// Rarely changes; a long staleTime avoids refetching on every modal open.
export function useUsers() {
  const { userId } = useSignedInUserId();
  return useQuery({ queryKey: ["users", userId], queryFn: listUsers, staleTime: 5 * 60 * 1000, enabled: Boolean(userId) });
}

export function useCurrentAppUser() {
  const { userId, authLoading } = useSignedInUserId();
  const query = useQuery({ queryKey: ["current-app-user", userId], queryFn: getCurrentAppUser, staleTime: 5 * 60 * 1000, enabled: Boolean(userId) });
  return { ...query, isLoading: query.isLoading || authLoading };
}

// Whether the user owns at least one company: gates the Users nav item and
// route, matching web/api/admin-users.js.
export function useIsOwner() {
  const { userId, authLoading } = useSignedInUserId();
  const { data: memberships = [], isLoading } = useQuery({
    queryKey: ["my-memberships", userId],
    queryFn: listMyMemberships,
    staleTime: 5 * 60 * 1000,
    enabled: Boolean(userId)
  });
  return { isOwner: memberships.some(m => m.role === "owner"), isLoading: isLoading || authLoading };
}

export function useAdminUsers() {
  return useQuery({ queryKey: ["admin-users"], queryFn: listAdminUsers });
}

// Client-side gate for create/edit/import/export from `users.permissions`.
// Owners always pass, so an empty permissions row never locks them out.
export function usePermissions() {
  const { isOwner, isLoading: ownerLoading } = useIsOwner();
  const { data: currentAppUser, isLoading: profileLoading } = useCurrentAppUser();
  const permissionSet = new Set(currentAppUser?.permissions || []);
  return {
    isOwner,
    isLoading: ownerLoading || profileLoading,
    has: (perm: string) => isOwner || permissionSet.has(perm)
  };
}

export function useFinanceSettings(companyId: string | null) {
  return useQuery({
    queryKey: ["finance-settings", companyId],
    queryFn: () => getFinanceSettings(companyId!),
    enabled: Boolean(companyId)
  });
}

export function useQuotes(companyId: string | null, leadId: string | null) {
  return useQuery({
    queryKey: ["quotes", companyId, leadId],
    queryFn: () => listQuotesForLead(companyId!, leadId!),
    enabled: Boolean(companyId && leadId)
  });
}

export function useAllQuotes(companyId: string | null) {
  return useQuery({
    queryKey: ["quotes", companyId, "all"],
    queryFn: () => listQuotes(companyId!),
    enabled: Boolean(companyId)
  });
}

export function useQuote(companyId: string | null, quoteId: string | null) {
  return useQuery({
    queryKey: ["quote", companyId, quoteId],
    queryFn: () => getQuote(companyId!, quoteId!),
    enabled: Boolean(companyId && quoteId)
  });
}

// The supplier catalog changes once a day at most (the scraper).
export function useCatalog(companyId: string | null) {
  return useQuery({
    queryKey: ["catalog", companyId],
    queryFn: () => listCatalog(companyId!),
    enabled: Boolean(companyId),
    staleTime: 30 * 60 * 1000
  });
}

export function useProjectFinancials(jobId: string | null) {
  return useQuery({
    queryKey: ["project-financials", jobId],
    queryFn: () => getProjectFinancials(jobId!),
    enabled: Boolean(jobId)
  });
}

export function useChangeOrders(jobId: string | null) {
  return useQuery({
    queryKey: ["change-orders", jobId],
    queryFn: () => listChangeOrders(jobId!),
    enabled: Boolean(jobId)
  });
}

export function useCostLineItems(jobId: string | null) {
  return useQuery({
    queryKey: ["cost-line-items", jobId],
    queryFn: () => listCostLineItems(jobId!),
    enabled: Boolean(jobId)
  });
}

export function useVendors(companyId: string | null) {
  return useQuery({
    queryKey: ["vendors", companyId],
    queryFn: () => listVendors(companyId!),
    enabled: Boolean(companyId),
    staleTime: 60 * 1000
  });
}

export function useTransactionsByJob(jobId: string | null) {
  return useQuery({
    queryKey: ["transactions-job", jobId],
    queryFn: () => listTransactionsByJob(jobId!),
    enabled: Boolean(jobId)
  });
}

export function useCompanyTransactions(companyId: string | null) {
  return useQuery({
    queryKey: ["transactions-company", companyId],
    queryFn: () => listTransactionsByCompany(companyId!),
    enabled: Boolean(companyId)
  });
}

export function useRefunds(jobId: string | null) {
  return useQuery({
    queryKey: ["refunds", jobId],
    queryFn: () => listRefundsByJob(jobId!),
    enabled: Boolean(jobId)
  });
}

export function useProfitReleases(jobId: string | null) {
  return useQuery({
    queryKey: ["profit-releases", jobId],
    queryFn: () => listProfitReleases(jobId!),
    enabled: Boolean(jobId)
  });
}

export function useCompanyProjectFinancials(companyId: string | null) {
  return useQuery({
    queryKey: ["project-financials-company", companyId],
    queryFn: () => listProjectFinancialsByCompany(companyId!),
    enabled: Boolean(companyId)
  });
}

export function useCompanyCostLineItems(companyId: string | null) {
  return useQuery({
    queryKey: ["cost-line-items-company", companyId],
    queryFn: () => listCostLineItemsByCompany(companyId!),
    enabled: Boolean(companyId)
  });
}

export function useCompanyChangeOrders(companyId: string | null) {
  return useQuery({
    queryKey: ["change-orders-company", companyId],
    queryFn: () => listChangeOrdersByCompany(companyId!),
    enabled: Boolean(companyId)
  });
}

export function useCompanyProfitReleases(companyId: string | null) {
  return useQuery({
    queryKey: ["profit-releases-company", companyId],
    queryFn: () => listProfitReleasesByCompany(companyId!),
    enabled: Boolean(companyId)
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
