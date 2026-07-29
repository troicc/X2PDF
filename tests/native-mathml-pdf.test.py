from pathlib import Path
import subprocess
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
PDF = ROOT / "tests" / "native-mathml-test.pdf"
PNG = ROOT / "tests" / "native-mathml-test.png"
FORMULAS = [
    r"S\cdot x\sim \mathcal{N}(0,\lVert x\rVert_2^2 I_m)",
    r"f_R(r)=\frac{2}{2^{d/2}\Gamma(d/2)}r^{d-1}\exp(-r^2/2)",
    r"f_\Theta(\theta)=\frac{\Gamma(d)}{2^{d-2}\Gamma(d/2)^2}\sin^{d-1}(2\theta), E[\Theta]=\pi/4 \text{ and } \operatorname{Var}(\Theta)=O(1/\sqrt d)",
    r"\arctan\!\left(\frac{x_2}{x_1}\right)",
    r"f_{R,\Psi_d}(r,\psi_d(x))=f_R(r)\prod_{\ell=1}^{\log_2 d}f_{\psi^{(\ell)}}(\psi^{(\ell)})",
    r"f_{\psi^{(1)}}:[0,2\pi)^{d/2}\to(2\pi)^{-d/2}",
    r"f_{\psi^{(\ell)}}(\psi)=\prod_{i=1}^{d/2^\ell}\frac{\Gamma(2^\ell-1)}{2^{2^{\ell-1}-2}\Gamma(2^\ell-2)^2}\sin^{2^{\ell-1}-1}(2\psi_i)",
]

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path="/usr/bin/chromium", headless=True, args=["--no-sandbox"])
    page = browser.new_page(viewport={"width": 1100, "height": 1400})
    page.set_content("<main class='content' id='out'></main>")
    page.add_style_tag(content=(ROOT / "preview.css").read_text())
    page.add_script_tag(content=(ROOT / "mathjax-config.js").read_text())
    page.add_script_tag(path=str(ROOT / "vendor/mathjax/tex-mml-svg.js"))
    page.add_script_tag(path=str(ROOT / "formula-renderer.js"))
    page.wait_for_function("window.MathJax && MathJax.startup && MathJax.startup.promise")

    for formula in FORMULAS:
        result = page.evaluate(
            """async (formula) => {
              await MathJax.startup.promise;
              const figure = document.createElement('figure');
              figure.className = 'formula-block';
              const target = document.createElement('div');
              target.className = 'formula-render-target';
              const result = await XPDFFormulaRenderer.render(
                target,
                {latex: formula, display: true},
                {allowSvgFallback: false}
              );
              figure.append(target);
              document.getElementById('out').append(figure);
              const math = target.querySelector('math');
              const meaningful = Array.from(math.childNodes).filter(
                node => node.nodeType === Node.ELEMENT_NODE ||
                  (node.nodeType === Node.TEXT_NODE && node.textContent.trim())
              );
              return {
                renderer: result.renderer,
                selectable: result.selectable,
                normalized: result.rootRowsNormalized,
                childCount: meaningful.length,
                childName: meaningful[0]?.localName || ''
              };
            }""",
            formula,
        )
        assert result["renderer"] == "native-mathml", result
        assert result["selectable"] is True, result
        assert result["normalized"] == 1, result
        assert result["childCount"] == 1 and result["childName"] == "mrow", result

    assert page.locator("math").count() == len(FORMULAS)
    assert page.locator("svg").count() == 0

    # Screen-layout regression: formulas must remain horizontal, not one glyph per line.
    screen_boxes = page.eval_on_selector_all(
        "math",
        "nodes => nodes.map(n => ({w:n.getBoundingClientRect().width,h:n.getBoundingClientRect().height}))",
    )
    assert all(box["w"] > 50 and box["h"] < 130 for box in screen_boxes), screen_boxes
    assert screen_boxes[2]["w"] > screen_boxes[2]["h"] * 3, screen_boxes[2]

    # Print-layout regression uses the same media mode as Page.printToPDF.
    page.emulate_media(media="print")
    print_boxes = page.eval_on_selector_all(
        "math",
        "nodes => nodes.map(n => ({w:n.getBoundingClientRect().width,h:n.getBoundingClientRect().height}))",
    )
    assert all(box["w"] > 50 and box["h"] < 130 for box in print_boxes), print_boxes
    assert print_boxes[2]["w"] > print_boxes[2]["h"] * 3, print_boxes[2]

    selected = page.evaluate(
        """() => {
          const math = document.querySelector('math');
          const range = document.createRange();
          range.selectNodeContents(math);
          const selection = getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
          return selection.toString();
        }"""
    )
    assert selected and len(selected) > 5, selected

    page.screenshot(path=str(PNG), full_page=True)
    page.pdf(path=str(PDF), format="A4", print_background=True)
    browser.close()

text = subprocess.check_output(["pdftotext", "-layout", str(PDF), "-"], text=True)
for token in ("𝑆", "𝑥", "Γ", "sin", "arctan", "∏", "Ψ"):
    assert token in text, (token, text)
print("native MathML horizontal-layout and PDF text-selection test passed")
