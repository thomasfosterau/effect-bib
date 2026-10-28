/**
 * The request policy every lookup that follows a server-chosen URL applies:
 * `byUrl` (a caller-supplied page) and DOI content negotiation (a resolver
 * redirect). It is the server-side request forgery (SSRF) boundary, so it
 * lives in the library rather than in the caller's `HttpClient` (#111).
 *
 * A URL is fetched only when it is `http` or `https`, carries no
 * credentials, uses its scheme's default port, and names a host that is not
 * a private, loopback, link-local, unique-local, reserved or metadata
 * address (an IP literal in such a range, `localhost`, a single-label name,
 * or a `.local` / `.internal` / `.home.arpa` name). When the caller supplies
 * a resolver, every address a host resolves to is held to the same ranges;
 * without one (a Worker cannot resolve DNS) only the URL itself is checked.
 * Redirects are never followed by `fetch`: each one is re-checked against
 * the policy and followed by hand, at most {@link MAX_REDIRECTS} deep. The
 * whole exchange is bounded by {@link FETCH_TIMEOUT} and the body read by
 * {@link readBoundedText} is capped.
 *
 * @copyright Thomas Foster
 * @module biblio/sources/fetch-policy
 * @since 1.0.0
 */

import * as Array from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Stream from "effect/Stream";
import * as String from "effect/String";
import { FetchHttpClient, Headers, type HttpClient, type HttpClientResponse } from "effect/http";
import { LookupFailed, type LookupSource, RefusedUrl } from "./errors.ts";

/**
 * The most redirects followed from the first URL.
 *
 * @since 1.0.0
 */
export const MAX_REDIRECTS = 5;

/**
 * The time allowed for one guarded exchange, every redirect and the body
 * read included.
 *
 * @since 1.0.0
 */
export const FETCH_TIMEOUT = "10 seconds";

/**
 * Resolves a host name to the addresses it would connect to (IPv4 dotted
 * quads or IPv6 text, without brackets). Supplied by a caller whose runtime
 * can resolve DNS (Node's `dns.promises.lookup`, say); a failure or an empty
 * answer refuses the host.
 *
 * @since 1.0.0
 */
export type ResolveAddresses = (hostname: string) => Effect.Effect<readonly string[], unknown>;

/**
 * How {@link fetchGuarded} treats one exchange: the source its failures are
 * reported against, an optional extra test each hop must pass (DOI
 * negotiation's agency allow-list), and an optional resolver.
 *
 * @since 1.0.0
 */
export interface FetchPolicy {
  readonly source: LookupSource;
  readonly allowHop: Option.Option<(url: URL) => boolean>;
  readonly resolveAddresses: Option.Option<ResolveAddresses>;
}

// ── Addresses ────────────────────────────────────────────────────────

/** An IPv4 range: its network address as a 32-bit number and its prefix length. */
type Range4 = readonly [network: number, prefix: number];

/** Packs four octets into an unsigned 32-bit number. */
const pack4 = (a: number, b: number, c: number, d: number): number =>
  ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;

/** The IPv4 ranges never fetched: this-network, private, shared, loopback, link-local (cloud metadata), protocol, documentation, benchmarking, multicast and reserved. */
const REFUSED_V4: readonly Range4[] = [
  [pack4(0, 0, 0, 0), 8],
  [pack4(10, 0, 0, 0), 8],
  [pack4(100, 64, 0, 0), 10],
  [pack4(127, 0, 0, 0), 8],
  [pack4(169, 254, 0, 0), 16],
  [pack4(172, 16, 0, 0), 12],
  [pack4(192, 0, 0, 0), 24],
  [pack4(192, 0, 2, 0), 24],
  [pack4(192, 88, 99, 0), 24],
  [pack4(192, 168, 0, 0), 16],
  [pack4(198, 18, 0, 0), 15],
  [pack4(198, 51, 100, 0), 24],
  [pack4(203, 0, 113, 0), 24],
  [pack4(224, 0, 0, 0), 4],
  [pack4(240, 0, 0, 0), 4],
];

/** True when `address` falls in `range`. */
const inRange4 = (address: number, [network, prefix]: Range4): boolean =>
  prefix === 0 || address >>> (32 - prefix) === network >>> (32 - prefix);

/** True for an IPv4 address in a refused range. */
const refused4 = (address: number): boolean =>
  Array.some(REFUSED_V4, (range) => inRange4(address, range));

/** A dotted-quad IPv4 address as a 32-bit number. */
function parse4(text: string): Option.Option<number> {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(text)) return Option.none();
  const octets = text.split(".").map(Number);
  return Array.every(octets, (octet) => octet <= 255)
    ? Option.some(pack4(octets[0] ?? 0, octets[1] ?? 0, octets[2] ?? 0, octets[3] ?? 0))
    : Option.none();
}

/** One side of an IPv6 address around `::`, as 16-bit groups. */
function groups6(side: string): Option.Option<readonly number[]> {
  if (side === "") return Option.some([]);
  const parts = side.split(":");
  return Array.every(parts, (part) => /^[0-9a-f]{1,4}$/i.test(part))
    ? Option.some(parts.map((part) => Number.parseInt(part, 16)))
    : Option.none();
}

/** An IPv6 address (no brackets, no zone) as its eight 16-bit groups. */
function parse6(text: string): Option.Option<readonly number[]> {
  const halves = text.split("::");
  if (halves.length > 2) return Option.none();
  return Option.flatMap(groups6(halves[0] ?? ""), (head) =>
    Option.flatMap(groups6(halves[1] ?? ""), (tail) => {
      if (halves.length === 1) return head.length === 8 ? Option.some(head) : Option.none();
      const missing = 8 - head.length - tail.length;
      return missing >= 1
        ? Option.some([...head, ...Array.replicate(0, missing), ...tail])
        : Option.none();
    }),
  );
}

/** The IPv4 address held in two 16-bit groups. */
const embedded4 = (high: number, low: number): number => ((high << 16) | low) >>> 0;

/**
 * True for an IPv6 address that is unspecified, loopback or IPv4-compatible,
 * unique-local, link-local, site-local, multicast, documentation, discard
 * or Teredo, or that embeds a refused IPv4 address (IPv4-mapped, NAT64,
 * 6to4).
 */
function refused6(g: readonly number[]): boolean {
  const at = (index: number): number => g[index] ?? 0;
  const first = at(0);
  if (Array.every(g.slice(0, 6), (group) => group === 0)) return true;
  if (Array.every(g.slice(0, 5), (group) => group === 0) && at(5) === 0xffff)
    return refused4(embedded4(at(6), at(7)));
  if ((first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80) return true;
  if ((first & 0xffc0) === 0xfec0 || (first & 0xff00) === 0xff00) return true;
  if (first === 0x2001 && (at(1) === 0x0db8 || at(1) === 0)) return true;
  if (first === 0x0100 && at(1) === 0 && at(2) === 0 && at(3) === 0) return true;
  if (first === 0x0064 && at(1) === 0xff9b) return at(2) !== 0 || refused4(embedded4(at(6), at(7)));
  if (first === 0x2002) return refused4(embedded4(at(1), at(2)));
  return false;
}

/**
 * Why an IP address (IPv4 dotted quad or IPv6 text without brackets) may
 * not be fetched, or `None` when it is a public address. Text that is
 * neither is refused.
 *
 * @since 1.0.0
 */
export function addressRefusal(address: string): Option.Option<string> {
  const v4 = parse4(address);
  if (Option.isSome(v4))
    return refused4(v4.value) ? Option.some(`a non-public address (${address})`) : Option.none();
  return Option.match(parse6(address.toLowerCase()), {
    onNone: () => Option.some(`an unrecognised address (${address})`),
    onSome: (groups) =>
      refused6(groups) ? Option.some(`a non-public address (${address})`) : Option.none(),
  });
}

/** Host-name suffixes that only ever name a local network or the host itself. */
const LOCAL_SUFFIXES = ["localhost", "local", "internal", "home.arpa", "localdomain", "lan"];

/** Why a host (as `URL.hostname` spells it) may not be fetched, or `None`. */
function hostRefusal(hostname: string): Option.Option<string> {
  const host = String.toLowerCase(hostname.endsWith(".") ? hostname.slice(0, -1) : hostname);
  if (host.startsWith("[") && host.endsWith("]")) return addressRefusal(host.slice(1, -1));
  if (Option.isSome(parse4(host))) return addressRefusal(host);
  if (!host.includes(".")) return Option.some(`a single-label host (${host})`);
  return Array.some(LOCAL_SUFFIXES, (suffix) => host === suffix || host.endsWith(`.${suffix}`))
    ? Option.some(`a local host name (${host})`)
    : Option.none();
}

/** True when the host is an IP literal, which needs no resolution. */
const isIpLiteral = (hostname: string): boolean =>
  hostname.startsWith("[") || Option.isSome(parse4(hostname));

/**
 * Why a URL may not be fetched under the policy (scheme, credentials, port,
 * host), or `None` when it may.
 *
 * @since 1.0.0
 */
export function urlRefusal(url: URL): Option.Option<string> {
  if (url.protocol !== "https:" && url.protocol !== "http:")
    return Option.some(`the ${url.protocol} scheme`);
  if (url.username !== "" || url.password !== "") return Option.some("embedded credentials");
  if (url.port !== "") return Option.some(`a non-default port (${url.port})`);
  return hostRefusal(url.hostname);
}

/**
 * Parses `location` against `base` and applies {@link urlRefusal}: the URL
 * to fetch, or why it may not be.
 *
 * @since 1.0.0
 */
export function checkUrl(location: string, base?: string): Result.Result<URL, string> {
  return Result.try({
    try: () => new URL(location, base),
    catch: () => "an unparseable URL",
  }).pipe(
    Result.flatMap((url) =>
      Option.match(urlRefusal(url), {
        onNone: () => Result.succeed(url),
        onSome: (reason) => Result.fail(reason),
      }),
    ),
  );
}

// ── Guarded exchange ─────────────────────────────────────────────────

/** The full policy check of one hop: the URL, the extra hop test and, when there is a resolver, every resolved address. */
function hopRefusal(url: URL, policy: FetchPolicy): Effect.Effect<Option.Option<string>> {
  const syntactic = urlRefusal(url);
  if (Option.isSome(syntactic)) return Effect.succeed(syntactic);
  if (Option.isSome(policy.allowHop) && !policy.allowHop.value(url))
    return Effect.succeed(Option.some(`a host outside the allow-list (${url.hostname})`));
  const resolve = policy.resolveAddresses;
  if (Option.isNone(resolve) || isIpLiteral(url.hostname)) return Effect.succeed(Option.none());
  return resolve.value(url.hostname).pipe(
    Effect.result,
    Effect.map(
      Result.match({
        onFailure: () => Option.some(`${url.hostname}, which failed to resolve`),
        onSuccess: (addresses) =>
          Array.isReadonlyArrayNonEmpty(addresses)
            ? Array.findFirst(addresses, (address) => Option.isSome(addressRefusal(address))).pipe(
                Option.map((address) => `${url.hostname}, which resolves to ${address}`),
              )
            : Option.some(`${url.hostname}, which resolves to no address`),
      }),
    ),
  );
}

/** Sends one hop with redirects left to the caller, so each is checked before it is followed. */
function send(
  client: HttpClient.HttpClient,
  url: string,
  source: LookupSource,
): Effect.Effect<HttpClientResponse.HttpClientResponse, LookupFailed> {
  const request = client.get(url).pipe(
    // A client under `filterStatusOk` turns a 3xx or 404 into an error; read the response either way.
    Effect.catchTag("HttpClientError", (error) =>
      error.reason._tag === "StatusCodeError"
        ? Effect.succeed(error.reason.response)
        : Effect.fail(
            new LookupFailed({ source, description: `request failed: ${error.reason._tag}` }),
          ),
    ),
  );
  return Effect.flatMap(Effect.serviceOption(FetchHttpClient.RequestInit), (init) =>
    Effect.provideService(request, FetchHttpClient.RequestInit, {
      ...Option.getOrElse(init, () => ({})),
      redirect: "manual",
    }),
  );
}

/** The final (non-redirect) response of a guarded exchange, and the URL that gave it. */
export interface GuardedResponse {
  readonly url: URL;
  readonly response: HttpClientResponse.HttpClientResponse;
}

/** Follows the exchange from `url`, checking each hop before it is sent. */
function follow(
  client: HttpClient.HttpClient,
  url: URL,
  policy: FetchPolicy,
  hops: number,
): Effect.Effect<GuardedResponse, LookupFailed | RefusedUrl> {
  const failed = (description: string) => new LookupFailed({ source: policy.source, description });
  return Effect.flatMap(hopRefusal(url, policy), (refusal) => {
    if (Option.isSome(refusal))
      return hops === 0
        ? Effect.fail(new RefusedUrl({ url: url.href, reason: refusal.value }))
        : Effect.fail(failed(`refused a redirect to ${refusal.value}`));
    return Effect.flatMap(send(client, url.href, policy.source), (response) => {
      if (response.status < 300 || response.status >= 400) return Effect.succeed({ url, response });
      if (hops >= MAX_REDIRECTS) return Effect.fail(failed("too many redirects"));
      return Option.match(Headers.get(response.headers, "location"), {
        onNone: () => Effect.fail(failed(`redirect ${response.status} without a location`)),
        onSome: (location) =>
          Result.match(
            Result.try({ try: () => new URL(location, url), catch: () => "unparseable" }),
            {
              onFailure: () => Effect.fail(failed("redirect to an unparseable location")),
              onSuccess: (next) => follow(client, next, policy, hops + 1),
            },
          ),
      });
    });
  });
}

/**
 * Fetches `url` under the policy: every hop (the first included) is checked
 * with {@link urlRefusal}, the policy's `allowHop` and its resolver before
 * it is sent; redirects are followed by hand, at most
 * {@link MAX_REDIRECTS}. `read` handles the first non-3xx response,
 * whatever its status, and runs inside the same {@link FETCH_TIMEOUT} as
 * the hops, so a slow body is bounded too. A refused first URL is a
 * {@link RefusedUrl}; a refused redirect, a transport fault or a timeout is
 * a {@link LookupFailed}.
 *
 * @since 1.0.0
 */
export const fetchGuarded = <A, E>(
  client: HttpClient.HttpClient,
  url: URL,
  policy: FetchPolicy,
  read: (answer: GuardedResponse) => Effect.Effect<A, E>,
): Effect.Effect<A, E | LookupFailed | RefusedUrl> =>
  follow(client, url, policy, 0).pipe(
    Effect.flatMap(read),
    Effect.timeoutOrElse({
      duration: FETCH_TIMEOUT,
      orElse: () =>
        Effect.fail(new LookupFailed({ source: policy.source, description: "timed out" })),
    }),
  );

/** A body over the cap, raised while it streams in. */
const tooLarge = (source: LookupSource, maxBytes: number): LookupFailed =>
  new LookupFailed({ source, description: `response larger than ${maxBytes} bytes` });

/**
 * Reads a response body as UTF-8 text, failing with {@link LookupFailed} as
 * soon as it exceeds `maxBytes` (a declared `Content-Length` over the cap
 * fails before any of it is read), so an endless or oversized body is never
 * buffered whole.
 *
 * @since 1.0.0
 */
export function readBoundedText(
  response: HttpClientResponse.HttpClientResponse,
  maxBytes: number,
  source: LookupSource,
): Effect.Effect<string, LookupFailed> {
  const declared = Option.flatMap(Headers.get(response.headers, "content-length"), (length) =>
    /^\d+$/.test(length) ? Option.some(Number(length)) : Option.none(),
  );
  if (Option.isSome(declared) && declared.value > maxBytes)
    return Effect.fail(tooLarge(source, maxBytes));
  return response.stream.pipe(
    Stream.mapError(() => new LookupFailed({ source, description: "failed to read the response" })),
    Stream.mapAccumEffect(
      () => 0,
      (seen: number, chunk: Uint8Array) =>
        seen + chunk.byteLength > maxBytes
          ? Effect.fail(tooLarge(source, maxBytes))
          : Effect.succeed([seen + chunk.byteLength, [chunk]] as const),
    ),
    Stream.runCollect,
    Effect.map((chunks) => {
      const bytes = new Uint8Array(Array.reduce(chunks, 0, (sum, chunk) => sum + chunk.byteLength));
      Array.reduce(chunks, 0, (offset, chunk) => {
        bytes.set(chunk, offset);
        return offset + chunk.byteLength;
      });
      return new TextDecoder().decode(bytes);
    }),
  );
}

/**
 * A response's media type (`text/html` from `text/html; charset=utf-8`),
 * lower-cased, or `""` when it declares none.
 *
 * @since 1.0.0
 */
export const mediaType = (response: HttpClientResponse.HttpClientResponse): string =>
  Option.match(Headers.get(response.headers, "content-type"), {
    onNone: () => "",
    onSome: (value) => String.toLowerCase((value.split(";")[0] ?? "").trim()),
  });
