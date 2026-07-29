const assert = require('node:assert/strict');
const parser = require('../structured-parser.js');

const duplicatedMalformed = String.raw`\boldsymbol𝑆 \cdot \boldsymbol𝑥 \sim \mathcal N(\boldsymbol0, \lVert\boldsymbol𝑥\rVert_2^2 \cdot \boldsymbol𝐼_m)
\boldsymbol𝑆 \cdot \boldsymbol𝑥 \sim \mathcal N(\boldsymbol0, \lVert\boldsymbol𝑥\rVert_2^2 \cdot \boldsymbol𝐼_m)`;
const normalized = parser.normalizeFormulaSource(duplicatedMalformed, {forced: true});
assert.ok(normalized?.latex);
assert.equal((normalized.latex.match(/\\sim/g) || []).length, 1, normalized.latex);
assert.doesNotMatch(normalized.latex, /\\boldsymbol[𝑆𝑥𝐼0A-Za-z0-9]/);
assert.match(normalized.latex, /\\mathbf\{S\}/);
assert.match(normalized.latex, /\\mathbf\{x\}/);

const ordinary = String.raw`f_R(r)=\frac{2}{2^{d/2}\Gamma(d/2)}r^{d-1}\exp(-r^2/2)`;
assert.equal(parser.normalizeFormulaSource(ordinary, {forced: true}).latex, ordinary);
console.log('formula normalization tests passed');
