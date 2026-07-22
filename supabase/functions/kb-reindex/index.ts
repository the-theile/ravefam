// Supabase Edge Function: kb-reindex
//
// Re-embeds and upserts the Ask FAM knowledge base (supabase/kb/articles.json)
// into the kb_chunks table. Triggered manually via `npm run reindex-kb`
// (scripts/reindex-kb.js) any time the KB content changes -- no cron, no
// client access. Embeddings come from the Supabase Edge Runtime's built-in
// gte-small model (Supabase.ai.Session), which only exists inside the edge
// runtime -- that's why this has to be a function rather than a plain script.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// deno-lint-ignore no-explicit-any
const model = new (globalThis as any).Supabase.ai.Session("gte-small");

interface KBArticle {
  id: string;
  category: string;
  source: string;
  title: string;
  content_html: string;
  keywords?: string[];
  updated_at?: string;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

Deno.serve(async (req) => {
  const auth = req.headers.get("Authorization") ?? "";
  if (auth !== `Bearer ${SERVICE_ROLE_KEY}`) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  }

  const { articles } = (await req.json()) as { articles: KBArticle[] };
  if (!Array.isArray(articles) || !articles.length) {
    return new Response(JSON.stringify({ error: "articles array required" }), { status: 400 });
  }

  const rows = [];
  for (const article of articles) {
    const embeddingInput = [
      article.title,
      stripHtml(article.content_html),
      (article.keywords ?? []).join(" "),
    ].join(" ");
    const embedding = await model.run(embeddingInput, { mean_pool: true, normalize: true });
    rows.push({
      id: article.id,
      category: article.category,
      source: article.source,
      title: article.title,
      content_html: article.content_html,
      keywords: article.keywords ?? [],
      embedding: JSON.stringify(embedding),
      updated_at: article.updated_at ?? new Date().toISOString(),
    });
  }

  const { error: upsertError } = await sb.from("kb_chunks").upsert(rows, { onConflict: "id" });
  if (upsertError) {
    return new Response(JSON.stringify({ error: upsertError.message }), { status: 500 });
  }

  const ids = rows.map((r) => r.id);
  const { error: deleteError, count } = await sb
    .from("kb_chunks")
    .delete({ count: "exact" })
    .not("id", "in", `(${ids.map((id) => `"${id}"`).join(",")})`);
  if (deleteError) {
    return new Response(JSON.stringify({ error: deleteError.message }), { status: 500 });
  }

  return new Response(
    JSON.stringify({ ok: true, upserted: rows.length, deleted: count ?? 0 }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
});
