import React, { useEffect } from "react";
import { Helmet } from "react-helmet-async";
import { ChevronLeft } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import Logo from "@/components/Logo";
import SEO from "@/components/seo/SEO";
import { SITE_URL } from "@/lib/seoConfig";

const SORO_SCRIPT_ID = "soro-blog-widget";
const SORO_EMBED_URL = "https://app.trysoro.com/api/embed/1ff2aa86-7de2-4a37-b949-e27846ab155b";

export default function Blog() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const articleSlug = searchParams.get("post")?.trim();
  const isSoroArticle = Boolean(articleSlug);
  // Soro navigates with pushState outside React Router. Keep one canonical
  // owner for both article/list views and strip tracking parameters.
  useEffect(() => {
    const canonical = document.createElement("link");
    canonical.rel = "canonical";
    canonical.dataset.chessbetBlog = "true";
    const ogUrl = document.createElement("meta");
    ogUrl.setAttribute("property", "og:url");
    ogUrl.dataset.chessbetBlog = "true";

    const syncCanonical = () => {
      if (window.location.pathname.replace(/\/$/, "").toLowerCase() !== "/blog") return;
      const slug = new URLSearchParams(window.location.search).get("post")?.trim();
      const url = slug
        ? `${SITE_URL}/blog?post=${encodeURIComponent(slug)}`
        : `${SITE_URL}/blog`;
      if (canonical.getAttribute("href") !== url) canonical.setAttribute("href", url);
      if (ogUrl.getAttribute("content") !== url) ogUrl.setAttribute("content", url);
      document.head.querySelectorAll('link[rel="canonical"], meta[property="og:url"]').forEach((tag) => {
        if (tag !== canonical && tag !== ogUrl) tag.remove();
      });
      if (!canonical.isConnected) document.head.appendChild(canonical);
      if (!ogUrl.isConnected) document.head.appendChild(ogUrl);
    };

    syncCanonical();
    const observer = new MutationObserver(syncCanonical);
    observer.observe(document.head, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["href", "content"],
    });
    window.addEventListener("popstate", syncCanonical);
    return () => {
      observer.disconnect();
      window.removeEventListener("popstate", syncCanonical);
      canonical.remove();
      ogUrl.remove();
    };
  }, []);

  useEffect(() => {
    if (document.getElementById(SORO_SCRIPT_ID)) return undefined;

    const script = document.createElement("script");
    script.id = SORO_SCRIPT_ID;
    // Soro caches each embed URL for up to an hour. Rotate the query key every
    // five minutes so a recently published article is picked up promptly.
    const embedCacheWindow = Math.floor(Date.now() / (5 * 60 * 1000));
    script.src = `${SORO_EMBED_URL}?v=${embedCacheWindow}`;
    script.defer = true;
    document.body.appendChild(script);

    return () => script.remove();
  }, []);

  return (
    <div className="min-h-screen bg-[#0A0A0A] px-5 py-10">
      {isSoroArticle ? (
        <Helmet>
          <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" />
        </Helmet>
      ) : (
        <SEO
          title="Cash Chess Strategy & Fair-Play Insights | ChessBet Blog"
          description="Read ChessBet guides on head-to-head blitz, rapid, and classical chess, fair-play protection, contest rules, match strategy, and the path to cash-prize competition."
        />
      )}
      <div className="max-w-5xl mx-auto space-y-6">
        <Link to="/" className="inline-block">
          <Logo size="sm" />
        </Link>

        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 text-sm text-white/50 hover:text-white transition-colors"
        >
          <ChevronLeft size={16} />
          Back
        </button>

        <header className="text-center space-y-2">
          <h1 className="text-3xl font-bold text-white">ChessBet Blog</h1>
          <p className="text-sm text-white/50">News, guides, and insights from ChessBet.</p>
        </header>

        <div id="soro-blog" />
      </div>
    </div>
  );
}
