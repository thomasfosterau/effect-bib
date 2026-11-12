# Lookup and embedded metadata

The `BiblioLookup` service and the per-source functions from `@thomasfosterau/effect-bib/sources`, and `readEmbeddedMetadata` from the root entry.

Snippets are excerpts of JSDoc `@example`s in the source, which CI compiles and executes (`vp run -r docgen`); variables an example defines earlier (`record`, `outcomes`, `article`, …) are elided here. Per-export detail (signatures, defaults, bounds) is in the doc comments, which show on hover and ship in the package `.d.ts`.

## The service

**`BiblioLookup`** — `Context.Service` with `byIsbnRecord(isbn: string)`, `byDoiRecord(doi: string)`, `byDoiCsl(doi: string)` → `Effect<Option<BiblioRecord>, LookupError>` and `byTitle(query: string)` → `Effect<readonly BiblioRecord[], LookupError>`. Each method decodes the raw identifier first and fails with `InvalidIdentifier` before any request; a clean upstream 404 is `Option.none()`; `byTitle` never fails on an empty result. `byDoiCsl` asks `https://doi.org` itself for the DOI's CSL-JSON by content negotiation (`Accept: application/vnd.citationstyles.csl+json`), which the DOI's own registration agency answers — Crossref, DataCite or mEDRA — so it reaches DOIs Crossref's API does not hold; the record carries `provenance: { source: "csl-json", retrievedBy: { identifierType: "doi", endpoint: "https://doi.org" } }`.

## Fetching a page: `byUrl` and the request policy

**`byUrl(url: string)`** → `Effect<Option<EmbeddedMetadata>, LookupError>` fetches a publisher's page and reads it with `readEmbeddedMetadata`; the page record's `URL` is the URL that finally answered (even when the page names another), and a clean 404 is `Option.none()`. Because the caller picks the URL, the fetch runs under the library's own request policy (it does not rely on your `HttpClient`):

- **Refused before any request, with `RefusedUrl { url, reason }`:** a scheme other than `http` / `https`; credentials in the URL; a non-default port; an IP literal in a private, loopback, link-local (cloud metadata `169.254.169.254` included), unique-local, carrier-grade NAT, multicast, documentation or reserved range (also as an IPv4-mapped, NAT64 or 6to4 IPv6 address, and in decimal or hex spellings); `localhost`, a single-label host, or a `.localhost`, `.local`, `.internal`, `.home.arpa`, `.localdomain` or `.lan` name.
- **Redirects** are never followed by `fetch`: each `Location` is checked against the same policy and followed by hand, at most five deep. A refused redirect, a sixth one or one without a location fails with `LookupFailed`.
- **Bounds:** ten seconds for the whole exchange, redirects and body included; a body of at most `MAX_INPUT_LENGTH` bytes, read as a stream and stopped at the cap; a `text/html` or `application/xhtml+xml` content type. Anything else is a `LookupFailed { source: "web" }`.
- **Identity:** `byUrl` sends `User-Agent: <product>` only, never the contact email, since the host is arbitrary.
- **Host names are checked as written unless you pass a resolver.** `options.resolveAddresses` (`(hostname) => Effect<readonly string[]>`) is called for each hop's host; any refused address or no address refuses the hop. The resolver cannot fail: answer a failed lookup with no addresses, which refuses the hop. A Worker cannot resolve DNS, so without the hook a public-looking name that resolves to a private address **is fetched**: the policy is fail-open for host names. On Node, pass a resolver such as `(host) => Effect.tryPromise(() => dns.promises.lookup(host, { all: true })).pipe(Effect.map((all) => all.map((a) => a.address)), Effect.orElseSucceed(() => []))`.
- **DNS rebinding is the transport's to close.** The resolver is a best-effort pre-check: the connection resolves the name again, so a host can answer the check with a public address and the connection with a private one. The library does not pin the connection, so `./sources` stays Worker-safe. A Node caller who needs the guarantee supplies, through `biblioLookupClientLayer`, an `HttpClient` whose dispatcher checks the address it actually connects to, for example an undici `Agent` with a guarded `connect.lookup`:

  ```ts skip-type-checking
  import { lookup } from "node:dns";
  import { Agent } from "undici";
  import * as Layer from "effect/Layer";
  import { FetchHttpClient } from "effect/http";

  // `isPublic` is your range check: refuse private, loopback, link-local,
  // unique-local and reserved addresses, as the library's policy does.
  const agent = new Agent({
    connect: {
      lookup: (hostname, options, callback) =>
        lookup(hostname, { ...options, all: true }, (error, addresses) => {
          if (error) return callback(error, []);
          const refused = addresses.find(({ address }) => !isPublic(address));
          return refused
            ? callback(new Error(`refused ${hostname}: ${refused.address}`), [])
            : callback(null, addresses);
        }),
    },
  });
  const pinned = FetchHttpClient.layer.pipe(
    Layer.provide(
      Layer.succeed(FetchHttpClient.Fetch, (input, init) =>
        fetch(input, { ...init, dispatcher: agent }),
      ),
    ),
  );
  const lookupLayer = biblioLookupClientLayer({ contact }).pipe(Layer.provide(pinned));
  ```

`byDoiCsl` uses the same policy for its redirects (the resolver included, when you pass one), on top of its registration-agency allow-list, and the same time and size bounds.

## Layers and contact

**`biblioLookupLayer(options): Layer<BiblioLookup>`** — production, over `FetchHttpClient` (the global fetch). **`biblioLookupClientLayer(options): Layer<BiblioLookup, never, HttpClient>`** — over whatever `HttpClient` is in context, which is how a test injects a stubbed fetch. Both attach `acceptJson`, `filterStatusOk` and a polite `User-Agent` built from the required `options.contact`. Each call builds a new layer, so build it once and share it.

**`LookupContact`** — `{ product, email }`, who is making the lookups. Every request sends `User-Agent: <product> (mailto:<email>)`, and OpenAlex requests also send `mailto=<email>`, so Crossref and OpenAlex route you to their polite pool and can reach you about your traffic. Use your own application's name and address; the package ships no default.

```ts
const program = Effect.gen(function* () {
  const lookup = yield* BiblioLookup;
  return yield* lookup.byIsbnRecord("978-0-06-231609-7");
});
const lookupLayer = biblioLookupLayer({
  contact: { product: "my-app/1.0", email: "ops@example.org" },
});
program.pipe(Effect.provide(lookupLayer)); // Effect<Option<BiblioRecord>, LookupError>
```

## Errors

**Errors** — `InvalidIdentifier { kind: "isbn" | "doi", value }` and `RefusedUrl { url, reason }` (fix the input, don't retry) and `LookupFailed { source: LookupSource, description }` (transport, non-404 status, refused redirect, bound exceeded or decode failure); `LookupError` is their union and `LookupSource` is `"openlibrary" | "crossref" | "openalex" | "doi" | "web"`.

## Per-source functions

**Per-source functions** (take an already-composed `HttpClient` and a proven identifier): `lookupOpenLibraryByIsbn(client, isbn)`, `lookupCrossrefByDoi(client, doi)`, `lookupDoiCsl(client, doi, { resolveAddresses? })`, `lookupWebPage(client, url, { resolveAddresses? })`, `lookupOpenAlexByDoi(client, doi, contact)`, `searchOpenAlexByTitle(client, query, contact)` (the OpenAlex pair sends `contact.email` as `mailto`; the User-Agent is whatever your client sets). The lenient response schemas (`OpenLibraryEdition`, `OpenLibraryAuthor`, `CrossrefResponse`, `OpenAlexWork`, `OpenAlexSearchResponse`) and normalisers (`normaliseOpenLibraryRecord`, `normaliseCrossrefRecord`, `normaliseOpenAlexRecord`) are exported so a consumer can drive them against recorded fixtures.

## Embedded metadata

**`readEmbeddedMetadata(html, options?): EmbeddedMetadata`** reads the citation metadata a web page carries: `{ page, coins }`, where `page` is the record for the page itself (`Option<BiblioRecord>`) and `coins` one record per COinS span (`<span class="Z3988" title="…">`, an OpenURL ContextObject; a list page cites many works). The page record comes from the first source that has a title, in order: the Highwire Press `<meta name="citation_…">` tags publishers write for Google Scholar, schema.org JSON-LD (`<script type="application/ld+json">`: `ScholarlyArticle`, `Book`, `Chapter`, `Dataset`, … with their authors, ORCIDs and the periodical, volume and issue they are part of, `@graph` included), then Dublin Core `<meta name="DC.…">` tags; any field it lacks is filled from the others, and `options.url` becomes its `URL` when the page names none. A `URL` is kept only as an absolute `http(s)` link (a relative one resolved against `options.url`); a `javascript:`, `data:` or other link is dropped, from every source. Every value goes through `fromCslJson`, so text is sanitised and identifiers validated; records carry `provenance: { source: "html", retrievedBy?: { identifierType: "url", identifier: options.url } }`. Pure and total: the page is scanned as text in linear time and never executed (an opening tag longer than 64 KiB is skipped), a page with no metadata yields `{ page: Option.none(), coins: [] }`, a page longer than `options.maxInputLength` (default `MAX_INPUT_LENGTH`) yields nothing, and `options.maxRecords` (default `MAX_RECORDS`) caps the COinS records.

```ts
const html = `<html><head>
  <meta name="citation_title" content="Structure of Scientific Revolutions">
  <meta name="citation_author" content="Kuhn, Thomas S.">
  <meta name="citation_doi" content="10.1037/0003-066X.59.1.29">
</head></html>`;
const { page } = readEmbeddedMetadata(html, { url: "https://example.org/kuhn" });
assert.strictEqual(Option.getOrThrow(page).identifiers.doi, "10.1037/0003-066x.59.1.29");
```
