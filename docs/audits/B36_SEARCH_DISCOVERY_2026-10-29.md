# B36: Protocol search discovery

Date: 2026-10-29. Scope: `artsoulprotocol.com` only.

## Finding and correction

The public site returned HTTP 404 for both `/robots.txt` and `/sitemap.xml`.
Search Console ownership had not been verified for the Protocol domain.
The founder corrected the initial OS link and explicitly approved Protocol
DNS verification for `artsoulprotocol@gmail.com`.

One apex DNS TXT verification record was added. Google then confirmed domain
ownership and opened the `sc-domain:artsoulprotocol.com` property under that
account. Existing website and mail records were preserved. No OS DNS record,
ownership grant or application setting was changed.

This slice adds a crawler file and a three-URL sitemap: homepage, gallery and
public protocol documentation. No private account URL, staff route, beta artwork
inventory or invented modification date is submitted. Existing noindex and
server authorization remain independent of the crawler file.

The build verifier now requires both emitted files to equal their checked-in
sources. No dependency, contract, economic rule or database change is needed.
Canon relevance: public product truth and roadmap operations (sections 1, 5, 17).
No architecture amendment was interpreted or introduced.

## Validation and release

- XML parsing: three absolute Protocol URLs, valid sitemap namespace.
- `npm run build`: passed, including built asset verification and Tailwind check.
- PR #399 candidate `0babc2a5484e6a13091e15d141cded9dd2647c7e` passed
  CI40945901458: Linux 2,985 pass/two skips, Windows 2,535 pass/34 skips,
  49 contract tests each, both builds and static checks.
- Merged as `d48fd9f55735c1ac6fd1926707159eee548712ab` and released.
  Preview and apex both return HTTP 200 for both files with matching source
  content; MIME types are `text/plain` and `application/xml` respectively.
- Submitted `https://artsoulprotocol.com/sitemap.xml` in the verified property.
  Google reports **Success** and **3 discovered pages** on October 29.
- Ownership confirmation is complete; it does not prove crawling, indexing or
  search ranking. Google is still processing the new property.

Private evidence: `docs/private/search-console-protocol-verified-20261029.jpg`,
`search-console-protocol-sitemap-success-20261029.jpg`,
`b36-search-discovery-build.log`, `b36-ci40945901458.log` and
`b36-live-discovery.json` under `docs/private/`.

## Follow-up

Core discovery setup is complete. Dynamic artwork/profile discovery is a separate bounded SEO task;
do not publish private identities or unreviewed beta inventory automatically.

Official references:
- https://support.google.com/webmasters/answer/9008080
- https://support.google.com/webmasters/answer/34592
- https://support.google.com/webmasters/answer/10267942
