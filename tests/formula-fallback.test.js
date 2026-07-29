const assert = require('node:assert/strict');
const parser = require('../structured-parser.js');

const id = '2037272772305707405';
const formulas = [
  String.raw`S\cdot x\sim\mathcal{N}(0,\lVert x\rVert_2^2I_m)`,
  String.raw`f_R(r)=\frac{2}{2^{d/2}\Gamma(d/2)}r^{d-1}\exp(-r^2/2)`,
  String.raw`\arctan\left(\frac{x_2}{x_1}\right)`,
  String.raw`f_\Theta(\theta)=\frac{\Gamma(d)}{2^{d-2}\Gamma(d/2)^2}\sin^{d-1}(2\theta)`,
  String.raw`f_{R,\Psi_d}(r,\psi_d(x))=f_R(r)\prod_{\ell=1}^{\log_2d}f_{\psi^{(\ell)}}(\psi^{(\ell)})`,
  String.raw`f_{\psi^{(\ell)}}(\psi)=\prod_i\sin^{2^{\ell-1}-1}(2\psi_i)`
];
const blocks = [];
const entityMap = {};
for (let i = 0; i < formulas.length; i += 1) {
  blocks.push({ key: `b${i}`, type: 'atomic', text: ' ', inline_style_ranges: [], entity_ranges: [{offset: 0, length: 1, key: i}] });
  entityMap[i] = { value: { type: 'LATEX', data: { entityKey: `missing-${i}` } } };
}
const payload = {
  data: {
    result: {
      rest_id: id,
      article: {
        article_results: {
          result: {
            title: 'Formula test',
            content_state: { blocks, entityMap }
          }
        }
      }
    }
  }
};
const fallbackDocument = {
  metadata: {},
  blocks: formulas.map((latex) => ({ type: 'formula', latex, resolutionSource: 'scroll-capture-formula' }))
};
const result = parser.parseCapturedArticle({
  payloads: [{json: payload}],
  articleUrl: `https://x.com/waterloo_intern/article/${id}`,
  expectedId: id,
  fallbackDocument
});
assert.equal(result.ok, true);
const output = result.document.blocks.filter((block) => block.type === 'formula');
assert.equal(output.length, 6);
assert.deepEqual(output.map((block) => block.latex), formulas);
assert.equal(result.document.diagnostics.entities.formula, 6);
assert.equal(result.document.diagnostics.unresolvedFormulas.length, 0);
assert.equal(result.document.diagnostics.completeness.formulaBlocks, 6);
console.log('formula fallback tests passed');
