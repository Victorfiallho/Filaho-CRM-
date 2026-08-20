import { createClient } from "@supabase/supabase-js";
import { dynamicAuthStorage } from "./authStorage";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    "Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Copy web/.env.example to web/.env and fill in your Supabase project values."
  );
}

export const supabase = createClient(url, anonKey, {
  auth: { storage: dynamicAuthStorage }
});
