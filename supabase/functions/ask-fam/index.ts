// Supabase Edge Function: ask-fam
//
// Backs the in-app "Ask FAM" help chatbot. Retrieves grounded context from
// kb_chunks (see supabase/migrations/20260806000000_ask_fam_kb.sql) via
// gte-small embeddings + pgvector cosine search, then asks Claude Haiku to
// answer using ONLY that context. If nothing relevant is found, returns a
// canned redirect without ever calling the LLM -- cheaper and guarantees the
// "don't know" behavior isn't just prompt-obedience. Phase 1: non-streaming
// JSON response; streaming is a planned additive upgrade, not a rewrite.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

const MATCH_COUNT = 5;
// Retuned later from real usage (see Phase 3 query-logging in the plan).
const MATCH_THRESHOLD = 0.3;
const MAX_HISTORY_TURNS = 6;

const NO_MATCH_REPLY =
  "I don't have a solid answer for that in the RaveFAM Help Center — check the full Help Center (❔ → Help Center tab) or email bump@myravefam.com and we'll help directly.";

const SYSTEM_PROMPT = `You are Ask FAM, the in-app help assistant for RaveFAM, a rave-crew planning app. Answer ONLY using the CONTEXT below, which comes from RaveFAM's official Help Center. Keep answers short (2-4 sentences), friendly, in RaveFAM's PLUR-community voice. If the CONTEXT doesn't fully answer the question, say so plainly and point the user to bump@myravefam.com or the full Help Center — never guess or invent app behavior. Only discuss RaveFAM; no unrelated chit-chat or advice.`;

// deno-lint-ignore no-explicit-any
const embeddingModel = new (globalThis as any).Supabase.ai.Session("gte-small");

interface HistoryTurn {
  role: "user" | "assistant";
  content: string;
}

interface KBMatch {
  id: string;
  title: string;
  content_html: string;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), { status: 405 });
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: userData, error: userError } = await sb.auth.getUser(token);
  if (userError || !userData?.user) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  }

  let body: { message?: string; history?: HistoryTurn[] };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid JSON body" }), { status: 400 });
  }

  const message = (body.message ?? "").trim();
  if (!message) {
    return new Response(JSON.stringify({ error: "message required" }), { status: 400 });
  }
  const history = Array.isArray(body.history) ? body.history.slice(-MAX_HISTORY_TURNS) : [];

  const queryEmbedding = await embeddingModel.run(message, { mean_pool: true, normalize: true });

  const { data: matches, error: matchError } = await sb.rpc("match_kb_chunks", {
    query_embedding: JSON.stringify(queryEmbedding),
    match_count: MATCH_COUNT,
    match_threshold: MATCH_THRESHOLD,
  });

  if (matchError) {
    return new Response(JSON.stringify({ error: matchError.message }), { status: 500 });
  }

  const kbMatches = (matches ?? []) as KBMatch[];
  if (!kbMatches.length) {
    return new Response(
      JSON.stringify({ reply: NO_MATCH_REPLY, sources: [] }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  const context = kbMatches
    .map((m) => `Q: ${m.title}\nA: ${stripHtml(m.content_html)}`)
    .join("\n\n");

  const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5",
      max_tokens: 400,
      system: `${SYSTEM_PROMPT}\n\nCONTEXT:\n${context}`,
      messages: [...history, { role: "user", content: message }],
    }),
  });

  if (!anthropicRes.ok) {
    const errText = await anthropicRes.text();
    return new Response(JSON.stringify({ error: `anthropic error: ${errText}` }), { status: 502 });
  }

  const anthropicBody = await anthropicRes.json();
  const reply = (anthropicBody.content ?? [])
    .filter((block: { type: string }) => block.type === "text")
    .map((block: { text: string }) => block.text)
    .join("");

  return new Response(
    JSON.stringify({
      reply: reply || NO_MATCH_REPLY,
      sources: kbMatches.map((m) => ({ id: m.id, title: m.title })),
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
});
