const assert = require('node:assert/strict');
const { mathjax } = require('/usr/local/slides_js/node_modules/mathjax-full/js/mathjax.js');
const { TeX } = require('/usr/local/slides_js/node_modules/mathjax-full/js/input/tex.js');
const { SVG } = require('/usr/local/slides_js/node_modules/mathjax-full/js/output/svg.js');
const { liteAdaptor } = require('/usr/local/slides_js/node_modules/mathjax-full/js/adaptors/liteAdaptor.js');
const { RegisterHTMLHandler } = require('/usr/local/slides_js/node_modules/mathjax-full/js/handlers/html.js');
const { AllPackages } = require('/usr/local/slides_js/node_modules/mathjax-full/js/input/tex/AllPackages.js');

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
const tex = new TeX({ packages: AllPackages });
const svg = new SVG({ fontCache: 'local' });
const html = mathjax.document('', { InputJax: tex, OutputJax: svg });
const formulas = [
  String.raw`S\cdot x\sim \mathcal{N}(0,\lVert x\rVert_2^2 I_m)`,
  String.raw`f_\Theta(\theta)=\frac{\Gamma(d)}{2^{d-2}\Gamma(d/2)^2}\sin^{d-1}(2\theta)`,
  String.raw`f_R(r)=\frac{2}{2^{d/2}\Gamma(d/2)}r^{d-1}\exp(-r^2/2)`,
  String.raw`\arctan\!\left(\frac{x_2}{x_1}\right)`,
  String.raw`f_{R,\Psi_d}(r,\psi_d(x))=f_R(r)\prod_{\ell=1}^{\log_2 d}f_{\psi^{(\ell)}}(\psi^{(\ell)})`,
  String.raw`f_{\psi^{(1)}}:[0,2\pi)^{d/2}\to(2\pi)^{-d/2}`,
  String.raw`f_{\psi^{(\ell)}}(\psi)=\prod_{i=1}^{d/2^\ell}\frac{\Gamma(2^\ell-1)}{2^{2^{\ell-1}-2}\Gamma(2^\ell-2)^2}\sin^{2^{\ell-1}-1}(2\psi_i)`
];
for (const formula of formulas) {
  const node = html.convert(formula, { display: true });
  const output = adaptor.outerHTML(node);
  assert.match(output, /<svg/);
  assert.match(output, /<path/);
}
console.log('mathjax SVG tests passed');
