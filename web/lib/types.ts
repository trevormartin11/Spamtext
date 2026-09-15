export type ReportKind = "sms" | "call" | "voicemail";
export type ReportStatus = "received" | "identifying" | "identified" | "needs_identification" | "closed" | "error";
export type ComplaintAgency = "ftc" | "fcc" | "dnc";
export type ComplaintStatus = "pending" | "running" | "submitted" | "failed" | "manual" | "skipped";
export type ClaimStatus =
  | "assessing" | "not_yet_viable" | "demand_hold" | "demand_sent" | "awaiting_response"
  | "responded" | "small_claims_ready" | "filed" | "settled" | "closed";

export interface MailingAddress {
  line1: string; line2?: string; city: string; state: string; zip: string; country?: string; source?: string;
}

export interface Entity {
  id: string; name: string; aliases: string[]; domain: string | null; website: string | null;
  email: string | null; phone: string | null; mailing_address: MailingAddress | null;
  registered_agent: { name: string; address: string; source?: string } | null;
  az_sos_registered: boolean | null; confidence: number; sources: { type: string; url?: string; note?: string }[];
  notes: string | null; manual: boolean; created_at: string; updated_at: string;
}

export interface Sender {
  id: string; phone: string; is_short_code: boolean; line_type: string | null; carrier: string | null;
  caller_name: string | null; lookup_json: unknown; looked_up_at: string | null; entity_id: string | null;
}

export interface Extraction {
  is_marketing: boolean;
  category: string;
  company_name: string | null;
  brand_mentions: string[];
  urls: string[];
  domains: string[];
  opt_out_offered: boolean;
  identifies_sender: boolean;
  summary: string;
}

export interface Report {
  id: string; kind: ReportKind; sender_phone: string; sender_id: string | null; body: string | null;
  audio_path: string | null; received_at: string; duration_seconds: number | null; prerecorded: boolean | null;
  forwarded_7726: boolean; forwarded_7726_at: string | null; device_id: string | null; dedupe_key: string;
  status: ReportStatus; is_marketing: boolean | null; category: string | null; extracted: Extraction | null;
  error: string | null; created_at: string; updated_at: string;
}

export interface ComplaintJob {
  id: string; report_id: string; agency: ComplaintAgency; status: ComplaintStatus; attempts: number;
  run_after: string; confirmation: string | null; screenshot_path: string | null; error: string | null;
}

export interface ClaimBasis {
  tcpa_c5: boolean;      // 47 U.S.C. 227(c)(5) - Do Not Call, >=2 in 12 months
  tcpa_b3: boolean;      // 47 U.S.C. 227(b)(3) - prerecorded/artificial voice
  cfr_1200d: boolean;    // 47 C.F.R. 64.1200(d) - internal DNC / identification failures
  az_1282: boolean;      // A.R.S. 44-1282 (AG-enforced; cited as supporting)
  dnc_eligible: boolean;
  reasons: string[];
}

export interface Claim {
  id: string; entity_id: string | null; sender_phone: string | null; status: ClaimStatus; violation_count: number;
  basis: ClaimBasis; estimated_min_cents: number; estimated_max_cents: number; demand_amount_cents: number | null;
  demand_letter_path: string | null; demand_hold_until: string | null; demand_sent_at: string | null;
  demand_channel: string | null; lob_letter_id: string | null; lob_tracking: unknown; response_deadline: string | null;
  small_claims_packet_path: string | null; notes: string | null; created_at: string; updated_at: string;
}
