// Ported verbatim from app.js (cleanCustomer, cleanJob, leadFromCustomer). Only
// mechanical change: `activeCompanyId` / `services()` globals become explicit
// parameters since there's no global app state in the React version.
import { now, uid } from "./format";
import type { Customer, Job, Lead } from "./types";

export function cleanCustomer(record: Partial<Customer> & Record<string, unknown>, companyId: string, defaultServiceType: string): Omit<Customer, "id" | "created_at"> {
  return {
    company_id: companyId,
    name: (record.name as string) || "Unnamed client",
    phone: (record.phone as string) || "",
    email: (record.email as string) || "",
    address: (record.address as string) || "",
    city: (record.city as string) || "",
    state: (record.state as string) || "",
    zip: (record.zip as string) || "",
    status: (record.status as string) || "active",
    service_type: (record.service_type as string) || defaultServiceType || "",
    source: (record.source as string) || "Manual",
    notes: (record.notes as string) || "",
    drive_folder_url: (record.drive_folder_url as string) || "",
    lat: (Number(record.lat) || 0) as number || "",
    lng: (Number(record.lng) || 0) as number || "",
    updated_at: now()
  };
}

export function cleanJob(record: Partial<Job> & Record<string, unknown>, companyId: string, defaultServiceType: string): Omit<Job, "id" | "created_at"> {
  return {
    company_id: companyId,
    customer_id: (record.customer_id as string) || "",
    customer_name: (record.customer_name as string) || "",
    title: (record.title as string) || (record.name as string) || "Calendar event",
    status: (record.status as string) || "scheduled",
    service_type: (record.service_type as string) || defaultServiceType || "",
    scheduled_date: (record.scheduled_date as string) || "",
    estimated_value: Number(record.estimated_value ?? record.value ?? 0) || 0,
    address: (record.address as string) || "",
    city: (record.city as string) || "",
    state: (record.state as string) || "",
    zip: (record.zip as string) || "",
    notes: (record.notes as string) || "",
    source: (record.source as string) || "Manual",
    source_uid: (record.source_uid as string) || "",
    drive_folder_url: (record.drive_folder_url as string) || "",
    lat: (Number(record.lat) || 0) as number || "",
    lng: (Number(record.lng) || 0) as number || "",
    lead_id: (record.lead_id as string) || null,
    updated_at: now()
  };
}

export function leadFromCustomer(customer: Customer): Omit<Lead, "id"> {
  return {
    company_id: customer.company_id,
    customer_id: customer.id,
    name: customer.name,
    phone: customer.phone,
    email: customer.email,
    address: customer.address,
    city: customer.city,
    state: customer.state,
    zip: customer.zip,
    stage_id: "new",
    service_type: customer.service_type,
    value: 0,
    source: customer.source,
    lat: customer.lat || "",
    lng: customer.lng || "",
    created_at: now(),
    updated_at: now()
  } as Omit<Lead, "id">;
}

export { uid };
