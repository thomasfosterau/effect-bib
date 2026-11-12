/**
 * A consumer's view of every entry point through their EMITTED
 * declarations (`paths` in tsconfig.json points the package names at
 * `dist/**\/*.d.ts`). Each block exercises the types a real consumer depends
 * on, so a declaration that degrades — a brand that emits as `string`, a
 * service whose shape emits as `any` — fails here rather than in an
 * application. Never executed; type-checked only.
 */

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type { HttpClient } from "effect/http";
import {
  apaStyle,
  type Arxiv,
  type BiblioRecord,
  type EmbeddedMetadata,
  bestConfidentMatch,
  type CslItemType,
  type CslName,
  type CslDate,
  type Doi,
  decodeArxiv,
  decodeDoi,
  decodeIsbn,
  decodePmcid,
  decodePmid,
  fromCslJson,
  type Isbn,
  isbnForms,
  type MatchInput,
  parseBibliographicFile,
  parseCslMarkup,
  type ParseMode,
  type ParseOptions,
  type ParseOutcome,
  type Pmcid,
  type Pmid,
  recordMatchInput,
  type RecordLimits,
  renderBibliography,
  renderReference,
  type RichText,
  scoreMatch,
  type SkipReason,
  type SourcePosition,
  toCslJson,
  vancouverStyle,
} from "@thomasfosterau/effect-bib";
import {
  BiblioLookup,
  biblioLookupClientLayer,
  biblioLookupLayer,
  type BiblioLookupOptions,
  InvalidIdentifier,
  type LookupContact,
  type LookupError,
  LookupFailed,
  lookupCrossrefByDoi,
  RefusedUrl,
  type ResolveAddresses,
} from "@thomasfosterau/effect-bib/sources";
import {
  type BiblioRecord as RecordEntryBiblioRecord,
  type Doi as RecordEntryDoi,
  fromCslJson as recordEntryFromCslJson,
  type Isbn as RecordEntryIsbn,
} from "@thomasfosterau/effect-bib/record";

/** A compile-time assertion: `T` must be exactly `true`. */
type Assert<T extends true> = T;
type Equals<A, B> =
  (<X>() => X extends A ? 1 : 2) extends <X>() => X extends B ? 1 : 2 ? true : false;
type Not<T extends boolean> = T extends true ? false : true;

/**
 * `true` when `K` is an optional key of `T` whose present value is exactly
 * `V`: the wire shape's optional slot, asserted without spelling `V | undefined`.
 */
type OptionalSlot<T, K extends keyof T, V> =
  Equals<Exclude<T[K], undefined>, V> extends true
    ? Partial<Pick<T, K>> extends Pick<T, K>
      ? true
      : false
    : false;

declare const raw: string;
declare const client: HttpClient.HttpClient;

// ── identifiers ───────────────────────────────────────────────────────────

export const isbn: Option.Option<Isbn> = decodeIsbn(raw);
export const doi: Option.Option<Doi> = decodeDoi(raw);
export const pmid: Option.Option<Pmid> = decodePmid(raw);
export const pmcid: Option.Option<Pmcid> = decodePmcid(raw);
export const arxiv: Option.Option<Arxiv> = decodeArxiv(raw);
export const forms = Option.map(isbn, isbnForms);

// ── record ────────────────────────────────────────────────────────────────

export const record: BiblioRecord = fromCslJson({ type: "book", title: "Sapiens" });
export const limited: BiblioRecord = fromCslJson({ type: "book" }, { maxAuthors: 500 });
export const csl = toCslJson(record);
// `./record` re-exports the root's record model, so a record from either
// entry is the other's: one schema, one set of brands.
export const fromRecordEntry: BiblioRecord = recordEntryFromCslJson({ type: "book" });
export const markup: RichText = parseCslMarkup("<i>Sapiens</i>");

// ── parse ─────────────────────────────────────────────────────────────────

export const outcomes: ParseOutcome[] = parseBibliographicFile("", "bibtex");
export const lenient: ParseOutcome[] = parseBibliographicFile("", "bibtex", {
  mode: "lenient",
  maxRecords: 10_000,
  maxInputLength: 16_000_000,
  maxFieldLength: 20_000,
  maxAuthors: 1_000,
});

// ── dedup ─────────────────────────────────────────────────────────────────

export const input: MatchInput = recordMatchInput(record);
export const score = scoreMatch(input, input);
export const best = bestConfidentMatch(input, [{ ...input, id: 1 }]);

// ── render ────────────────────────────────────────────────────────────────

export const reference: string = renderReference(record, { style: apaStyle });
export const bibliography = renderBibliography([record], { style: vancouverStyle });

// ── sources ───────────────────────────────────────────────────────────────

export const program = BiblioLookup.use((lookup) => lookup.byIsbnRecord(raw));
export const contact: LookupContact = { product: "consumer/1.0", email: "ops@example.org" };
export const provided = program.pipe(Effect.provide(biblioLookupLayer({ contact })));
export const clientLayer: Layer.Layer<BiblioLookup, never, HttpClient.HttpClient> =
  biblioLookupClientLayer({ contact });
export const direct = Option.map(doi, (proven) => lookupCrossrefByDoi(client, proven));
export const recovered = provided.pipe(
  Effect.catchTags({
    InvalidIdentifier: (error: InvalidIdentifier) => Effect.succeed(error.value),
    LookupFailed: (error: LookupFailed) => Effect.succeed(error.description),
    RefusedUrl: (error: RefusedUrl) => Effect.succeed(error.reason),
  }),
);

export const page = BiblioLookup.use((lookup) => lookup.byUrl("https://example.org/paper"));

/**
 * Every compile-time assertion, exported so `noUnusedLocals` keeps them and a
 * failing one names itself in the error.
 */
export type Checks = [
  /** _recordEntrySharesTheSchema */ Assert<Equals<RecordEntryBiblioRecord, BiblioRecord>>,
  /** _recordEntrySharesTheBrands */ Assert<Equals<RecordEntryIsbn, Isbn>>,
  /** _recordEntryBrandIsBranded */ Assert<Not<Equals<RecordEntryDoi, string>>>,
  /** _isbnIsBranded */ Assert<Not<Equals<Isbn, string>>>,
  /** _doiIsBranded */ Assert<Not<Equals<Doi, string>>>,
  /** _brandsAreDistinct */ Assert<Not<Equals<Isbn, Doi>>>,
  /** _identifierSlotIsBranded */ Assert<OptionalSlot<BiblioRecord["identifiers"], "isbn", Isbn>>,
  /** _itemTypeIsClosed */ Assert<Equals<Extract<CslItemType, "book">, "book">>,
  /** _pubMedAndArxivAreBranded */ Assert<Not<Equals<Pmid, string>>>,
  /** _pmidIsNotPmcid */ Assert<Not<Equals<Pmid, Pmcid>>>,
  /** _arxivIsBranded */ Assert<Not<Equals<Arxiv, string>>>,
  /** _pmidSlot */ Assert<OptionalSlot<BiblioRecord["identifiers"], "pmid", Pmid>>,
  /** _pmcidSlot */ Assert<OptionalSlot<BiblioRecord["identifiers"], "pmcid", Pmcid>>,
  /** _arxivSlot */ Assert<OptionalSlot<BiblioRecord["identifiers"], "arxiv", Arxiv>>,
  /** _citationKey */ Assert<OptionalSlot<BiblioRecord, "citation-key", string>>,
  /** _itemId */ Assert<OptionalSlot<BiblioRecord, "id", string | number>>,
  /** _standardVariable */ Assert<OptionalSlot<BiblioRecord, "archive_location", string>>,
  /** _nameVariable */ Assert<OptionalSlot<BiblioRecord, "executive-producer", readonly CslName[]>>,
  /** _dateVariable */ Assert<OptionalSlot<BiblioRecord, "available-date", CslDate>>,
  /** _categories */ Assert<OptionalSlot<BiblioRecord, "categories", readonly string[]>>,
  /** _outcomeIsTagged */ Assert<Equals<ParseOutcome["outcome"], "parsed" | "skipped">>,
  /** _outcomePosition */ Assert<OptionalSlot<ParseOutcome, "position", SourcePosition>>,
  /** _skipReasons */ Assert<
    Equals<SkipReason, "no-identifier" | "no-title" | "malformed" | "too-large" | "truncated">
  >,
  /** _parseModes */ Assert<Equals<ParseMode, "import" | "lenient">>,
  /** _parseOptionsAreLimits */ Assert<
    Equals<keyof RecordLimits & keyof ParseOptions, keyof RecordLimits>
  >,
  /** _parseTakesOptions */ Assert<
    OptionalSlot<Parameters<typeof parseBibliographicFile>, 2, ParseOptions>
  >,
  /** _bestKeepsTheCandidateType */ Assert<Equals<Option.Option.Value<typeof best>["id"], number>>,
  /** _bibliographyEntries */ Assert<
    Equals<(typeof bibliography.entries)[number]["label"], Option.Option<string>>
  >,
  /** _programRequiresTheService */ Assert<Equals<Effect.Services<typeof program>, BiblioLookup>>,
  /** _programFailsOnTheTypedChannel */ Assert<Equals<Effect.Error<typeof program>, LookupError>>,
  /** _programSucceedsWithARecord */ Assert<
    Equals<Effect.Success<typeof program>, Option.Option<BiblioRecord>>
  >,
  /** _productionLayerIsSelfContained */ Assert<Equals<Effect.Services<typeof provided>, never>>,
  /** _contactIsRequired */ Assert<
    Equals<Parameters<typeof biblioLookupLayer>, [options: BiblioLookupOptions]>
  >,
  /** _clientContactIsRequired */ Assert<
    Equals<Parameters<typeof biblioLookupClientLayer>, [options: BiblioLookupOptions]>
  >,
  /** _contactShape */ Assert<Equals<BiblioLookupOptions["contact"], LookupContact>>,
  /** _contactFields */ Assert<
    Equals<LookupContact, { readonly product: string; readonly email: string }>
  >,
  /** _errorTags */ Assert<
    Equals<LookupError["_tag"], "InvalidIdentifier" | "LookupFailed" | "RefusedUrl">
  >,
  /** _pageSucceedsWithEmbeddedMetadata */ Assert<
    Equals<Effect.Success<typeof page>, Option.Option<EmbeddedMetadata>>
  >,
  /** _pageFailsOnTheTypedChannel */ Assert<Equals<Effect.Error<typeof page>, LookupError>>,
  /** _resolverIsOptional */ Assert<
    OptionalSlot<BiblioLookupOptions, "resolveAddresses", ResolveAddresses>
  >,
  /** _resolverCannotFail */ Assert<Equals<Effect.Error<ReturnType<ResolveAddresses>>, never>>,
  /** _recoveredNeverFails */ Assert<Equals<Effect.Error<typeof recovered>, never>>,
];
