const assert = require('node:assert/strict');
const parser = require('../structured-parser.js');

const articleId = '2081762065392541951';
const payload = {
  data: {
    tweetResult: {
      result: {
        rest_id: articleId,
        legacy: { created_at: 'Sun Jul 27 15:22:08 +0000 2026', lang: 'en' },
        core: {
          user_results: {
            result: {
              legacy: {
                name: 'Waterloo Intern',
                screen_name: 'waterloo_intern',
                profile_image_url_https: 'https://pbs.twimg.com/profile_images/1/a_normal.jpg'
              }
            }
          }
        },
        article: {
          article_results: {
            result: {
              rest_id: articleId,
              title: '22580: From GPT2 to Kimi3, Explained',
              cover_media: { media_id: '100' },
              content_state: JSON.stringify({
                blocks: [
                  { key: 'a', type: 'unstyled', text: 'Intro N2', inline_style_ranges: [{ offset: 7, length: 1, style: 'SUPERSCRIPT' }], entity_ranges: [] },
                  { key: 'b', type: 'header-one', text: 'GPT-2', inline_style_ranges: [], entity_ranges: [] },
                  { key: 'c', type: 'blockquote', text: 'A quoted passage.', inline_style_ranges: [{ offset: 2, length: 6, style: 'ITALIC' }], entity_ranges: [] },
                  { key: 'd', type: 'unstyled', text: 'A direct implementation would look like this:', inline_style_ranges: [], entity_ranges: [] },
                  { key: 'e', type: 'atomic', text: ' ', inline_style_ranges: [], entity_ranges: [{ offset: 0, length: 1, key: 0 }] },
                  { key: 'f', type: 'unstyled', text: ' ', inline_style_ranges: [], entity_ranges: [{ offset: 0, length: 1, key: 1 }] },
                  { key: 'g', type: 'ordered-list-item', depth: 0, text: 'First', inline_style_ranges: [], entity_ranges: [] },
                  { key: 'h', type: 'ordered-list-item', depth: 1, text: 'Nested', inline_style_ranges: [], entity_ranges: [] },
                  { key: 'i', type: 'atomic', text: ' ', inline_style_ranges: [], entity_ranges: [{ offset: 0, length: 1, key: 2 }] },
                  { key: 'j', type: 'atomic', text: ' ', inline_style_ranges: [], entity_ranges: [{ offset: 0, length: 1, key: 3 }] },
                  { key: 'k', type: 'atomic', text: ' ', inline_style_ranges: [], entity_ranges: [{ offset: 0, length: 1, key: 4 }] }
                ],
                entities: [
                  { key: '0', value: { type: 'MARKDOWN', data: { markdown: '```python\ndef forward(x):\n    return x ** 2\n```' } } },
                  { key: '1', value: { type: 'MEDIA', data: { caption: 'Architecture', media_items: [{ media_id: '101', media_category: 'tweet_image' }] } } },
                  { key: '2', value: { type: 'LATEX', data: { latex: 'S\\cdot x \sim \mathcal{N}(0,\lVert x\rVert_2^2 I_m)' } } },
                  { key: '3', value: { type: 'LATEX', data: { entityKey: 'formula-ref-1' } } },
                  { key: '4', value: { type: 'LATEX', data: { entityKey: 'missing-formula-ref' } } }
                ]
              }),
              media_entities: [
                { id_str: '100', type: 'photo', media_url_https: 'https://pbs.twimg.com/media/COVER.jpg', original_info: { width: 1600, height: 900 } },
                { id_str: '101', type: 'photo', media_url_https: 'https://pbs.twimg.com/media/CODE.png', original_info: { width: 1200, height: 800 } }
              ],
              formula_store: {
                'formula-ref-1': {
                  entityKey: 'formula-ref-1',
                  type: 'LATEX',
                  latex: '\\frac{\Gamma(d)}{2^{d-2}\Gamma(d/2)^2}'
                }
              }
            }
          }
        }
      }
    }
  }
};

const result = parser.parseCapturedArticle({
  payloads: [{ url: 'https://x.com/i/api/graphql/test', json: payload }],
  articleUrl: `https://x.com/waterloo_intern/article/${articleId}`,
  expectedId: articleId,
  fallbackDocument: {
    metadata: { title: 'WRONG DOM TITLE' },
    blocks: [{
      type: 'formula',
      latex: '\\prod_{\ell=1}^{\log_2 d} f_{\psi^{(\ell)}}',
      entityReference: 'missing-formula-ref'
    }]
  }
});

assert.equal(result.ok, true);
assert.equal(result.document.metadata.title, '22580: From GPT2 to Kimi3, Explained');
assert.equal(result.document.diagnostics.title.source, 'article.title');
assert.equal(result.document.diagnostics.title.verified, true);
assert.equal(result.document.metadata.authorHandle, 'waterloo_intern');
assert.match(result.document.metadata.coverImage, /COVER\.jpg/);
assert.equal(result.document.blocks.filter((b) => b.type === 'code').length, 1);
assert.match(result.document.blocks.find((b) => b.type === 'code').text, /return x \*\* 2/);
assert.equal(result.document.blocks.filter((b) => b.type === 'image').length, 1);
assert.match(result.document.blocks.find((b) => b.type === 'image').src, /CODE\.png/);
assert.match(result.document.blocks[0].html, /N<sup>2<\/sup>/);
assert.equal(result.document.diagnostics.completeness.status, 'complete');
assert.equal(result.document.diagnostics.entities.markdown, 1);
assert.equal(result.document.diagnostics.entities.media, 1);
assert.equal(result.document.diagnostics.output.code, 1);
assert.equal(result.document.diagnostics.output.image, 1);
assert.equal(result.document.blocks.filter((b) => b.type === 'formula').length, 3);
assert.equal(result.document.diagnostics.entities.formula, 3);
assert.equal(result.document.diagnostics.output.formula, 3);
assert.equal(result.document.diagnostics.unresolvedFormulas.length, 0);
assert.match(result.document.blocks.find((b) => b.type === 'formula' && b.resolutionSource === 'entity-direct').latex, /mathcal/);
assert.match(result.document.blocks.find((b) => b.type === 'formula' && b.resolutionSource === 'payload-reference').latex, /Gamma/);
assert.match(result.document.blocks.find((b) => b.type === 'formula' && b.resolutionSource === 'dom-formula-fallback').latex, /prod/);

const listBlock = result.document.blocks.find((b) => b.type === 'list');
assert.equal(listBlock.ordered, true);
assert.equal(listBlock.items[0].children[0].ordered, true);
assert.equal(listBlock.items[0].children[0].items[0].html, 'Nested');

const markdown = parser.markdownToBlocks('# Heading\n\n> quote\n\n```js\nconst x = 1;\n```\n\n| A | B |\n|---|---|\n| 1 | 2 |');
assert.deepEqual(markdown.map((b) => b.type), ['heading', 'blockquote', 'code', 'table']);

console.log('structured-parser tests passed');
