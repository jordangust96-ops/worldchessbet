import { createClientFromRequest } from "npm:@base44/sdk";
import sanitizeHtml from "npm:sanitize-html@2.13.0";

const SITE_URL = "https://worldchessbet.com";
const TOKEN_SHA256 = "abbca639caf90959e47f5cda0b648030fd50f877d72225109e682e5c3365632d";

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...extraHeaders },
  });
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

function cleanText(value: unknown, max: number) {
  return String(value || "").trim().slice(0, max);
}

function slugify(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 180);
}

function isHttpsUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

function stripTags(value: string) {
  return value.replace(/<[^>]+>/g, " ").replace(/&[a-z0-9#]+;/gi, " ").replace(/\s+/g, " ").trim();
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, { Allow: "POST" });

  const bearer = String(req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const suppliedHash = bearer ? await sha256Hex(bearer) : "";
  if (!bearer || !constantTimeEqual(suppliedHash, TOKEN_SHA256)) return json({ error: "Unauthorized" }, 401);

  try {
    const payload = await req.json();
    if (payload?.confirm_publish !== true) {
      return json({ error: "confirm_publish must be true" }, 400);
    }

    const title = cleanText(payload.title, 160);
    const slug = slugify(payload.slug || title);
    const excerpt = cleanText(payload.excerpt || payload.meta_description, 400);
    const metaDescription = cleanText(payload.meta_description || excerpt, 180);
    const seoTitle = cleanText(payload.seo_title || title, 160);
    const primaryKeyword = cleanText(payload.primary_keyword, 200);
    const imageAlt = cleanText(payload.featured_image_alt || title, 300);
    const rawContent = String(payload.content_html || "").trim();

    const contentHtml = sanitizeHtml(rawContent, {
      allowedTags: ["p", "h2", "h3", "h4", "strong", "em", "ul", "ol", "li", "blockquote", "a", "br", "hr"],
      allowedAttributes: { a: ["href", "title", "target", "rel"] },
      allowedSchemes: ["http", "https", "mailto"],
      transformTags: {
        a: (_tagName, attribs) => ({
          tagName: "a",
          attribs: {
            ...attribs,
            rel: attribs.target === "_blank" ? "noopener noreferrer" : (attribs.rel || ""),
          },
        }),
      },
    });

    const wordCount = stripTags(contentHtml).split(/\s+/).filter(Boolean).length;
    const headingCount = (contentHtml.match(/<h2\b/gi) || []).length;
    const internalLinkCount = (contentHtml.match(/href=["']https:\/\/worldchessbet\.com\//gi) || []).length;

    const problems: string[] = [];
    if (title.length < 30 || title.length > 75) problems.push("title must be 30-75 characters");
    if (!slug) problems.push("a valid slug is required");
    if (metaDescription.length < 120 || metaDescription.length > 170) problems.push("meta_description must be 120-170 characters");
    if (excerpt.length < 80) problems.push("excerpt must be at least 80 characters");
    if (wordCount < 900 || wordCount > 2200) problems.push("article must be 900-2200 words");
    if (headingCount < 3) problems.push("article must contain at least three H2 sections");
    if (internalLinkCount < 2) problems.push("article must contain at least two internal worldchessbet.com links");
    if (!primaryKeyword) problems.push("primary_keyword is required");
    if (!imageAlt) problems.push("featured_image_alt is required");
    if (problems.length) return json({ error: "Article did not pass publication checks", problems, word_count: wordCount }, 400);

    const base44 = createClientFromRequest(req);
    const existing = await base44.asServiceRole.entities.BlogPost.filter({ slug }, "-published_at", 1, 0);
    if (existing?.length) return json({ error: "An article with this slug already exists", slug }, 409);

    let featuredImageUrl = cleanText(payload.featured_image_url, 2000);
    if (!featuredImageUrl) {
      const imagePrompt = cleanText(payload.image_prompt, 1800);
      if (!imagePrompt) return json({ error: "featured_image_url or image_prompt is required" }, 400);
      const generated = await base44.asServiceRole.integrations.Core.GenerateImage({ prompt: imagePrompt });
      featuredImageUrl = String(generated?.url || "").trim();
    }
    if (!isHttpsUrl(featuredImageUrl)) return json({ error: "featured image must use a public HTTPS URL" }, 400);

    const now = new Date().toISOString();
    const post = await base44.asServiceRole.entities.BlogPost.create({
      title,
      slug,
      excerpt,
      meta_description: metaDescription,
      seo_title: seoTitle,
      primary_keyword: primaryKeyword,
      content_html: contentHtml,
      featured_image_url: featuredImageUrl,
      featured_image_alt: imageAlt,
      status: "published",
      published_at: now,
      updated_at: now,
      source: "cb_marketer",
      author: "ChessBet",
      canonical_url: `${SITE_URL}/blog/${slug}`,
    });

    console.log(JSON.stringify({ event: "cb_marketer_blog_published", id: post.id, slug }));
    return json({
      published: true,
      id: post.id,
      title,
      slug,
      url: `${SITE_URL}/blog/${slug}`,
      featured_image_url: featuredImageUrl,
      word_count: wordCount,
      internal_link_count: internalLinkCount,
    }, 201);
  } catch (error) {
    console.error(JSON.stringify({ event: "cb_marketer_blog_publish_failed", error: error?.message || "unknown_error" }));
    return json({ error: "Blog publication failed" }, 500);
  }
});
