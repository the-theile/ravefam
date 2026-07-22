// Reads supabase/kb/articles.json and POSTs it to the kb-reindex edge
// function to (re)embed and upsert every article into kb_chunks. Run this
// manually any time kb/articles.json changes. Requires SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY in the environment.
const fs = require('fs');
const path = require('path');

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }
  const articles = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../supabase/kb/articles.json'), 'utf8')
  );
  const res = await fetch(`${url}/functions/v1/kb-reindex`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ articles }),
  });
  const body = await res.json();
  if (!res.ok) {
    console.error('Reindex failed:', body);
    process.exit(1);
  }
  console.log('Reindex complete:', body);
}

main();
