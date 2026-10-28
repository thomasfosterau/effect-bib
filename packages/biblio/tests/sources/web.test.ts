/**
 * Unit tests for `BiblioLookup.byUrl` (`src/sources/web.ts`) and the request
 * policy it runs under (`src/sources/fetch-policy.ts`, #111): every refusal
 * the policy makes, on the first URL and on a redirect hop, and the bounds
 * (redirects, size, content type, time). The network is stubbed at
 * `FetchHttpClient.Fetch`; no test here reaches the network.
 *
 * @module tests/unit/biblio-sources-web
 */

import { describe, expect, it } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as TestClock from "effect/testing/TestClock";
import { FetchHttpClient, type HttpClient } from "effect/http";
import {
  BiblioLookup,
  biblioLookupClientLayer,
  type BiblioLookupOptions,
  LookupFailed,
  RefusedUrl,
} from "@thomasfosterau/biblio/sources";
import { addressRefusal } from "../../src/sources/fetch-policy.ts";
import { MAX_INPUT_LENGTH } from "../../src/parse.ts";
import { expectFailureInstanceOf, runTest } from "../effect.ts";
import { stubRouter, type StubRoute } from "./stub-http.ts";
import { expectSome } from "../assert.ts";

const CONTACT = { product: "biblio-tests/0.0", email: "biblio+tests@example.org" } as const;

const PAGE = `<html><head>
  <meta name="citation_title" content="Structure of Scientific Revolutions">
  <meta name="citation_author" content="Kuhn, Thomas S.">
</head><body></body></html>`;

/** A 200 HTML page route. */
const html = (raw = PAGE, contentType = "text/html; charset=utf-8"): StubRoute => ({
  status: 200,
  body: {},
  raw,
  contentType,
});

/** A redirect route. */
const redirect = (location: string, status = 302): StubRoute => ({ status, body: {}, location });

/** `byUrl` over a stub layer, un-run. */
const byUrl = (
  layer: Layer.Layer<HttpClient.HttpClient>,
  url: string,
  options: Partial<BiblioLookupOptions> = {},
) =>
  Effect.gen(function* () {
    const lookup = yield* BiblioLookup;
    return yield* lookup.byUrl(url);
  }).pipe(
    Effect.provide(
      biblioLookupClientLayer({ contact: CONTACT, ...options }).pipe(Layer.provide(layer)),
    ),
  );

const START = "https://example.org/paper";

describe("BiblioLookup.byUrl", () => {
  it("reads the page's embedded metadata, identifying itself without the contact email", async () => {
    const { layer, urls, userAgents, accepts, redirects } = stubRouter({ [START]: html() });
    const found = expectSome(await runTest(byUrl(layer, START)), "page metadata");
    const record = expectSome(found.page, "a page record");
    expect(record.title).toBe("Structure of Scientific Revolutions");
    expect(record.URL).toBe(START);
    expect(urls).toEqual([START]);
    expect(userAgents).toEqual([CONTACT.product]);
    expect(accepts[0]).toContain("text/html");
    expect(redirects).toEqual(["manual"]);
  });

  it("accepts application/xhtml+xml", async () => {
    const { layer } = stubRouter({ [START]: html(PAGE, "application/xhtml+xml") });
    const found = expectSome(await runTest(byUrl(layer, START)), "page metadata");
    expect(Option.isSome(found.page)).toBe(true);
  });

  it("returns Option.none on a clean 404", async () => {
    const { layer } = stubRouter({});
    expect(Option.isNone(await runTest(byUrl(layer, START)))).toBe(true);
  });

  it("follows a redirect to a public host by hand, the page URL being the one that answered", async () => {
    const next = "https://www.example.com/articles/1";
    const { layer, urls, redirects } = stubRouter({
      [START]: redirect("//www.example.com/articles/1", 301),
      [next]: html(),
    });
    const found = expectSome(await runTest(byUrl(layer, START)), "page metadata");
    expect(expectSome(found.page, "a page record").URL).toBe(next);
    expect(urls).toEqual([START, next]);
    expect(redirects).toEqual(["manual", "manual"]);
  });

  it.each([
    ["an unparseable URL", "not a url"],
    ["the ftp scheme", "ftp://example.org/paper"],
    ["the file scheme", "file:///etc/passwd"],
    ["the javascript scheme", "javascript:alert(1)"],
    ["embedded credentials", "https://user:secret@example.org/paper"],
    ["a non-default port", "https://example.org:8443/paper"],
    ["a non-default http port", "http://example.org:8080/paper"],
    ["IPv4 loopback", "http://127.0.0.1/admin"],
    ["IPv4 loopback in decimal", "http://2130706433/"],
    ["IPv4 loopback in hex", "http://0x7f.1/"],
    ["this network", "http://0.0.0.0/"],
    ["10/8", "http://10.1.2.3/"],
    ["172.16/12", "http://172.20.0.1/"],
    ["192.168/16", "http://192.168.1.1/"],
    ["carrier-grade NAT", "http://100.64.0.1/"],
    ["the cloud metadata address", "http://169.254.169.254/latest/meta-data/"],
    ["multicast", "http://224.0.0.1/"],
    ["the broadcast address", "http://255.255.255.255/"],
    ["IPv6 loopback", "http://[::1]/"],
    ["IPv6 unspecified", "http://[::]/"],
    ["IPv4-mapped loopback", "http://[::ffff:127.0.0.1]/"],
    ["IPv6 link-local", "http://[fe80::1]/"],
    ["IPv6 unique-local", "http://[fd12:3456::1]/"],
    ["NAT64 of a private address", "http://[64:ff9b::a00:1]/"],
    ["6to4 of loopback", "http://[2002:7f00:1::1]/"],
    ["localhost", "http://localhost/"],
    ["localhost with a trailing dot", "http://localhost./"],
    ["a .localhost name", "http://app.localhost/"],
    ["a .local name", "http://printer.local/"],
    ["an .internal name", "http://metadata.google.internal/computeMetadata/v1/"],
    ["a .home.arpa name", "http://router.home.arpa/"],
    ["a single-label host", "http://intranet/"],
  ])("refuses %s with RefusedUrl before any request", async (_, url) => {
    const { layer, urls } = stubRouter({});
    const failure = await expectFailureInstanceOf(byUrl(layer, url), RefusedUrl);
    expect(failure).toMatchObject({ url });
    expect(urls).toEqual([]);
  });

  it.each([
    ["a loopback address", "https://127.0.0.1/"],
    ["the metadata address over http", "http://169.254.169.254/latest/meta-data/"],
    ["an IPv6 unique-local address", "https://[fc00::1]/"],
    ["localhost", "http://localhost:80/"],
    ["a host with credentials", "https://user:pw@example.com/"],
    ["a non-default port", "https://example.com:8443/"],
    ["the file scheme", "file:///etc/passwd"],
    ["an unparseable location", "https://[bad"],
  ])("refuses a redirect to %s with LookupFailed", async (_, location) => {
    const { layer, urls } = stubRouter({ [START]: redirect(location) });
    const failure = await expectFailureInstanceOf(byUrl(layer, START), LookupFailed);
    expect(failure).toMatchObject({ source: "web" });
    expect(urls).toEqual([START]);
  });

  it("fails on a redirect loop after five redirects, and on a redirect without a location", async () => {
    const loop = stubRouter({ [START]: redirect(START) });
    await expectFailureInstanceOf(byUrl(loop.layer, START), LookupFailed);
    expect(loop.urls).toHaveLength(6);
    const bare = stubRouter({ [START]: { status: 303, body: {} } });
    await expectFailureInstanceOf(byUrl(bare.layer, START), LookupFailed);
  });

  it.each([
    ["JSON", "application/json"],
    ["plain text", "text/plain"],
    ["an image", "image/png"],
  ])("refuses a %s response", async (_, contentType) => {
    const { layer } = stubRouter({ [START]: html(PAGE, contentType) });
    const failure = await expectFailureInstanceOf(byUrl(layer, START), LookupFailed);
    expect(failure).toMatchObject({ description: expect.stringContaining("not an HTML page") });
  });

  it("fails on an upstream 5xx", async () => {
    const { layer } = stubRouter({ [START]: { ...html(), status: 503 } });
    await expectFailureInstanceOf(byUrl(layer, START), LookupFailed);
  });

  it("refuses a body declared larger than the cap before reading it", async () => {
    const { layer } = stubRouter({
      [START]: { ...html(), headers: { "content-length": String(MAX_INPUT_LENGTH + 1) } },
    });
    const failure = await expectFailureInstanceOf(byUrl(layer, START), LookupFailed);
    expect(failure).toMatchObject({ description: expect.stringContaining("larger than") });
  });

  it("stops reading a body that streams past the cap", async () => {
    const { layer } = stubRouter({ [START]: html("x".repeat(MAX_INPUT_LENGTH + 1)) });
    const failure = await expectFailureInstanceOf(byUrl(layer, START), LookupFailed);
    expect(failure).toMatchObject({ description: expect.stringContaining("larger than") });
  });

  describe("with a resolver", () => {
    const resolving =
      (answers: Readonly<Record<string, readonly string[]>>) =>
      (hostname: string): Effect.Effect<readonly string[], string> =>
        hostname in answers ? Effect.succeed(answers[hostname] ?? []) : Effect.fail("NXDOMAIN");

    it("fetches a host that resolves only to public addresses", async () => {
      const { layer, urls } = stubRouter({ [START]: html() });
      const resolveAddresses = resolving({ "example.org": ["93.184.215.14", "2606:2800::1"] });
      await runTest(byUrl(layer, START, { resolveAddresses }));
      expect(urls).toEqual([START]);
    });

    it.each([
      ["a private address", ["93.184.215.14", "10.0.0.5"]],
      ["IPv6 loopback", ["::1"]],
      ["no address", []],
      ["an unrecognised address", ["not-an-ip"]],
    ])("refuses a host that resolves to %s", async (_, addresses) => {
      const { layer, urls } = stubRouter({ [START]: html() });
      const resolveAddresses = resolving({ "example.org": addresses });
      await expectFailureInstanceOf(byUrl(layer, START, { resolveAddresses }), RefusedUrl);
      expect(urls).toEqual([]);
    });

    it("refuses a host that fails to resolve", async () => {
      const { layer } = stubRouter({ [START]: html() });
      await expectFailureInstanceOf(
        byUrl(layer, START, { resolveAddresses: resolving({}) }),
        RefusedUrl,
      );
    });

    it("re-checks a redirect hop's resolved addresses", async () => {
      const next = "https://rebind.example.net/x";
      const { layer, urls } = stubRouter({ [START]: redirect(next), [next]: html() });
      const resolveAddresses = resolving({
        "example.org": ["93.184.215.14"],
        "rebind.example.net": ["169.254.169.254"],
      });
      await expectFailureInstanceOf(byUrl(layer, START, { resolveAddresses }), LookupFailed);
      expect(urls).toEqual([START]);
    });
  });

  describe("time limit", () => {
    /** A layer whose fetch answers `respond`, honouring the abort signal. */
    const hanging = (respond: () => Promise<Response>): Layer.Layer<HttpClient.HttpClient> =>
      FetchHttpClient.layer.pipe(
        Layer.provide(
          Layer.succeed(FetchHttpClient.Fetch, (_input, init) =>
            Promise.race([
              respond(),
              new Promise<Response>((_, reject) =>
                init?.signal?.addEventListener("abort", () => reject(init.signal?.reason)),
              ),
            ]),
          ),
        ),
      );

    const timesOut = (layer: Layer.Layer<HttpClient.HttpClient>) =>
      Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(Effect.flip(byUrl(layer, START)));
        yield* TestClock.adjust("11 seconds");
        return yield* Fiber.join(fiber);
      }).pipe(Effect.provide(TestClock.layer()));

    it("fails when the response never arrives", async () => {
      const failure = await runTest(timesOut(hanging(() => new Promise<Response>(() => {}))));
      expect(failure).toBeInstanceOf(LookupFailed);
      expect(failure).toMatchObject({ description: "timed out" });
    });

    it("fails when the body never finishes", async () => {
      const endless = (): Promise<Response> =>
        Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              start: (controller) => controller.enqueue(new TextEncoder().encode("<html>")),
            }),
            { status: 200, headers: { "content-type": "text/html" } },
          ),
        );
      const failure = await runTest(timesOut(hanging(endless)));
      expect(failure).toBeInstanceOf(LookupFailed);
      expect(failure).toMatchObject({ description: "timed out" });
    });
  });
});

describe("BiblioLookup.byUrl over a raw response", () => {
  /** A layer whose fetch answers every request with `respond()`. */
  const answering = (respond: () => Response): Layer.Layer<HttpClient.HttpClient> =>
    FetchHttpClient.layer.pipe(
      Layer.provide(Layer.succeed(FetchHttpClient.Fetch, () => Promise.resolve(respond()))),
    );

  it("refuses a response with no content type", async () => {
    const layer = answering(() => new Response(null, { status: 200 }));
    const failure = await expectFailureInstanceOf(byUrl(layer, START), LookupFailed);
    expect(failure).toMatchObject({ description: expect.stringContaining("no content type") });
  });

  it("fails when the body stream errors part-way", async () => {
    const layer = answering(
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            pull: (controller) => controller.error(new TypeError("connection reset")),
          }),
          { status: 200, headers: { "content-type": "text/html" } },
        ),
    );
    const failure = await expectFailureInstanceOf(byUrl(layer, START), LookupFailed);
    expect(failure).toMatchObject({ description: "failed to read the response" });
  });
});

describe("addressRefusal", () => {
  it.each(["8.8.8.8", "93.184.215.14", "2606:4700:4700::1111", "2a00:1450::1"])(
    "accepts the public address %s",
    (address) => {
      expect(Option.isNone(addressRefusal(address))).toBe(true);
    },
  );

  it.each([
    "127.0.0.1",
    "192.0.2.1",
    "198.18.0.1",
    "fec0::1",
    "ff02::1",
    "2001:db8::1",
    "2001::1",
    "100::1",
    "::ffff:a9fe:a9fe",
    "64:ff9b:1::1",
    "1.2.3",
    "256.1.1.1",
    "1::2::3",
    "1:2:3:4:5:6:7:8:9",
  ])("refuses %s", (address) => {
    expect(Option.isSome(addressRefusal(address))).toBe(true);
  });
});
