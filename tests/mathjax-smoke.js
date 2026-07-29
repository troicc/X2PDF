(async () => {
  try {
    await MathJax.startup.promise;
    const target = document.getElementById('out');
    const result = await XPDFFormulaRenderer.render(target, {
      latex: String.raw`f_\Theta(\theta)=\frac{\Gamma(d)}{2^{d-2}\Gamma(d/2)^2}\sin^{d-1}(2\theta)`,
      display: true
    }, { allowSvgFallback: false });
    document.getElementById('status').textContent = result.renderer === 'native-mathml' && target.querySelector('math') ? 'ok' : 'no-mathml';
  } catch (error) {
    document.getElementById('status').textContent = `error:${error.message}`;
  }
})();
