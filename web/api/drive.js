// Google Drive for a company's records, one function for both operations
// (Vercel's Hobby plan allows 12 functions):
//
//   POST /api/drive?op=provision   create the client/job folder tree
//   POST /api/drive?op=upload      upload a file into a record's folder
import { query } from "./_lib/http.js";
import provision from "./_lib/driveProvision.js";
import upload from "./_lib/driveUpload.js";

export default async function handler(req, res) {
  const op = query(req).get("op");
  if (op === "provision") return provision(req, res);
  if (op === "upload") return upload(req, res);
  res.status(404).json({ error: "Unknown drive operation." });
}
