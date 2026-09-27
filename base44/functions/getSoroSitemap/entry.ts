import { createClientFromRequest } from "npm:@base44/sdk";

const SITE_URL = "https://worldchessbet.com";

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function buildSitemap(articles: Array<{ slug: string; updated_at?: string; published_at?: string }>) {
  const urls = articles
    .map((article) => {
      const articleUrl = `${SITE_URL}/blog/${encodeURIComponent(article.slug)}`;
      const lastModified = article.updated_at || article.published_at || new Date().toISOString();
      return [
        "  <url>",
        `    <loc>${escapeXml(articleUrl)}</loc>`,
        `    <lastmod>${escapeXml(lastModified)}</lastmod>`,
        "  </url>",
      ].join("\n");
    })
    .join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    urls,
    "</urlset>",
    "",
  ].join("\n");
}

Deno.serve(async (req) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
  }

  try {
    const base44 = createClientFromRequest(req);
    const articles = await base44.asServiceRole.entities.BlogPost.filter(
      { status: "published" },
      "-published_at",
      500,
      0,
      ["slug", "updated_at", "published_at"]
    );
    const sitemap = buildSitemap(articles || []);
    const headers = {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=300, stale-while-revalidate=900",
      "X-Robots-Tag": "noindex",
    };
    return new Response(req.method === "HEAD" ? null : sitemap, { status: 200, headers });
  } catch (error) {
    console.error(JSON.stringify({ event: "blog_sitemap_failed", error: error?.message || "unknown_error" }));
    return new Response("Sitemap temporarily unavailable", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Retry-After": "300" },
    });
  }
});
