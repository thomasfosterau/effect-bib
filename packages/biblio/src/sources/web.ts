/**
 * A publisher's page, fetched and read for the citation metadata it embeds
 * (Highwire Press tags, schema.org JSON-LD, Dublin Core, COinS) with
 * {@link readEmbeddedMetadata}. The URL comes from the caller, so the fetch
 * runs under the library's request policy (`fetch-policy.ts`): no private or
 * local-network host, no credentials or odd ports, every redirect re-checked
 * and followed by hand, a time and size limit, and an HTML content type.
 *
 * @copyright Thomas Foster
 * @module biblio/sources/web
 * @since 1.0.0
 */

import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import { HttpClient, HttpClientRequest } from "effect/http";
import { type EmbeddedMetadata, readEmbeddedMetadata } from "../embedded.ts";
import { MAX_INPUT_LENGTH } from "../parse.ts";
import { LookupFailed, RefusedUrl } from "./errors.ts";
import {
  checkUrl,
  fetchGuarded,
  mediaType,
  readBoundedText,
  type ResolveAddresses,
} from "./fetch-policy.ts";

/** The media types read as a page. */
const HTML_TYPES = ["text/html", "application/xhtml+xml"];

/** What a page fetch asks for. */
const ACCEPT_HTML = "text/html, application/xhtml+xml;q=0.9";

/**
 * How {@link lookupWebPage} fetches: an optional resolver that holds every
 * address a host resolves to to the request policy (see
 * {@link ResolveAddresses}).
 *
 * @since 1.0.0
 */
export interface WebPageOptions {
  readonly resolveAddresses?: ResolveAddresses;
}

/** A `LookupFailed` from a page fetch. */
const failed = (description: string): LookupFailed =>
  new LookupFailed({ source: "web", description });

/**
 * Fetches the page at `url` and reads its embedded citation metadata, the
 * page record's URL being the one that finally answered. `Option.none()` on
 * a clean 404. A URL the request policy refuses — not `http` / `https`,
 * with credentials or a non-default port, or naming a private, loopback,
 * link-local, unique-local, reserved or local-network host (or, with
 * `options.resolveAddresses`, a host resolving to one) — fails with
 * {@link RefusedUrl} before any request. A redirect is re-checked against
 * the same policy and followed by hand, at most five deep; a refused one,
 * any other status, a response that is not `text/html` /
 * `application/xhtml+xml`, a body over `MAX_INPUT_LENGTH` bytes or an
 * exchange over ten seconds fails with {@link LookupFailed}. The body is
 * read as UTF-8. `client` is expected to carry the User-Agent; the request
 * asks for HTML whatever `Accept` the client sets.
 *
 * @since 1.0.0
 */
export const lookupWebPage: (
  client: HttpClient.HttpClient,
  url: string,
  options?: WebPageOptions,
) => Effect.Effect<Option.Option<EmbeddedMetadata>, LookupFailed | RefusedUrl> = Effect.fn(
  "lookupWebPage",
)(function* (client: HttpClient.HttpClient, url: string, options: WebPageOptions = {}) {
  const start = checkUrl(url);
  if (Result.isFailure(start)) return yield* new RefusedUrl({ url, reason: start.failure });
  const { url: answered, response } = yield* fetchGuarded(
    client.pipe(HttpClient.mapRequest(HttpClientRequest.setHeader("accept", ACCEPT_HTML))),
    start.success,
    {
      source: "web",
      allowHop: Option.none(),
      resolveAddresses: Option.fromUndefinedOr(options.resolveAddresses),
    },
  );
  if (response.status === 404) return Option.none();
  if (response.status < 200 || response.status >= 300)
    return yield* failed(`upstream returned HTTP ${response.status}`);
  const type = mediaType(response);
  if (!HTML_TYPES.includes(type))
    return yield* failed(`not an HTML page (${type === "" ? "no content type" : type})`);
  const html = yield* readBoundedText(response, MAX_INPUT_LENGTH, "web");
  return Option.some(readEmbeddedMetadata(html, { url: answered.href }));
});
