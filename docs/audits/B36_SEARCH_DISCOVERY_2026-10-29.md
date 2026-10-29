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
- Exact-candidate CI, production release and Google sitemap submission: pending.
- Ownership confirmation is complete; it does not prove crawling, indexing or
  search ranking. Google is still processing the new property.

Private evidence: `docs/private/search-console-protocol-verified-20261029.jpg`
and `docs/private/b36-search-discovery-build.log`.

## Follow-up

Verify the released files return HTTP 200 and submit this sitemap in the verified
property. Dynamic artwork/profile discovery is a separate bounded SEO task;
do not publish private identities or unreviewed beta inventory automatically.

Official references:
- https://support.google.com/webmasters/answer/9008080
- https://support.google.com/webmasters/answer/34592
- https://support.google.com/webmasters/answer/10267942
