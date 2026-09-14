import fs from "node:fs/promises";
import path from "node:path";
import { FAQ_SECTIONS, getFaqJsonLdEntities } from "../src/lib/faqContent.js";
import { PUBLIC_LEGAL_DOCUMENTS } from "./public-legal-snapshot.mjs";

const SITE_URL = "https://worldchessbet.com";
const SORO_EMBED_URL = "https://app.trysoro.com/api/embed/1ff2aa86-7de2-4a37-b949-e27846ab155b";
const SORO_TOKEN = "1ff2aa86-7de2-4a37-b949-e27846ab155b";
const SORO_API_BASE = "https://app.trysoro.com";
const ROOT = process.cwd();
const DIST = path.join(ROOT, "dist");
const BASE_HTML = await fs.readFile(path.join(DIST, "index.html"), "utf8");

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttr(value = "") {
  return escapeHtml(value);
}

function safeJson(value) {
  return JSON.stringify(value).replaceAll("</script", "<\\/script");
}

function replaceOrInsert(html, regex, replacement, before = "</head>") {
  if (regex.test(html)) return html.replace(regex, replacement);
  return html.replace(before, `${replacement}\n${before}`);
}

function applyMetadata(html, { title, description, canonical, image, type = "website", structuredData = [] }) {
  const canonicalUrl = canonical.startsWith("http") ? canonical : `${SITE_URL}${canonical}`;
  html = html.replace(/<title[^>]*>[\s\S]*?<\/title>/i, `<title data-rh="true">${escapeHtml(title)}</title>`);
  html = html.replace(/<meta[^>]+name="description"[^>]*>/i, `<meta data-rh="true" name="description" content="${escapeAttr(description)}" />`);
  html = html.replace(/<meta[^>]+property="og:type"[^>]*>/i, `<meta data-rh="true" property="og:type" content="${escapeAttr(type)}" />`);
  html = html.replace(/<meta[^>]+property="og:title"[^>]*>/i, `<meta data-rh="true" property="og:title" content="${escapeAttr(title)}" />`);
  html = html.replace(/<meta[^>]+property="og:description"[^>]*>/i, `<meta data-rh="true" property="og:description" content="${escapeAttr(description)}" />`);
  html = html.replace(/<meta[^>]+property="og:url"[^>]*>/i, `<meta data-rh="true" property="og:url" content="${escapeAttr(canonicalUrl)}" />`);
  html = html.replace(/<meta[^>]+name="twitter:title"[^>]*>/i, `<meta data-rh="true" name="twitter:title" content="${escapeAttr(title)}" />`);
  html = html.replace(/<meta[^>]+name="twitter:description"[^>]*>/i, `<meta data-rh="true" name="twitter:description" content="${escapeAttr(description)}" />`);

  html = replaceOrInsert(
    html,
    /<link[^>]+rel="canonical"[^>]*>/i,
    `<link data-rh="true" rel="canonical" href="${escapeAttr(canonicalUrl)}" />`
  );

  if (image) {
    html = html.replace(/<meta[^>]+property="og:image"[^>]*>/i, `<meta data-rh="true" property="og:image" content="${escapeAttr(image)}" />`);
    html = html.replace(/<meta[^>]+name="twitter:image"[^>]*>/i, `<meta data-rh="true" name="twitter:image" content="${escapeAttr(image)}" />`);
    html = html.replace(/<meta[^>]+name="twitter:card"[^>]*>/i, `<meta data-rh="true" name="twitter:card" content="summary_large_image" />`);
  }

  const items = Array.isArray(structuredData) ? structuredData : [structuredData];
  const jsonLd = items
    .filter(Boolean)
    .map((item) => `<script type="application/ld+json" data-chessbet-prerender="true">${safeJson(item)}</script>`)
    .join("\n");
  if (jsonLd) html = html.replace("</head>", `${jsonLd}\n</head>`);
  return html;
}

function fallbackShell(innerHtml) {
  return `<main data-chessbet-prerender="true" style="min-height:100vh;background:#0A0A0A;color:#f5f5f5;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:40px 20px;box-sizing:border-box">
    <div style="max-width:860px;margin:0 auto;line-height:1.65">
      <p style="margin:0 0 28px"><a href="/" style="color:#C9A84C;font-weight:800;text-decoration:none;font-size:20px">ChessBet</a></p>
      ${innerHtml}
    </div>
  </main>`;
}

function renderPage({ title, description, canonical, body, image, type, structuredData }) {
  let html = applyMetadata(BASE_HTML, { title, description, canonical, image, type, structuredData });
  return html.replace('<div id="root"></div>', `<div id="root">${fallbackShell(body)}</div>`);
}

async function writeRoute(route, html) {
  const normalized = route === "/" ? "" : route.replace(/^\//, "").replace(/\/$/, "");
  if (!normalized) {
    await fs.writeFile(path.join(DIST, "index.html"), html);
    return;
  }

  // Emit both shapes because static hosts differ in whether /faq resolves to
  // faq.html or faq/index.html. This makes both /route and /route/ crawlable.
  const htmlPath = path.join(DIST, `${normalized}.html`);
  const indexPath = path.join(DIST, normalized, "index.html");
  await fs.mkdir(path.dirname(htmlPath), { recursive: true });
  await fs.mkdir(path.dirname(indexPath), { recursive: true });
  await fs.writeFile(htmlPath, html);
  await fs.writeFile(indexPath, html);
}

function renderFaq() {
  const body = [
    `<h1 style="font-size:34px;line-height:1.15;margin:0 0 12px">Frequently Asked Questions</h1>`,
    `<p style="color:#bbb;margin:0 0 30px">Everything you need to know about ChessBet, cash-prize chess contests, account eligibility, funding, payouts, security, and fair play.</p>`,
    ...FAQ_SECTIONS.map((section) => `
      <section style="margin:34px 0">
        <h2 style="color:#C9A84C;font-size:15px;text-transform:uppercase;letter-spacing:.12em">${escapeHtml(section.category)}</h2>
        ${section.items.map((item) => `
          <article style="margin:24px 0">
            <h3 style="font-size:20px;margin:0 0 8px">${escapeHtml(item.question)}</h3>
            ${item.list
              ? `<ol>${item.list.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ol>`
              : item.paragraphs.map((paragraph) => `<p style="color:#ccc">${escapeHtml(paragraph)}</p>`).join("")}
          </article>`).join("")}
      </section>`),
  ].join("");

  return renderPage({
    title: "Chess for Cash FAQ | Eligibility, Payouts & Fair Play — ChessBet",
    description: "Get clear answers about ChessBet eligibility, ACH funding, cash-prize settlement, withdrawals, disputes, server-verified matches, and fair-play review.",
    canonical: "/faq",
    body,
    structuredData: {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: getFaqJsonLdEntities(),
    },
  });
}

function renderAbout() {
  const body = `
    <h1 style="font-size:34px;line-height:1.15;margin:0 0 16px">Chess competition built around skill and fair play</h1>
    <p style="color:#ccc">ChessBet is a head-to-head chess platform where eligible adults compete in skill-based chess contests under clear terms.</p>
    <h2>Head-to-head chess for real money</h2>
    <p style="color:#ccc">Players can compete in blitz, rapid, and classical chess. Before a paid contest begins, ChessBet shows the Contest Entry Amount and the separate fixed Platform Service Fee.</p>
    <h2>Clear settlement</h2>
    <p style="color:#ccc">The winner of a decisive contest receives the combined Contest Entry Amounts as pending winnings, released after the 24-hour reporting window when no open dispute or blocking integrity or reconciliation flag remains. Draws, voids, and cancellations are handled under the Official Rules.</p>
    <h2>Eligibility and fair play</h2>
    <p style="color:#ccc">Real-money activity requires verified identity, age 21+, and physical-location eligibility. Server-authoritative gameplay, post-game Stockfish screening, player reporting, and human review support competitive integrity.</p>
    <p><a href="/official-rules" style="color:#C9A84C">Official Rules</a> · <a href="/fair-play-integrity" style="color:#C9A84C">Fair Play &amp; Integrity</a> · <a href="/faq" style="color:#C9A84C">FAQ</a></p>`;
  return renderPage({
    title: "About ChessBet | Fair, Skill-Based Head-to-Head Chess",
    description: "Learn how ChessBet combines skill-based head-to-head chess, transparent contest terms, eligibility controls, and human-reviewed fair-play protection.",
    canonical: "/about",
    body,
    structuredData: {
      "@context": "https://schema.org",
      "@type": "AboutPage",
      url: `${SITE_URL}/about`,
      name: "About ChessBet",
      description: "ChessBet is a head-to-head, skill-based chess competition platform for eligible adults.",
    },
  });
}

function renderFairPlay() {
  const body = `
    <h1 style="font-size:34px;line-height:1.15;margin:0 0 16px">Fair Play &amp; Integrity Policy</h1>
    <p style="color:#ccc">ChessBet is a peer-to-peer skill competition platform. Every contest should be decided solely by the participating players' chess skill.</p>
    <h2>How ChessBet protects matches</h2>
    <p style="color:#ccc">ChessBet validates moves, clocks, game state, and results on its servers. Completed contests may be screened with Stockfish and behavioral checks, and player reports can supply evidence for review.</p>
    <h2>Human review before enforcement</h2>
    <p style="color:#ccc">Automated screening signals and rule-based flags are indicators for confidential human review. They do not, by themselves, establish wrongdoing, change a result, or impose a penalty. Open blocking integrity or settlement-reconciliation flags can delay automatic release of pending winnings.</p>
    <h2>Prohibited conduct</h2>
    <p style="color:#ccc">Engine assistance, AI assistance, collusion, account sharing, geolocation circumvention, identity manipulation, outcome manipulation, and exploitation of platform errors are prohibited.</p>
    <h2>Reports and appeals</h2>
    <p style="color:#ccc">ChessBet may review game records, technical records, reports, payment records, and account history. Users affected by an enforcement decision may provide additional information and request reconsideration.</p>
    <p><a href="/official-rules" style="color:#C9A84C">Read the Official Rules</a></p>`;
  return renderPage({
    title: "Chess Anti-Cheat & Fair Play — Human Review & Appeals | ChessBet",
    description: "Learn how ChessBet protects head-to-head chess with server-verified games, Stockfish screening, player reports, evidence review, and appeals.",
    canonical: "/fair-play-integrity",
    body,
    structuredData: {
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: "ChessBet Fair Play & Integrity",
      description: "ChessBet's integrity controls, human review process, reporting, disputes, and appeals for skill-based chess contests.",
      url: `${SITE_URL}/fair-play-integrity`,
    },
  });
}

function markdownToHtml(markdown, supportEmail) {
  const normalized = String(markdown || "").replaceAll("{{SUPPORT_EMAIL}}", supportEmail || "hello@worldchessbet.com");
  return normalized
    .split(/\n{2,}/)
    .map((block) => {
      const trimmed = block.trim();
      if (!trimmed) return "";
      if (trimmed.startsWith("## ")) {
        const [heading, ...rest] = trimmed.split("\n");
        const body = rest.length ? `<p style="color:#ccc">${escapeHtml(rest.join(" "))}</p>` : "";
        return `<section style="margin:34px 0"><h2>${escapeHtml(heading.slice(3).trim())}</h2>${body}</section>`;
      }
      return `<p style="color:#ccc">${escapeHtml(trimmed).replaceAll("\n", "<br>")}</p>`;
    })
    .join("");
}

function renderLegal(doc) {
  const body = `
    <h1 style="font-size:34px;line-height:1.15;margin:0 0 8px">${escapeHtml(doc.label)}</h1>
    <p style="color:#888;margin-top:0">Last Updated: ${escapeHtml(doc.lastUpdated)} · Version ${escapeHtml(doc.version)}</p>
    ${markdownToHtml(doc.markdown, doc.supportEmail)}`;
  return renderPage({
    title: doc.title,
    description: doc.description,
    canonical: doc.route,
    body,
    structuredData: {
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: doc.label,
      description: doc.description,
      url: `${SITE_URL}${doc.route}`,
      isPartOf: { "@type": "WebSite", name: "ChessBet", url: SITE_URL },
    },
  });
}

function extractSoroArticles(source) {
  const match = source.match(/var SORO_ARTICLES = (\[[\s\S]*?\]);\s*var SORO_TOKEN/);
  if (!match) throw new Error("Soro article metadata not found");
  const parsed = JSON.parse(match[1]);
  return Array.isArray(parsed) ? parsed.filter((article) => article?.slug && article?.id) : [];
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { Accept: "application/javascript,text/plain,*/*" },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.text();
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.json();
}

function renderBlogIndex(articles) {
  const cards = articles.map((article) => `
    <article style="margin:28px 0;padding-bottom:24px;border-bottom:1px solid #222">
      <h2 style="margin-bottom:6px"><a href="/blog/${escapeAttr(article.slug)}" style="color:#f5f5f5;text-decoration:none">${escapeHtml(article.title)}</a></h2>
      <p style="color:#ccc">${escapeHtml(article.excerpt || "")}</p>
      <time datetime="${escapeAttr(article.isoDate || "")}" style="color:#888">${escapeHtml(article.date || "")}</time>
    </article>`).join("");
  return renderPage({
    title: "Cash Chess Strategy & Fair-Play Insights | ChessBet Blog",
    description: "Read ChessBet guides on head-to-head blitz, rapid, and classical chess, fair-play protection, contest rules, match strategy, and cash-prize competition.",
    canonical: "/blog",
    body: `<h1 style="font-size:34px;line-height:1.15;margin:0 0 12px">ChessBet Blog</h1><p style="color:#bbb">News, guides, and insights from ChessBet.</p>${cards}`,
    structuredData: {
      "@context": "https://schema.org",
      "@type": "Blog",
      url: `${SITE_URL}/blog`,
      name: "ChessBet Blog",
      description: "News, guides, and insights about head-to-head cash-prize chess contests.",
    },
  });
}

function renderBlogArticle(article, content) {
  const canonical = `/blog/${article.slug}`;
  const articleBody = `
    <article itemscope itemtype="https://schema.org/BlogPosting">
      <p><a href="/blog" style="color:#C9A84C">← ChessBet Blog</a></p>
      <h1 itemprop="headline" style="font-size:36px;line-height:1.15;margin:18px 0 10px">${escapeHtml(article.title)}</h1>
      <p style="color:#aaa">${escapeHtml(article.excerpt || "")}</p>
      <time itemprop="datePublished" datetime="${escapeAttr(article.isoDate || "")}" style="color:#888">${escapeHtml(article.date || "")}</time>
      ${article.image ? `<p><img itemprop="image" src="${escapeAttr(article.image)}" alt="${escapeAttr(article.title)}" style="max-width:100%;height:auto;border-radius:12px"></p>` : ""}
      <div itemprop="articleBody" style="color:#ddd">${content || `<p>${escapeHtml(article.excerpt || "")}</p>`}</div>
    </article>`;
  return renderPage({
    title: `${article.title} | ChessBet`,
    description: article.excerpt || "ChessBet cash-prize chess guide.",
    canonical,
    body: articleBody,
    image: article.image,
    type: "article",
    structuredData: {
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      headline: article.title,
      description: article.excerpt || undefined,
      datePublished: article.isoDate || undefined,
      dateModified: article.isoDate || undefined,
      image: article.image || undefined,
      mainEntityOfPage: `${SITE_URL}${canonical}`,
      author: { "@type": "Organization", name: "ChessBet", url: SITE_URL },
      publisher: { "@type": "Organization", name: "ChessBet", url: SITE_URL },
    },
  });
}

async function prerenderBlog() {
  try {
    // Use a fresh cache key so publication includes recently corrected article copy.
    const publicationRevision = Date.now();
    const source = await fetchText(`${SORO_EMBED_URL}?v=${publicationRevision}`);
    const articles = extractSoroArticles(source);
    await writeRoute("/blog", renderBlogIndex(articles));

    const results = await Promise.allSettled(
      articles.map(async (article) => {
        let content = "";
        try {
          const payload = await fetchJson(`${SORO_API_BASE}/api/embed/${SORO_TOKEN}/article/${article.id}?v=${publicationRevision}`);
          content = typeof payload?.content === "string" ? payload.content : "";
        } catch (error) {
          console.warn(`[prerender] Soro body fallback for ${article.slug}: ${error.message}`);
        }
        await writeRoute(`/blog/${article.slug}`, renderBlogArticle(article, content));
      })
    );

    const failed = results.filter((result) => result.status === "rejected");
    if (failed.length) console.warn(`[prerender] ${failed.length} blog article route(s) could not be written`);
    console.log(`[prerender] Blog index + ${articles.length - failed.length} article route(s)`);
    return articles;
  } catch (error) {
    // Blog refresh should never prevent a ChessBet application deployment.
    console.warn(`[prerender] Soro unavailable; emitted static blog shell without article refresh: ${error.message}`);
    await writeRoute("/blog", renderBlogIndex([]));
    return [];
  }
}

await writeRoute("/faq", renderFaq());
await writeRoute("/about", renderAbout());
await writeRoute("/fair-play-integrity", renderFairPlay());
for (const doc of Object.values(PUBLIC_LEGAL_DOCUMENTS)) {
  await writeRoute(doc.route, renderLegal(doc));
}
const articles = await prerenderBlog();

console.log(`[prerender] Public crawler HTML complete: FAQ, About, Fair Play, 3 legal pages, Blog, ${articles.length} Soro articles`);
