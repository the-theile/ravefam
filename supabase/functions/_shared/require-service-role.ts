// Gate for functions that only the database should call (pg_net triggers and
// pg_cron jobs, which send the service-role key from the vault).
//
// verify_jwt on the gateway checks the token's signature but not its role,
// and the public anon key shipped in app.html is a valid project JWT, so
// verify_jwt alone let anyone invoke these. The signature is already verified
// by the time the request gets here, so trusting the role claim is safe.
// Returns a 403 Response to send back, or null to carry on.
export function requireServiceRole(req: Request): Response | null {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const envKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (token && envKey && token === envKey) return null;
  let role = "";
  try {
    const part = token.split(".")[1] ?? "";
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    role = JSON.parse(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4))).role ?? "";
  } catch {
    // Not a JWT: falls through to forbidden.
  }
  if (role === "service_role") return null;
  return new Response(JSON.stringify({ error: "forbidden" }), {
    status: 403,
    headers: { "Content-Type": "application/json" },
  });
}
