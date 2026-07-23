// Supabase Edge Function: resend-webhook
//
// Receives Resend's Svix-signed delivery/open/click/bounce webhook events and
// logs them to public.email_events, which get_pm_dashboard_metrics() (see
// supabase/migrations/20260806000001_...) aggregates into the PM dashboard's
// "Email Engagement" section. Configured entirely on Resend's side (Dashboard
// -> Webhooks -> add endpoint pointing here) plus one Supabase secret --
// nothing in the app itself calls this function directly.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Webhook } from "npm:svix@1.24.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("RESEND_WEBHOOK_SECRET")!;

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const EVENT_TYPE_MAP: Record<string, string> = {
  "email.sent": "sent",
  "email.delivered": "delivered",
  "email.opened": "opened",
  "email.clicked": "clicked",
  "email.bounced": "bounced",
  "email.complained": "complained",
};

Deno.serve(async (req) => {
  const payload = await req.text();
  const headers = {
    "svix-id": req.headers.get("svix-id") ?? "",
    "svix-timestamp": req.headers.get("svix-timestamp") ?? "",
    "svix-signature": req.headers.get("svix-signature") ?? "",
  };

  let evt: { type?: string; data?: { email_id?: string; click?: { link?: string } } };
  try {
    evt = new Webhook(WEBHOOK_SECRET).verify(payload, headers) as typeof evt;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid signature" }), { status: 401 });
  }

  const eventType = EVENT_TYPE_MAP[evt.type ?? ""];
  if (!eventType) {
    // Unrecognized/irrelevant event type (Resend sends others we don't track) -- ack and ignore.
    return new Response(JSON.stringify({ ok: true, ignored: true }), { status: 200 });
  }

  const { error } = await sb.from("email_events").insert({
    resend_email_id: evt.data?.email_id ?? null,
    event_type: eventType,
    link_url: evt.data?.click?.link ?? null,
  });

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200 });
});
