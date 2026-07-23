import { useEffect } from "react";

function setMeta(attr, key, content) {
  if (!content) return;
  let el = document.querySelector(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function setLink(rel, href) {
  if (!href) return;
  let el = document.querySelector(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", rel);
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
}

// Lightweight, dependency-free SEO tag manager for this single-page app.
// Mount once per public page to set a unique <title>, meta description,
// Open Graph / Twitter tags, canonical URL, and (optionally) JSON-LD
// structured data. Renders nothing.
export default function SEO({
  title,
  description,
  canonicalUrl,
  ogTitle,
  ogDescription,
  ogType = "website",
  ogImage,
  structuredData,
}) {
  useEffect(() => {
    const previousTitle = document.title;
    if (title) document.title = title;

    setMeta("name", "description", description);
    setMeta("property", "og:title", ogTitle || title);
    setMeta("property", "og:description", ogDescription || description);
    setMeta("property", "og:type", ogType);
    setMeta("property", "og:url", canonicalUrl);
    setMeta("property", "og:image", ogImage);
    setMeta("name", "twitter:card", ogImage ? "summary_large_image" : "summary");
    setMeta("name", "twitter:title", ogTitle || title);
    setMeta("name", "twitter:description", ogDescription || description);
    setMeta("name", "twitter:image", ogImage);
    setLink("canonical", canonicalUrl);

    let script;
    if (structuredData) {
      script = document.createElement("script");
      script.type = "application/ld+json";
      script.textContent = JSON.stringify(structuredData);
      document.head.appendChild(script);
    }

    return () => {
      document.title = previousTitle;
      if (script) document.head.removeChild(script);
    };
  }, [title, description, canonicalUrl, ogTitle, ogDescription, ogType, ogImage, structuredData]);

  return null;
}