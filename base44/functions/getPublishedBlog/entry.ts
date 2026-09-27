import { createClientFromRequest } from "npm:@base44/sdk";

const SITE_URL = "https://worldchessbet.com";
const MAX_LIMIT = 100;

function publicPost(post: Record<string, unknown>, includeContent = false) {
  const slug = String(post.slug || "");
  const output: Record<string, unknown> = {
    id: post.id,
    title: post.title,
    slug,
    excerpt: post.excerpt,
    meta_description: post.meta_description || post.excerpt,
    seo_title: post.seo_title || post.title,
    primary_keyword: post.primary_keyword || "",
    featured_image_url: post.featured_image_url,
    featured_image_alt: post.featured_image_alt || post.title,
    published_at: post.published_at,
    updated_at: post.updated_at || post.published_at,
    author: post.author || "ChessBet",
    canonical_url: post.canonical_url || `${SITE_URL}/blog/${slug}`,
  };
  if (includeContent) output.content_html = post.content_html;
  return output;
}

Deno.serve(async (req) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return Response.json({ error: "Method not allowed" }, { status: 405, headers: { Allow: "GET, HEAD" } });
  }

  try {
    const base44 = createClientFromRequest(req);
    const url = new URL(req.url);
    const slug = String(url.searchParams.get("slug") || "").trim();
    const requestedLimit = Number(url.searchParams.get("limit") || 50);
    const limit = Math.max(1, Math.min(MAX_LIMIT, Number.isFinite(requestedLimit) ? requestedLimit : 50));

    const posts = slug
      ? await base44.asServiceRole.entities.BlogPost.filter({ status: "published", slug }, "-published_at", 1, 0)
      : await base44.asServiceRole.entities.BlogPost.filter({ status: "published" }, "-published_at", limit, 0);

    const headers = {
      "Cache-Control": "public, max-age=120, s-maxage=300, stale-while-revalidate=900",
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    };

    if (slug) {
      const post = posts?.[0];
      if (!post) return Response.json({ error: "Article not found" }, { status: 404, headers });
      return new Response(req.method === "HEAD" ? null : JSON.stringify({ post: publicPost(post, true) }), { status: 200, headers });
    }

    const payload = { posts: (posts || []).map((post: Record<string, unknown>) => publicPost(post, false)) };
    return new Response(req.method === "HEAD" ? null : JSON.stringify(payload), { status: 200, headers });
  } catch (error) {
    console.error(JSON.stringify({ event: "published_blog_read_failed", error: error?.message || "unknown_error" }));
    return Response.json({ error: "Blog is temporarily unavailable" }, { status: 503, headers: { "Retry-After": "60" } });
  }
});
