import assert from "node:assert/strict";
import { collectTerms, describe, evaluate, makeDoc, parseQuery, QueryError, toArxiv } from "../src/query.ts";

const doc = (title: string, abstract = "", authors: string[] = []) => makeDoc({ title, abstract, authors });

Deno.test("implicit AND, OR lists and exclusions", () => {
  const q = parseQuery('("machine learning", "deep learning") catalys* -review');
  assert.equal(describe(q), '("machine learning" 或 "deep learning") 且 catalys* 且 非 review');
  assert.ok(evaluate(q, doc("Machine-learning guided catalyst design")));
  assert.ok(evaluate(q, doc("Deep learning for catalysis")));
  assert.ok(!evaluate(q, doc("Deep learning for catalysis: a review")));
  assert.ok(!evaluate(q, doc("Machine learning for batteries")));
});

Deno.test("dash variants, plurals, TeX and subscripts are normalised", () => {
  const q = parseQuery('"C-H activation"');
  assert.ok(evaluate(q, doc("Pd-catalysed C–H activation of arenes")));
  assert.ok(evaluate(parseQuery("MOF"), doc("Two new MOFs for water harvesting")));
  assert.ok(!evaluate(parseQuery("ion"), doc("Ionic liquids")));
  assert.ok(evaluate(parseQuery('"CO2 reduction"'), doc("Electrochemical $\\mathrm{CO_2}$ reduction on Cu")));
  assert.ok(evaluate(parseQuery('"CO2 reduction"'), doc("CO₂ reduction on Cu")));
  assert.ok(evaluate(parseQuery("α-helix"), doc("Stability of the $\\alpha$-helix")));
});

Deno.test("fields restrict matching; default ignores authors", () => {
  assert.ok(evaluate(parseQuery("au:Kulik"), doc("Some title", "", ["Heather J. Kulik"])));
  assert.ok(!evaluate(parseQuery("Kulik"), doc("Some title", "", ["Heather J. Kulik"])));
  const q = parseQuery("ti:(perovskite OR MOF)");
  assert.ok(evaluate(q, doc("Perovskite solar cells")));
  assert.ok(!evaluate(q, doc("Solar cells", "perovskite absorbers")));
});

Deno.test("describe keeps the * where people type it", () => {
  assert.equal(describe(parseQuery('"neural network*", catal*')), '"neural network*" 或 catal*');
});

Deno.test("comma and newline separated keyword lists", () => {
  const q = parseQuery("photoredox\nelectrosynthesis, flow chemistry");
  assert.equal(describe(q), "photoredox 或 electrosynthesis 或 (flow 且 chemistry)");
  assert.equal(collectTerms(q).length, 4);
});

Deno.test("arXiv translation keeps a safe superset", () => {
  assert.equal(
    toArxiv(parseQuery('"machine learning" catalys* -review')),
    '(all:"machine learning" AND all:catalys*) ANDNOT all:review',
  );
  assert.equal(toArxiv(parseQuery("ti:MOF OR au:Kulik")), "ti:MOF OR au:Kulik");
  assert.equal(toArxiv(parseQuery("(MOF COF), zeolite")), "(all:MOF AND all:COF) OR all:zeolite");
  assert.equal(toArxiv(parseQuery("-review")), null);
  assert.equal(toArxiv(parseQuery("")), null);
});

Deno.test("errors and lenient parsing", () => {
  assert.throws(() => parseQuery("(a OR b"), QueryError);
  assert.throws(() => parseQuery("a OR b)"), QueryError);
  assert.equal(describe(parseQuery(", a ,, b ,")), "a 或 b");
  assert.equal(parseQuery("   "), null);
});
