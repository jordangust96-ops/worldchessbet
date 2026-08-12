import React, { useEffect } from "react";
import { ChevronLeft } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import Logo from "@/components/Logo";
import SEO from "@/components/seo/SEO";
import { SITE_URL } from "@/lib/seoConfig";
import { useAuth } from "@/lib/AuthContext";

const SORO_SCRIPT_ID = "soro-blog-widget";
const SORO_EMBED_URL = "https://app.trysoro.com/api/embed/1ff2aa86-7de2-4a37-b949-e27846ab155b?theme=dark";

export default function Blog() {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();

  useEffect(() => {
    if (document.getElementById(SORO_SCRIPT_ID)) return undefined;

    const script = document.createElement("script");
    script.id = SORO_SCRIPT_ID;
    script.src = SORO_EMBED_URL;
    script.defer = true;
    document.body.appendChild(script);

    return () => script.remove();
  }, []);

  return (
    <div className="min-h-screen bg-[#0A0A0A] px-5 py-10">
      <SEO
        title="ChessBet Blog"
        description="News, guides, and insights from ChessBet."
        canonicalUrl={`${SITE_URL}/blog`}
      />
      <div className="max-w-5xl mx-auto space-y-6">
        <Link to={isAuthenticated ? "/" : "/landing"} className="inline-block">
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
