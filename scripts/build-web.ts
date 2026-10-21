/**
 * Builds the web version into site/ (deployed to GitHub Pages by .github/workflows/pages.yml):
 * the desktop UI (web/) + radar-web.js, which answers the UI's /api/* calls inside the browser.
 *   deno task web
 */
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { APP_NAME, DOWNLOAD_URL, REPO_URL, VERSION, WEB_URL } from "../src/meta.ts";
import { SOURCES } from "../src/sources/registry.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const site = join(root, "site");
try {
  Deno.removeSync(site, { recursive: true });
} catch { /* first build */ }
Deno.mkdirSync(join(site, "assets"), { recursive: true });

const bundle = await new Deno.Command(Deno.execPath(), {
  args: ["bundle", "--platform", "browser", "--minify", "-o", join(site, "radar-web.js"), join(root, "src", "web", "main.ts")],
  cwd: root,
  stdout: "inherit",
  stderr: "inherit",
}).output();
if (!bundle.success) Deno.exit(1);

for (const f of ["app.js", "style.css", "icon.svg"]) Deno.copyFileSync(join(root, "web", f), join(site, f));
Deno.copyFileSync(join(root, "assets", "icon.png"), join(site, "assets", "icon.png"));
Deno.copyFileSync(join(root, "docs", "feed.png"), join(site, "og.png"));

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const title = `${APP_NAME} · arXiv / ChemRxiv / bioRxiv 等预印本搜索、定时推荐、一键导出 PDF`;
const description =
  "预印本雷达（PreprintRadar）：同时检索 arXiv、ChemRxiv、bioRxiv、medRxiv、Research Square、Preprints.org、SSRN 等 12 个预印本平台的最新论文，" +
  "按兴趣主题定时推荐，一键导出 PDF 合集。Search and get scheduled recommendations of the latest preprints from arXiv, ChemRxiv, bioRxiv and more.";
const sourcesList = SOURCES.map((s) => `<li><b>${esc(s.name)}</b> — ${esc(s.field)}</li>`).join("");

const head = `
  <meta name="description" content="${esc(description)}">
  <meta name="keywords" content="预印本, 文献检索, 文献推荐, arXiv, ChemRxiv, bioRxiv, medRxiv, Research Square, Preprints.org, SSRN, 化学, 论文, PDF, preprint search, preprint recommender">
  <link rel="canonical" href="${WEB_URL}">
  <meta name="theme-color" content="#a8322a">
  <link rel="manifest" href="manifest.webmanifest">
  <meta property="og:type" content="website">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:url" content="${WEB_URL}">
  <meta property="og:image" content="${WEB_URL}og.png">
  <meta property="og:locale" content="zh_CN">
  <meta name="twitter:card" content="summary_large_image">
  <script type="application/ld+json">${JSON.stringify({
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: `${APP_NAME} PreprintRadar`,
  alternateName: "PreprintRadar",
  url: WEB_URL,
  description,
  applicationCategory: "EducationalApplication",
  operatingSystem: "Web, Windows",
  inLanguage: "zh-CN",
  softwareVersion: VERSION,
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  codeRepository: REPO_URL,
})}</script>`;

// readable without JavaScript (and by crawlers that do not run it); the app replaces it on start
const seo = `<article class="page seo">
      <h1>预印本雷达 · PreprintRadar</h1>
      <p>${esc(description)}</p>
      <h2>覆盖的预印本平台</h2><ul>${sourcesList}</ul>
      <h2>功能</h2><ul>
        <li>实时搜索：布尔语法（短语、前缀 *、排除 -、标题 / 作者限定），按时间和相关度排序</li>
        <li>兴趣主题与定时推荐：设定关键词与 arXiv 分类，每隔 N 小时或每天定时推荐，越用越懂你</li>
        <li>一键导出：合并成带目录和书签的 PDF、逐篇打包、摘要清单</li>
      </ul>
      <p><a href="${DOWNLOAD_URL}">下载 Windows 桌面版</a> · <a href="${REPO_URL}">GitHub 源代码</a></p>
      <noscript><p>这个网页需要启用 JavaScript。</p></noscript>
    </article>`;

let html = Deno.readTextFileSync(join(root, "web", "index.html"));
html = html
  .replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>${head}`)
  .replace('<main id="main"></main>', `<main id="main">${seo}</main>`)
  .replace('<script type="module" src="app.js"></script>', '<script src="radar-web.js"></script>\n  <script type="module" src="app.js"></script>');
Deno.writeTextFileSync(join(site, "index.html"), html);

Deno.writeTextFileSync(
  join(site, "manifest.webmanifest"),
  JSON.stringify(
    {
      name: `${APP_NAME} PreprintRadar`,
      short_name: APP_NAME,
      description,
      start_url: "./",
      scope: "./",
      display: "standalone",
      background_color: "#f2ebdd",
      theme_color: "#a8322a",
      lang: "zh-CN",
      icons: [{ src: "assets/icon.png", sizes: "256x256", type: "image/png", purpose: "any" }],
    },
    null,
    2,
  ),
);
const today = new Date().toISOString().slice(0, 10);
Deno.writeTextFileSync(join(site, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${WEB_URL}sitemap.xml\n`);
Deno.writeTextFileSync(
  join(site, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${WEB_URL}</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq></url>\n</urlset>\n`,
);
Deno.writeTextFileSync(join(site, ".nojekyll"), "");
console.log(`site/ built (v${VERSION}): ${[...Deno.readDirSync(site)].map((e) => e.name).join(", ")}`);
