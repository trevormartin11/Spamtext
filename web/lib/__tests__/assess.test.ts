import { test } from "node:test";
import assert from "node:assert/strict";
import { computeBasis, violationCount } from "../assess";
import { normalizePhone } from "../phone";
import { registrableDomain } from "../identify";
import type { Report } from "../types";

function rep(over: Partial<Report>): Report {
  return {
    id: "r", kind: "sms", sender_phone: "+16025550100", sender_id: null, body: "hi", audio_path: null,
    received_at: "2026-06-01T00:00:00Z", duration_seconds: null, prerecorded: null, forwarded_7726: false,
    forwarded_7726_at: null, device_id: null, dedupe_key: "k", status: "identified", is_marketing: true, category: "other",
    extracted: null, error: null, created_at: "", updated_at: "", ...over,
  };
}

test("normalizePhone", () => {
  assert.equal(normalizePhone("(602) 555-0100"), "+16025550100");
  assert.equal(normalizePhone("16025550100"), "+16025550100");
  assert.equal(normalizePhone("+1 602-555-0100"), "+16025550100");
  assert.equal(normalizePhone("87892"), "87892");
});

test("registrableDomain", () => {
  assert.equal(registrableDomain("https://go.example.com/x?y=1"), "example.com");
  assert.equal(registrableDomain("bit.ly/abc"), "bit.ly");
});

test("DNC claim needs registration + 31 days and 2 messages", () => {
  const dnc = new Date("2020-01-01");
  const one = computeBasis([rep({})], dnc);
  assert.equal(one.dnc_eligible, true);
  assert.equal(one.tcpa_c5, false);
  const two = computeBasis([rep({}), rep({ id: "r2", received_at: "2026-06-02T00:00:00Z" })], dnc);
  assert.equal(two.tcpa_c5, true);
  assert.equal(violationCount([rep({}), rep({ id: "r2" })], two), 2);
  const late = computeBasis([rep({ received_at: "2026-06-01T00:00:00Z" })], new Date("2026-05-15"));
  assert.equal(late.dnc_eligible, false);
  const none = computeBasis([rep({}), rep({ id: "r2" })], null);
  assert.equal(none.tcpa_c5, false);
});

test("prerecorded call is actionable without DNC", () => {
  const b = computeBasis([rep({ kind: "call", prerecorded: true, body: null })], null);
  assert.equal(b.tcpa_b3, true);
  assert.equal(violationCount([rep({ kind: "call", prerecorded: true })], b), 1);
});
