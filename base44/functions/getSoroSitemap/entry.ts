const SITE_URL = "https://worldchessbet.com";
const SORO_EMBED_URL =
  "https://app.trysoro.com/api/embed/1ff2aa86-7de2-4a37-b949-e27846ab155b";

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function extractPublishedArticles(source: string) {
  const match = source.match(
    /var SORO_ARTICLES = (\[[\s\S]*?\]);\s*var SORO_TOKEN/
  );
  if (!match) {
    throw new Error("Soro published article data was not found");
  }

  const articles = JSON.parse(match[1]);
  if (!Array.isArray(articles)) {
    throw new Error("Soro published article data was not an array");
  }

  return articles.filter(
    (article) =>
      typeof article?.slug === "string" &&
      article.slug.length > 0 &&
      typeof article?.isoDate === "string"
  );
}

function buildSitemap(articles: Array<{ slug: string; isoDate: string }>) {
  const urls = articles
    .map((article) => {
      const articleUrl = `${SITE_URL}/blog?post=${encodeURIComponent(article.slug)}`;
      return [
        "  <url>",
        `    <loc>${escapeXml(articleUrl)}</loc>`,
        `    <lastmod>${escapeXml(article.isoDate)}</lastmod>`,
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
    return new Response("Method not allowed", {
      status: 405,
      headers: { Allow: "GET, HEAD" },
    });
  }

  try {
    const response = await fetch(SORO_EMBED_URL, {
      headers: { Accept: "application/javascript" },
    });
    if (!response.ok) {
      throw new Error(`Soro feed returned HTTP ${response.status}`);
    }

    const articles = extractPublishedArticles(await response.text());
    const sitemap = buildSitemap(articles);
    const headers = {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control":
        "public, max-age=900, s-maxage=900, stale-while-revalidate=3600",
      "X-Robots-Tag": "noindex",
    };

    return new Response(req.method === "HEAD" ? null : sitemap, {
      status: 200,
      headers,
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "soro_sitemap_failed",
        error: error?.message || "unknown_error",
      })
    );
    return new Response("Sitemap temporarily unavailable", {
      status: 503,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Retry-After": "900",
      },
    });
  }
});
