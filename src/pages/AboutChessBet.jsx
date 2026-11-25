import React from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import Logo from "@/components/Logo";
import SEO from "@/components/seo/SEO";
import { SITE_URL } from "@/lib/seoConfig";
import { ABOUT_CONTENT } from "@/lib/aboutContent";

const linkStyles = "font-semibold text-[#E5CA7A] underline underline-offset-4 hover:text-white";

export default function AboutChessBet() {
  const { title, description, heading, intro, sections } = ABOUT_CONTENT;

  return (
    <main className="min-h-screen bg-[#0A0A0A] px-5 py-10 text-white">
      <SEO title={title} description={description} canonicalUrl={`${SITE_URL}/about`}
        structuredData={{
          "@context": "https://schema.org",
          "@type": "AboutPage",
          "@id": `${SITE_URL}/about#webpage`,
          url: `${SITE_URL}/about`,
          name: title,
          description,
          isPartOf: { "@id": `${SITE_URL}/#website` },
          about: { "@id": `${SITE_URL}/#organization` },
          inLanguage: "en-US",
        }}
      />
      <div className="mx-auto max-w-2xl">
        <Link to="/" className="block w-fit"><Logo size="sm" /></Link>
        <Link to="/" className="mt-5 inline-flex items-center gap-1.5 text-sm text-white/65 hover:text-white">
          <ArrowLeft size={16} /> Back to ChessBet
        </Link>
        <header id="about-chessbet" className="mt-6 rounded-2xl border border-[#C9A84C]/25 bg-[#C9A84C]/[0.07] p-5 sm:p-7">
          <h1 className="text-3xl font-extrabold leading-tight">{heading}</h1>
          <p className="mt-3 leading-relaxed text-white/80">{intro}</p>
          <p className="mt-2 text-sm leading-relaxed text-white/80">Free matches have no entry fee or cash prize.</p>
        </header>
        <div className="mt-4 space-y-3">
          {sections.map(({ id, heading, points }) => (
            <section key={id} id={id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-6">
              <h2 className="text-lg font-bold">{heading}</h2>
              <ul className="mt-3 list-disc space-y-3 pl-5 text-sm leading-relaxed text-white/80 marker:text-[#C9A84C]">
                {points.map(([label, text]) => (
                  <li key={label}><strong className="block text-white">{label}</strong>{text}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <nav aria-label="Learn more" className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm">
          <Link to="/official-rules" className={linkStyles}>Official Rules</Link>
          <Link to="/fair-play-integrity" className={linkStyles}>Fair Play &amp; Integrity</Link>
          <Link to="/faq" className={linkStyles}>FAQ</Link>
        </nav>
      </div>
    </main>
  );
}
