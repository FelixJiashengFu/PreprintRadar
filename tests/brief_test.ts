import assert from "node:assert/strict";
import { computeNextBrief, localDayKey } from "../src/schedule.ts";
import { briefDateLabel, briefHtml } from "../src/templates.ts";
import type { Paper } from "../src/types.ts";

const paper = (over: Partial<Paper> = {}): Paper => ({
  uid: "arxiv:2610.00001",
  source: "arxiv",
  extId: "2610.00001",
  version: 1,
  title: "Photoredox C–H activation of arenes",
  authors: ["Ada Lovelace", "Alan Turing"],
  abstract: "We report a mild photoredox route to aryl radicals.",
  published: "2026-10-25T00:00:00Z",
  updated: "2026-10-25T00:00:00Z",
  categories: ["physics.chem-ph"],
  url: "https://arxiv.org/abs/2610.00001",
  pdfUrl: "https://arxiv.org/pdf/2610.00001",
  ...over,
});

const build = (items: ReturnType<typeof briefItem>[], total = items.length) =>
  briefHtml({
    dateLabel: "2026年10月26日 星期一 · 08:40 生成",
    sinceLabel: "2026-10-25 0840",
    total,
    items,
  });

function briefItem(over: Partial<Paper> = {}, extra: { score?: number; matched?: string[]; topics?: string[] } = {}) {
  return { paper: paper(over), score: extra.score, matched: extra.matched, topics: extra.topics ?? [] };
}

Deno.test("brief: lists a paper with its badges, keywords and abstract", () => {
  const html = build([briefItem({}, { score: 82, matched: ["photoredox"], topics: ["有机合成方法学"] })]);
  assert.ok(html.includes("每日简报"));
  assert.ok(html.includes("2026年10月26日 星期一 · 08:40 生成"));
  assert.ok(html.includes("1</b> 篇新推荐"), "total count");
  assert.ok(html.includes("arXiv</span>"), "source badge");
  assert.ok(html.includes("arXiv 1"), "source distribution");
  assert.ok(html.includes("Ada Lovelace, Alan Turing"));
  assert.ok(html.includes("相关度 82"));
  assert.ok(html.includes("命中：photoredox"));
  assert.ok(html.includes("主题：有机合成方法学"));
  assert.ok(html.includes("aryl radicals"));
  assert.ok(html.includes("收录 2026-10-25 0840 之后的新推荐"));
});

Deno.test("brief: titles are escaped and long abstracts are cut at a sentence", () => {
  const long = "First sentence about the method. " + "More detail that goes on and on. ".repeat(40);
  const html = build([briefItem({ title: 'Catalysis of CO<sub>2</sub> & "water"', abstract: long })]);
  assert.ok(html.includes("CO&lt;sub&gt;2&lt;/sub&gt;"), "markup in titles is escaped");
  assert.ok(!html.includes("<sub>2</sub>"), "no raw markup leaks in");
  assert.ok(html.includes("First sentence about the method."));
  assert.ok(html.includes("…"));
  assert.ok(!html.includes("More detail that goes on and on. ".repeat(40)), "abstract is truncated");
});

Deno.test("brief: counts what it left out, and copes with an empty window", () => {
  const omitted = build([briefItem(), briefItem({ uid: "arxiv:2", extId: "2" })], 7);
  assert.ok(omitted.includes("这里列出相关度最高的 2 篇"));
  assert.ok(omitted.includes("另有 5 篇未列出"));

  const empty = build([]);
  assert.ok(empty.includes("这段时间没有新的推荐"));
  assert.ok(!empty.includes("另有"));
});

Deno.test("brief: date label carries the day and the time", () => {
  const label = briefDateLabel(new Date(2026, 9, 26, 8, 40));
  assert.equal(label, "2026年10月26日 星期一 · 08:40 生成");
  assert.equal(localDayKey(new Date(2026, 9, 6, 23, 59)), "2026-10-06");
});

Deno.test("brief schedule: once a day, at the configured time", () => {
  const s = { briefEnabled: true, briefTime: "08:40" };
  const at = (h: number, m: number) => new Date(2026, 9, 26, h, m).getTime();
  const today0840 = at(8, 40);
  const tomorrow0840 = at(8, 40) + 86_400_000;

  assert.equal(computeNextBrief({ ...s, briefEnabled: false }, null, at(9, 0)), null);
  // no brief yet, time already passed → due now
  assert.equal(computeNextBrief(s, null, at(9, 0)), 0);
  // no brief yet, time still ahead → today's slot
  assert.equal(computeNextBrief(s, null, at(7, 0)), today0840);
  // yesterday's brief, time passed → due now (catch up after the machine was off)
  assert.equal(computeNextBrief(s, "2026-10-25", at(9, 0)), 0);
  // yesterday's brief, before the slot → today's slot
  assert.equal(computeNextBrief(s, "2026-10-25", at(7, 0)), today0840);
  // already written today → tomorrow
  assert.equal(computeNextBrief(s, "2026-10-26", at(9, 0)), tomorrow0840);
  assert.equal(computeNextBrief(s, "2026-10-26", at(7, 0)), tomorrow0840);
});
