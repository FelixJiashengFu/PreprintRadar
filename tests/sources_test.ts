import assert from "node:assert/strict";
import { parseQuery } from "../src/query.ts";
import { crossrefToPaper, DEFS, isMedrxivDoi, parseChemrxivDoi } from "../src/sources/crossref.ts";
import { dataciteToPaper, toDatacite } from "../src/sources/datacite.ts";
import { repoToPaper } from "../src/sources/repository.ts";
import { htmlishToText } from "../src/text.ts";

const item = (DOI: string, extra: Record<string, unknown> = {}) => ({
  DOI,
  title: ["A title"],
  created: { "date-time": "2026-10-21T10:00:00Z" },
  resource: { primary: { URL: `https://example.org/${DOI}` } },
  ...extra,
});

Deno.test("ChemRxiv DOIs of all three platform eras", () => {
  assert.deepEqual(parseChemrxivDoi("10.26434/chemrxiv.15010776/v1"), { base: "15010776", version: 1 });
  assert.deepEqual(parseChemrxivDoi("10.26434/chemrxiv-2023-ab12c-v2"), { base: "2023-ab12c", version: 2 });
  assert.deepEqual(parseChemrxivDoi("10.26434/chemrxiv.12345678.v1"), { base: "12345678", version: 1 });
});

Deno.test("bioRxiv and medRxiv share a prefix and are told apart by the DOI", () => {
  assert.equal(isMedrxivDoi("10.64898/2026.10.16.26364574"), true);
  assert.equal(isMedrxivDoi("10.64898/2026.10.12.758574"), false);
  assert.equal(crossrefToPaper("medrxiv", item("10.64898/2026.10.12.758574")), null);
  const p = crossrefToPaper("biorxiv", item("10.64898/2026.10.12.758574", { "group-title": "Neuroscience" }))!;
  assert.equal(p.uid, "biorxiv:2026.10.12.758574");
  assert.equal(p.pdfUrl, "https://www.biorxiv.org/content/10.64898/2026.10.12.758574.full.pdf");
  assert.deepEqual(p.categories, ["Neuroscience"]);
});

Deno.test("ids and PDF links per server", () => {
  const cases: [keyof typeof DEFS, string, string, string][] = [
    ["researchsquare", "10.21203/rs.3.rs-11009793/v1", "researchsquare:rs-11009793", "https://www.researchsquare.com/article/rs-11009793/v1.pdf"],
    ["preprints", "10.20944/preprints202610.1718.v2", "preprints:202610.1718", "https://www.preprints.org/manuscript/202610.1718/v2/download"],
    ["ssrn", "10.2139/ssrn.7629359", "ssrn:7629359", "https://papers.ssrn.com/sol3/papers.cfm?abstract_id=7629359"],
    ["beilstein", "10.3762/bxiv.2026.32.v1", "beilstein:2026.32", "https://www.beilstein-archives.org/xiv/download/pdf/202632-pdf"],
    ["essoar", "10.22541/essoar.15010729/v1", "essoar:15010729", "https://essopenarchive.org/doi/pdf/10.22541/essoar.15010729/v1"],
  ];
  for (const [src, doi, uid, pdf] of cases) {
    const p = crossrefToPaper(src, item(doi))!;
    assert.equal(p.uid, uid, src);
    assert.equal(p.pdfUrl, pdf, src);
  }
  // a Beilstein *journal* article under the same prefix is not a preprint
  assert.equal(crossrefToPaper("beilstein", item("10.3762/bjoc.22.15")), null);
  assert.equal(crossrefToPaper("authorea", item("10.22541/essoar.15010729/v1")), null);
});

Deno.test("Crossref markup: JATS sub/sup, doubly escaped tags, real angle brackets", () => {
  assert.equal(htmlishToText("CO\n      <sub>2</sub>\n reduction"), "CO$_{2}$ reduction");
  assert.equal(
    htmlishToText("Drug-Resistant &lt;em&gt;Mycobacterium&lt;/em&gt; with p &lt; 0.05 and x &gt; 2"),
    "Drug-Resistant Mycobacterium with p < 0.05 and x > 2",
  );
  assert.equal(htmlishToText("Na&lt;sup&gt;+&lt;/sup&gt; ions"), "Na$^{+}$ ions");
});

Deno.test("DataCite query keeps a superset: phrases, prefixes, fields, exclusions", () => {
  assert.equal(
    toDatacite(parseQuery('"machine learning" catalys* -review')),
    '((titles.title:"machine learning" OR descriptions.description:"machine learning") AND ' +
      "(titles.title:catalys* OR descriptions.description:catalys*)) AND NOT " +
      "(titles.title:review OR descriptions.description:review)",
  );
  // an AND group inside an OR must keep its brackets
  assert.equal(
    toDatacite(parseQuery("ti:(MOF COF), ti:zeolite")),
    "(titles.title:MOF AND titles.title:COF) OR titles.title:zeolite",
  );
  assert.equal(toDatacite(parseQuery('ti:"neural network*"')), "titles.title:(neural AND network*)");
  assert.equal(toDatacite(parseQuery("au:Kulik")), "creators.name:Kulik");
  assert.equal(toDatacite(parseQuery("-review")), null);
});

Deno.test("DataCite arXiv records become papers", () => {
  const p = dataciteToPaper({
    id: "10.48550/arxiv.2610.28633",
    attributes: {
      doi: "10.48550/arxiv.2610.28633",
      titles: [{ title: "Constraints on  Transients" }],
      creators: [{ name: "Doe, Jane", givenName: "Jane", familyName: "Doe" }, { name: "Roe, R." }],
      descriptions: [{ description: "We study $\\alpha$ things.", descriptionType: "Abstract" }],
      subjects: [
        { subject: "Chemical Physics (physics.chem-ph)", subjectScheme: "arXiv" },
        { subject: "FOS: Physical sciences" },
      ],
      created: "2026-10-21T03:10:24Z",
    },
  })!;
  assert.equal(p.uid, "arxiv:2610.28633");
  assert.deepEqual(p.authors, ["Jane Doe", "R. Roe"]);
  assert.deepEqual(p.categories, ["physics.chem-ph"]);
  assert.equal(p.title, "Constraints on Transients");
  assert.equal(p.pdfUrl, "https://arxiv.org/pdf/2610.28633");
});

Deno.test("servers added for every discipline: ids, versions, and records under shared prefixes", () => {
  const cases: [keyof typeof DEFS, string, string, number][] = [
    ["socarxiv", "10.31235/osf.io/ur5y3_v1", "socarxiv:ur5y3", 1],
    ["psyarxiv", "10.31234/osf.io/j5x7g_v3", "psyarxiv:j5x7g", 3],
    ["edarxiv", "10.35542/osf.io/ta4nv", "edarxiv:ta4nv", 1],
    ["osf", "10.31219/osf.io/wzqxg_v5", "osf:wzqxg", 5],
    ["ecsarxiv", "10.1149/osf.io/pjdgm_v1", "ecsarxiv:pjdgm", 1],
    ["qeios", "10.32388/ozjpoz.3", "qeios:ozjpoz", 3],
    ["qeios", "10.32388/l7ntkx", "qeios:l7ntkx", 1],
    ["scielo", "10.1590/SciELOPreprints.18786", "scielo:18786", 1],
    ["engage", "10.33774/apsa-2026-t5x44-v2", "engage:apsa-2026-t5x44", 2],
    ["engage", "10.33774/coe-2026-gbr4v", "engage:coe-2026-gbr4v", 1],
    ["jmir", "10.2196/preprints.116322", "jmir:116322", 1],
    ["sportrxiv", "10.51224/sportrxiv.1158", "sportrxiv:1158", 1],
    ["ecoevorxiv", "10.32942/x22h6p", "ecoevorxiv:x22h6p", 1],
    ["agrirxiv", "10.31220/agrirxiv.2026.00519", "agrirxiv:2026.00519", 1],
  ];
  for (const [src, doi, uid, version] of cases) {
    const p = crossrefToPaper(src, item(doi))!;
    assert.ok(p, `${src} ${doi}`);
    assert.equal(p.uid, uid, doi);
    assert.equal(p.version, version, doi);
  }
  assert.equal(crossrefToPaper("osf", item("10.31219/osf.io/wzqxg_v5"))!.pdfUrl, "https://osf.io/wzqxg/download");
  assert.equal(crossrefToPaper("jmir", item("10.2196/preprints.116322"))!.pdfUrl, "https://preprints.jmir.org/preprint/116322");
  // journal articles that share a prefix with a preprint server are not preprints
  assert.equal(crossrefToPaper("scielo", item("10.1590/s0100-879x2026e14321")), null);
  assert.equal(crossrefToPaper("jmir", item("10.2196/71234")), null);
  assert.equal(crossrefToPaper("ecsarxiv", item("10.1149/1945-7111/ad1234")), null);
});

Deno.test("Knowledge Commons (DataCite): texts kept with their subjects, datasets and images left out, duplicates folded", () => {
  const rec = (doi: string, type: string, title = "Reading Woolf's Diaries", extra: Record<string, unknown> = {}) => ({
    id: doi,
    attributes: {
      doi,
      titles: [{ title }],
      creators: [{ name: "Smith, Jane" }],
      descriptions: [{ descriptionType: "Abstract", description: "An essay on the late diaries." }],
      subjects: [{ subject: "Literature--Philosophy" }, { subject: "Modernism" }],
      types: { resourceTypeGeneral: type },
      url: `https://works.hcommons.org/doi/${doi}`,
      created: "2026-11-02T10:00:00Z",
      ...extra,
    },
  });
  const p = repoToPaper("kcworks", rec("10.17613/38bf8-my497", "Preprint"))!;
  assert.equal(p.uid, "kcworks:38bf8-my497");
  assert.deepEqual(p.authors, ["Jane Smith"]);
  assert.deepEqual(p.categories, ["Literature--Philosophy", "Modernism"]);
  assert.equal(p.abstract, "An essay on the late diaries.");
  assert.equal(p.url, "https://works.hcommons.org/doi/10.17613/38bf8-my497");
  assert.ok(repoToPaper("kcworks", rec("10.17613/aaaaa-11111", "JournalArticle")));
  assert.ok(repoToPaper("kcworks", rec("10.17613/aaaaa-22222", "BookChapter")));
  assert.equal(repoToPaper("kcworks", rec("10.17613/aaaaa-33333", "Dataset")), null);
  assert.equal(repoToPaper("kcworks", rec("10.17613/aaaaa-44444", "Image")), null);
  assert.equal(repoToPaper("kcworks", rec("10.5281/zenodo.1", "Preprint")), null, "another prefix");
});
