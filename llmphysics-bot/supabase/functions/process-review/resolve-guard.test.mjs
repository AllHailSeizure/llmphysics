/**
 * Regression test for the url_context-fallback guard in process-review/index.ts.
 *
 * Bug: the fallback fired even after a Zenodo/figshare API branch had already
 * resolved a direct PDF link, because those links don't end in ".pdf"
 * (Zenodo → .../content, figshare → /files/<id>). It overwrote the resolved
 * URL with a Gemini guess and relabelled extraction_type 'API' → 'Gemini'.
 *
 * This test encodes the guard predicate. Run: node resolve-guard.test.mjs
 */

// The guard predicate as it exists in index.ts. Keep in sync.
// Returns true when the url_context fallback SHOULD run.
function urlContextShouldRun(resolvedUrl, extractionType) {
  return (
    !extractionType &&                                   // <-- the fix
    !resolvedUrl.toLowerCase().endsWith('.pdf') &&
    !resolvedUrl.includes('arxiv.org/pdf/')
  );
}

const cases = [
  // [name, resolvedUrl, extractionType, expectedShouldRun]
  ['zenodo API-resolved (/content)',
    'https://zenodo.org/api/records/20620088/files/Paper.pdf/content', 'API', false],
  ['figshare API-resolved (/files/<id>)',
    'https://ndownloader.figshare.com/files/29444111', 'API', false],
  ['arxiv URL-resolved',
    'https://arxiv.org/pdf/2406.08361', 'URL', false],
  ['vixra URL-resolved (.pdf)',
    'https://vixra.org/pdf/2503.0146v1.pdf', 'URL', false],
  ['unresolved landing page (no resolver matched)',
    'https://example.com/some/paper-page', null, true],
  ['direct .pdf link, no resolver',
    'https://nvlpubs.nist.gov/nistpubs/jres/126/jres.126.007.pdf', null, false],
];

let failures = 0;
for (const [name, url, type, expected] of cases) {
  const got = urlContextShouldRun(url, type);
  const ok = got === expected;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (expected ${expected}, got ${got})`);
}

if (failures) {
  console.error(`\n${failures} test(s) failed.`);
  process.exit(1);
}
console.log('\nAll guard tests passed.');
