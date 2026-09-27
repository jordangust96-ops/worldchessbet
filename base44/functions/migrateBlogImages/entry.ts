import { createClientFromRequest } from "npm:@base44/sdk";

const TOKEN_SHA256 = "abbca639caf90959e47f5cda0b648030fd50f877d72225109e682e5c3365632d";

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

Deno.serve(async (req) => {
  if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });
  const bearer = String(req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const suppliedHash = bearer ? await sha256Hex(bearer) : "";
  if (!bearer || !constantTimeEqual(suppliedHash, TOKEN_SHA256)) return Response.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const payload = await req.json().catch(() => ({}));
    const limit = Math.max(1, Math.min(5, Number(payload.limit || 3)));
    const base44 = createClientFromRequest(req);
    const posts = await base44.asServiceRole.entities.BlogPost.filter({ status: "published" }, "-published_at", 100, 0);
    const candidates = (posts || []).filter((post) => {
      try {
        const host = new URL(String(post.featured_image_url || "")).hostname;
        return host.endsWith(".supabase.co");
      } catch {
        return false;
      }
    });
    const selected = candidates.slice(0, limit);
    const results = [];

    for (const post of selected) {
      try {
        const response = await fetch(post.featured_image_url, { signal: AbortSignal.timeout(20000) });
        if (!response.ok) throw new Error(`source returned HTTP ${response.status}`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (!bytes.length || bytes.length > 12 * 1024 * 1024) throw new Error("image size outside migration limits");
        const contentType = response.headers.get("content-type") || "image/webp";
        if (!contentType.startsWith("image/")) throw new Error("source is not an image");
        const extension = contentType.includes("png") ? "png" : contentType.includes("jpeg") ? "jpg" : contentType.includes("gif") ? "gif" : "webp";
        const file = new File([bytes], `${post.slug}.${extension}`, { type: contentType });
        const uploaded = await base44.asServiceRole.integrations.Core.UploadFile({ file });
        const fileUrl = String(uploaded?.file_url || "").trim();
        if (!fileUrl.startsWith("https://")) throw new Error("upload returned no public URL");
        await base44.asServiceRole.entities.BlogPost.update(post.id, {
          featured_image_url: fileUrl,
          updated_at: new Date().toISOString(),
        });
        results.push({ id: post.id, slug: post.slug, migrated: true });
      } catch (error) {
        results.push({ id: post.id, slug: post.slug, migrated: false, error: error?.message || "unknown_error" });
      }
    }

    return Response.json({
      processed: results.length,
      remaining_before_batch: candidates.length,
      remaining_after_batch: Math.max(0, candidates.length - results.filter((item) => item.migrated).length),
      results,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error(JSON.stringify({ event: "blog_image_migration_failed", error: error?.message || "unknown_error" }));
    return Response.json({ error: "Image migration failed" }, { status: 500 });
  }
});
