import React, { useEffect } from "react";
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
  const isSoroArticle = searchParams.has("post");

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
      {!isSoroArticle && (
        <SEO
          title="Cash Chess Strategy & Fair-Play Insights | ChessBet Blog"
          description="Read ChessBet guides on head-to-head blitz, rapid, and classical chess, fair-play protection, contest rules, match strategy, and the path to cash-prize competition."
          canonicalUrl={`${SITE_URL}/blog`}
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
