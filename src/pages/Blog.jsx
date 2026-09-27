import React, { useEffect, useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import { ChevronLeft } from "lucide-react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import Logo from "@/components/Logo";
import SEO from "@/components/seo/SEO";
import { SITE_URL } from "@/lib/seoConfig";

const BLOG_TITLE = "Cash Chess Strategy & Fair-Play Insights | ChessBet Blog";
const BLOG_DESCRIPTION = "Read ChessBet guides on head-to-head blitz, rapid, and classical chess, fair-play protection, contest rules, match strategy, and cash-prize competition.";
const BLOG_API = "/api/apps/6a4ed72536c51cb3280d2bc6/functions/getPublishedBlog";

function formatDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "America/Detroit",
  }).format(new Date(value));
}

async function fetchBlog(slug, signal) {
  const url = slug
    ? `${BLOG_API}?slug=${encodeURIComponent(slug)}`
    : `${BLOG_API}?limit=100`;
  const response = await fetch(url, { signal, headers: { Accept: "application/json" } });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || "Unable to load the ChessBet blog.");
  }
  return response.json();
}

function ArticleMetadata({ post }) {
  const canonical = post.canonical_url || `${SITE_URL}/blog/${post.slug}`;
  const title = post.seo_title || post.title;
  const description = post.meta_description || post.excerpt;
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description,
    datePublished: post.published_at,
    dateModified: post.updated_at || post.published_at,
    image: post.featured_image_url,
    mainEntityOfPage: canonical,
    author: { "@type": "Organization", name: "ChessBet", url: SITE_URL },
    publisher: { "@type": "Organization", name: "ChessBet", url: SITE_URL },
  };

  return (
    <Helmet>
      <title>{title} | ChessBet</title>
      <meta name="description" content={description} />
      <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" />
      <link rel="canonical" href={canonical} />
      <meta property="og:type" content="article" />
      <meta property="og:site_name" content="ChessBet" />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={canonical} />
      <meta property="og:image" content={post.featured_image_url} />
      <meta property="og:image:alt" content={post.featured_image_alt || post.title} />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:site" content="@worldchessbet" />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={post.featured_image_url} />
      <script type="application/ld+json">{JSON.stringify(structuredData)}</script>
    </Helmet>
  );
}

export default function Blog() {
  const navigate = useNavigate();
  const { articleSlug: routeArticleSlug } = useParams();
  const [searchParams] = useSearchParams();
  const articleSlug = routeArticleSlug?.trim() || searchParams.get("post")?.trim() || "";
  const [posts, setPosts] = useState([]);
  const [post, setPost] = useState(null);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setStatus("loading");
    setError("");
    fetchBlog(articleSlug, controller.signal)
      .then((payload) => {
        if (articleSlug) setPost(payload.post || null);
        else setPosts(Array.isArray(payload.posts) ? payload.posts : []);
        setStatus("ready");
      })
      .catch((reason) => {
        if (reason?.name === "AbortError") return;
        setError(reason?.message || "Unable to load the ChessBet blog.");
        setStatus("error");
      });
    return () => controller.abort();
  }, [articleSlug]);

  const canonical = useMemo(
    () => (articleSlug ? `${SITE_URL}/blog/${encodeURIComponent(articleSlug)}` : `${SITE_URL}/blog`),
    [articleSlug]
  );

  return (
    <div className="min-h-screen bg-[#0A0A0A] px-5 py-10 text-white">
      {articleSlug && post ? (
        <ArticleMetadata post={post} />
      ) : (
        <SEO title={BLOG_TITLE} description={BLOG_DESCRIPTION} canonical={canonical} />
      )}

      <div className="max-w-5xl mx-auto space-y-6">
        <Link to="/" className="inline-block"><Logo size="sm" /></Link>

        <button
          onClick={() => (articleSlug ? navigate("/blog") : navigate(-1))}
          className="flex items-center gap-1.5 text-sm text-white/50 hover:text-white transition-colors"
        >
          <ChevronLeft size={16} />
          {articleSlug ? "All articles" : "Back"}
        </button>

        {status === "loading" && (
          <div className="py-24 text-center text-white/50">Loading ChessBet insights…</div>
        )}

        {status === "error" && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-5 py-6 text-red-100">
            <h1 className="text-xl font-semibold">The blog is temporarily unavailable.</h1>
            <p className="mt-2 text-sm text-red-100/75">{error}</p>
          </div>
        )}

        {status === "ready" && !articleSlug && (
          <>
            <header className="text-center space-y-2 pb-4">
              <h1 className="text-3xl font-bold">ChessBet Blog</h1>
              <p className="text-sm text-white/50">News, guides, and insights from ChessBet.</p>
            </header>
            <div className="grid gap-6 md:grid-cols-2" aria-label="Blog articles">
              {posts.map((item) => (
                <article key={item.id || item.slug} className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.035]">
                  <Link to={`/blog/${item.slug}`} className="block">
                    <img
                      src={item.featured_image_url}
                      alt={item.featured_image_alt || item.title}
                      className="aspect-[16/9] w-full object-cover"
                      loading="lazy"
                    />
                    <div className="space-y-3 p-5">
                      <time className="text-xs font-semibold uppercase tracking-[0.14em] text-[#C9A84C]" dateTime={item.published_at}>
                        {formatDate(item.published_at)}
                      </time>
                      <h2 className="text-xl font-semibold leading-tight text-white">{item.title}</h2>
                      <p className="text-sm leading-6 text-white/65">{item.excerpt}</p>
                      <span className="inline-block text-sm font-semibold text-[#C9A84C]">Read article →</span>
                    </div>
                  </Link>
                </article>
              ))}
            </div>
          </>
        )}

        {status === "ready" && articleSlug && !post && (
          <div className="py-24 text-center">
            <h1 className="text-2xl font-semibold">Article not found</h1>
            <Link to="/blog" className="mt-4 inline-block text-[#C9A84C]">Return to the ChessBet Blog</Link>
          </div>
        )}

        {status === "ready" && post && (
          <article className="mx-auto max-w-3xl">
            <header className="space-y-5 pb-8 text-center">
              <time className="text-xs font-semibold uppercase tracking-[0.14em] text-[#C9A84C]" dateTime={post.published_at}>
                {formatDate(post.published_at)}
              </time>
              <h1 className="text-3xl font-bold leading-tight sm:text-5xl">{post.title}</h1>
              <p className="mx-auto max-w-2xl text-base leading-7 text-white/65">{post.excerpt}</p>
            </header>
            <img
              src={post.featured_image_url}
              alt={post.featured_image_alt || post.title}
              className="mb-10 aspect-[16/9] w-full rounded-2xl border border-white/10 object-cover"
            />
            <div
              className="space-y-5 text-[17px] leading-8 text-white/80 [&_a]:font-medium [&_a]:text-[#C9A84C] [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-[#C9A84C] [&_blockquote]:pl-5 [&_h2]:pt-7 [&_h2]:text-2xl [&_h2]:font-bold [&_h2]:text-white [&_h3]:pt-4 [&_h3]:text-xl [&_h3]:font-semibold [&_h3]:text-white [&_li]:ml-6 [&_ol]:list-decimal [&_strong]:text-white [&_ul]:list-disc"
              dangerouslySetInnerHTML={{ __html: post.content_html }}
            />
          </article>
        )}
      </div>
    </div>
  );
}
