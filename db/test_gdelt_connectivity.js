// Standalone connectivity check for GDELT's DOC 2.0 API — run this directly in the
// Render Shell (`node db/test_gdelt_connectivity.js`) to find out whether GDELT is
// actually reachable from where the collector runs, independent of any other code.
//
// Why this exists: the very first production run flagged "GDELT fetch failed" and it
// was never diagnosed. A direct test from the build environment (2026-09-02) also timed
// out at the TLS handshake. Two data points, two different networks, same symptom — but
// neither one is Render, which is what actually matters. This script isolates the one
// question that matters: can Render reach GDELT right now, yes or no, and with what
// error if not.

async function main() {
  const url = 'https://api.gdeltproject.org/api/v2/doc/doc?query=geothermal&mode=ArtList&format=json&maxrecords=3';
  console.log(`Fetching ${url} ...`);
  const startedAt = Date.now();
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'geothermal-investment-tracker/0.1' },
      signal: AbortSignal.timeout(20000),
    });
    console.log(`Response in ${Date.now() - startedAt}ms: HTTP ${res.status}`);
    if (!res.ok) {
      console.log('Non-OK status — GDELT reachable but returned an error. Body:');
      console.log((await res.text()).slice(0, 500));
      return;
    }
    const body = await res.json();
    console.log(`Success. ${(body.articles || []).length} articles returned.`);
    for (const a of (body.articles || []).slice(0, 3)) {
      console.log(`  - ${a.seendate} | ${a.title} | ${a.url}`);
    }
  } catch (err) {
    console.log(`Failed after ${Date.now() - startedAt}ms: ${err.name} — ${err.message}`);
    console.log('This means GDELT is not reachable from here right now — the historical');
    console.log('sweep (and the daily collector\'s own GDELT sweep) will not work until');
    console.log('this is resolved. Not something to retry blindly — worth checking GDELT\'s');
    console.log('own status/documentation for known outages or a required header/param change.');
  }
}

main();
