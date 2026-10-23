/**
 * Citation metadata embedded in a web page, read into records: the
 * Highwire Press `<meta name="citation_…">` tags publishers write (what
 * Google Scholar indexes), Dublin Core `<meta name="DC.…">` tags, schema.org
 * JSON-LD (`<script type="application/ld+json">`) and COinS spans
 * (`<span class="Z3988" title="…">`, OpenURL ContextObjects). Pure and
 * total: the page is untrusted text, read with bounded scans, never
 * executed, and every value passes through {@link fromCslJson}'s sanitising
 * and identifier validation.
 *
 * @copyright Thomas Foster
 * @module biblio/embedded
 * @since 1.0.0
 */

import * as Array from "effect/Array";
import * as HashMap from "effect/HashMap";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Record from "effect/Record";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as String from "effect/String";
import { limitOr } from "./limits.ts";
import { MAX_INPUT_LENGTH, MAX_RECORDS } from "./parse.ts";
import {
  type BiblioRecord,
  type CslItemType,
  fromCslJson,
  type RecordLimits,
  sanitiseText,
} from "./record.ts";

/**
 * What a page's embedded metadata yields: the record for the page itself,
 * from its Highwire tags, else its schema.org JSON-LD, else its Dublin Core
 * tags (the first that has a title, its gaps filled from the others), and
 * one record per COinS span (a list page cites many works).
 *
 * @since 1.0.0
 */
export interface EmbeddedMetadata {
  readonly page: Option.Option<BiblioRecord>;
  readonly coins: readonly BiblioRecord[];
}

/**
 * How {@link readEmbeddedMetadata} reads a page: the page's URL (the
 * page record's `URL` when its metadata names none, and its provenance
 * endpoint), the most COinS records kept (default `MAX_RECORDS`), and the
 * longest page read (default `MAX_INPUT_LENGTH`; a longer page yields
 * nothing), with the per-record {@link RecordLimits}.
 *
 * @since 1.0.0
 */
export interface EmbeddedOptions extends RecordLimits {
  readonly url?: string;
  readonly maxRecords?: number;
  readonly maxInputLength?: number;
}

/** A CSL-JSON item assembled from the page's untrusted strings. */
type Item = Schema.JsonObject;

/** An item's members before assembly: each present or absent. */
type Fields = Readonly<Record<string, Option.Option<Schema.Json>>>;

/** True for a JSON array. */
const isList = (value: Schema.Json): value is Schema.JsonArray => globalThis.Array.isArray(value);

/** True for a JSON object. */
const isNode = (value: Schema.Json): value is Schema.JsonObject =>
  Predicate.isObject(value) && !isList(value);

/** True for an empty string or list, which an item leaves out. */
const isBlank = (value: Schema.Json): boolean =>
  Predicate.isString(value)
    ? String.isEmpty(value.trim())
    : isList(value) && Array.isReadonlyArrayEmpty(value);

/** A member of an item or node (an own property only, so an inherited key never reads as one). */
const get = (node: Schema.JsonObject, key: string): Option.Option<Schema.Json> =>
  Record.get<string, Schema.Json>(node, key);

/** True when an item or node has `key` as an own member. */
const hasKey = (node: Schema.JsonObject, key: string): boolean =>
  Record.has<string, Schema.Json>(node, key);

/** An item from its members, the absent and empty ones dropped. */
const item = (fields: Fields): Item =>
  Record.filter(Record.getSomes(fields), (value) => !isBlank(value));

// ── HTML scanning ─────────────────────────────────────────────────────

/** The named character references a page's attribute values use. */
const ENTITIES = HashMap.fromIterable<string, string>([
  ["amp", "&"],
  ["lt", "<"],
  ["gt", ">"],
  ["quot", '"'],
  ["apos", "'"],
  ["nbsp", " "],
]);

/** Decodes HTML character references; an unknown or invalid one stays as written. */
function decodeEntities(text: string): string {
  return text.replace(/&(#[xX][0-9A-Fa-f]{1,6}|#\d{1,7}|[A-Za-z]+);/g, (whole, body: string) => {
    if (!body.startsWith("#"))
      return Option.getOrElse(HashMap.get(ENTITIES, body.toLowerCase()), () => whole);
    const code =
      body[1] === "x" || body[1] === "X"
        ? Number.parseInt(body.slice(2), 16)
        : Number(body.slice(1));
    return code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff)
      ? globalThis.String.fromCodePoint(code)
      : whole;
  });
}

/** A tag's attributes, names lower-cased, values entity-decoded; the first of a repeated name wins. */
function attributes(source: string): HashMap.HashMap<string, string> {
  return Array.reduce(
    Array.fromIterable(source.matchAll(/([^\s=/>"']+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+))/g)),
    HashMap.empty<string, string>(),
    (found, match) => {
      const name = match[1].toLowerCase();
      return HashMap.has(found, name)
        ? found
        : HashMap.set(found, name, decodeEntities(match[2] ?? match[3] ?? match[4] ?? ""));
    },
  );
}

/** Every opening tag named `element` (case-insensitive), as its attributes. */
const tags = (html: string, element: string): HashMap.HashMap<string, string>[] =>
  Array.map(
    Array.fromIterable(html.matchAll(new RegExp(`<${element}\\b([^>]*)>`, "gi"))),
    (match) => attributes(match[1]),
  );

/** One `<meta>` tag's name (or `property`) and content. */
interface Meta {
  readonly name: string;
  readonly content: string;
}

/** The page's `<meta name|property=… content=…>` tags, names lower-cased, in order. */
const metas = (html: string): Meta[] =>
  Array.filterMap(tags(html, "meta"), (attrs): Result.Result<Meta, void> => {
    const name = Option.orElse(HashMap.get(attrs, "name"), () => HashMap.get(attrs, "property"));
    const content = HashMap.get(attrs, "content");
    return Option.isSome(name) && Option.isSome(content)
      ? Result.succeed({ name: name.value.trim().toLowerCase(), content: content.value })
      : Result.failVoid;
  });

/** Every meta value under any of `names`, in page order. */
const all = (found: readonly Meta[], names: readonly string[]): string[] =>
  found.filter((meta) => names.includes(meta.name)).map((meta) => meta.content);

/** The first meta value under any of `names`. */
const first = (found: readonly Meta[], names: readonly string[]): Option.Option<string> =>
  Option.map(
    Array.findFirst(found, (meta) => names.includes(meta.name)),
    (meta) => meta.content,
  );

/** True when the page has a meta tag under any of `names`. */
const has = (found: readonly Meta[], names: readonly string[]): boolean =>
  Option.isSome(first(found, names));

// ── Shared value readers ──────────────────────────────────────────────

/** A date in its common web forms (`2004/03/14`, `2004-03-14`, `2004-03`, `2004`) as CSL `date-parts`, else as raw text. */
function dateParts(value: string): Option.Option<Item> {
  const match = /(\d{4})(?:[-/.](\d{1,2})(?:[-/.](\d{1,2}))?)?/.exec(value);
  if (match === null) return Option.map(sanitiseText(value), (raw) => ({ raw }));
  const parts = [Number(match[1])];
  if (match[2] !== undefined && Number(match[2]) >= 1 && Number(match[2]) <= 12) {
    parts.push(Number(match[2]));
    if (match[3] !== undefined && Number(match[3]) >= 1 && Number(match[3]) <= 31)
      parts.push(Number(match[3]));
  }
  return Option.some({ "date-parts": [parts] });
}

/** A personal name in either order (`Family, Given` or `Given Family`) as a CSL name object. */
function nameItem(value: string): Item {
  const clean = value.replace(/\s+/g, " ").trim();
  const comma = clean.indexOf(",");
  if (comma >= 0) return { family: clean.slice(0, comma), given: clean.slice(comma + 1).trim() };
  const space = clean.lastIndexOf(" ");
  return space < 0
    ? { literal: clean }
    : { family: clean.slice(space + 1), given: clean.slice(0, space) };
}

/** A page range from its first and last page. */
const pageRange = (
  firstPage: Option.Option<string>,
  lastPage: Option.Option<string>,
): Option.Option<string> =>
  Option.match(firstPage, {
    onNone: () => lastPage,
    onSome: (start) =>
      Option.some(
        Option.match(lastPage, { onNone: () => start, onSome: (end) => `${start}-${end}` }),
      ),
  });

/** A DOI in a value that may be a `doi:` / `https://doi.org/` reference. */
const doiIn = (value: string): Option.Option<string> =>
  Option.fromUndefinedOr(/\b(10\.\d{4,9}\/\S+)/.exec(value)?.[1]);

// ── Highwire Press and Dublin Core tags ───────────────────────────────

/** A Highwire `citation_*` page's item type, from which container tags it has. */
function highwireType(found: readonly Meta[]): CslItemType {
  if (has(found, ["citation_conference_title", "citation_conference"])) return "paper-conference";
  if (has(found, ["citation_dissertation_institution"])) return "thesis";
  if (has(found, ["citation_technical_report_institution", "citation_technical_report_number"]))
    return "report";
  if (has(found, ["citation_inbook_title", "citation_book_title"])) return "chapter";
  if (has(found, ["citation_journal_title"])) return "article-journal";
  if (has(found, ["citation_isbn"])) return "book";
  return "article-journal";
}

/** The Highwire Press `citation_*` tags as a CSL item; `None` when the page has none. */
function highwire(found: readonly Meta[]): Option.Option<Item> {
  if (!found.some((meta) => meta.name.startsWith("citation_"))) return Option.none();
  const one = (...names: string[]): Option.Option<string> => first(found, names);
  return Option.some(
    item({
      type: Option.some(highwireType(found)),
      title: one("citation_title"),
      author: Option.some(all(found, ["citation_author"]).map(nameItem)),
      editor: Option.some(all(found, ["citation_editor"]).map(nameItem)),
      issued: Option.flatMap(
        one(
          "citation_publication_date",
          "citation_date",
          "citation_cover_date",
          "citation_online_date",
          "citation_year",
        ),
        dateParts,
      ),
      "container-title": one(
        "citation_journal_title",
        "citation_conference_title",
        "citation_inbook_title",
        "citation_book_title",
      ),
      "container-title-short": one("citation_journal_abbrev"),
      volume: one("citation_volume"),
      issue: one("citation_issue"),
      page: pageRange(one("citation_firstpage"), one("citation_lastpage")),
      publisher: one(
        "citation_publisher",
        "citation_dissertation_institution",
        "citation_technical_report_institution",
      ),
      number: one("citation_technical_report_number"),
      language: one("citation_language"),
      keyword: Option.some(all(found, ["citation_keywords"]).join(", ")),
      abstract: one("citation_abstract"),
      URL: one("citation_abstract_html_url", "citation_fulltext_html_url", "citation_public_url"),
      DOI: one("citation_doi"),
      ISBN: one("citation_isbn"),
      ISSN: one("citation_issn", "citation_eissn"),
      PMID: one("citation_pmid"),
      number_arxiv: one("citation_arxiv_id"),
    }),
  );
}

/** The Dublin Core `DC.*` / `DCTERMS.*` tags as a CSL item; `None` when the page has no title among them. */
function dublinCore(found: readonly Meta[]): Option.Option<Item> {
  const dc = (term: string): string[] =>
    all(found, [`dc.${term}`, `dcterms.${term}`, `dc:${term}`]);
  const dcFirst = (...terms: string[]): Option.Option<string> =>
    Array.findFirst(terms, (term) => Array.head(dc(term)));
  const identifiers = [...dc("identifier"), ...dc("source")];
  return Option.map(dcFirst("title"), (title) =>
    item({
      type: Option.some("document"),
      title: Option.some(title),
      author: Option.some(dc("creator").map(nameItem)),
      contributor: Option.some(dc("contributor").map(nameItem)),
      issued: Option.flatMap(dcFirst("date", "issued"), dateParts),
      publisher: dcFirst("publisher"),
      language: dcFirst("language"),
      abstract: dcFirst("description", "abstract"),
      DOI: Array.findFirst(identifiers, doiIn),
      ISBN: Option.map(
        Array.findFirst(identifiers, (value) => /isbn/i.test(value)),
        (value) => value.replace(/^.*isbn:?\s*/i, ""),
      ),
    }),
  );
}

// ── schema.org JSON-LD ────────────────────────────────────────────────

/** schema.org types → CSL item types. */
const SCHEMA_TYPES = HashMap.fromIterable<string, CslItemType>([
  ["scholarlyarticle", "article-journal"],
  ["article", "article-journal"],
  ["medicalscholarlyarticle", "article-journal"],
  ["techarticle", "article"],
  ["newsarticle", "article-newspaper"],
  ["reportagenewsarticle", "article-newspaper"],
  ["blogposting", "post-weblog"],
  ["socialmediaposting", "post"],
  ["book", "book"],
  ["chapter", "chapter"],
  ["thesis", "thesis"],
  ["report", "report"],
  ["dataset", "dataset"],
  ["softwaresourcecode", "software"],
  ["softwareapplication", "software"],
  ["movie", "motion_picture"],
  ["musicrecording", "song"],
  ["map", "map"],
  ["legislation", "legislation"],
  ["webpage", "webpage"],
  ["creativework", "document"],
]);

/** A JSON-LD node. */
type Node = Schema.JsonObject;

const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Json));

/** A member as a list (a single value is a list of one, an absent one an empty list). */
const listOf = (value: Option.Option<Schema.Json>): readonly Schema.Json[] =>
  Option.match(value, { onNone: () => [], onSome: (json) => (isList(json) ? json : [json]) });

/** A node's member, as a list. */
const members = (node: Node, key: string): readonly Schema.Json[] => listOf(get(node, key));

/** A value's text: a string or number, a node's `name`, or the first such in a list. */
function textOf(value: Schema.Json, depth = 0): Option.Option<string> {
  if (depth > 4) return Option.none();
  if (Predicate.isString(value)) return Option.some(value);
  if (Predicate.isNumber(value)) return Option.some(globalThis.String(value));
  if (isList(value)) return Array.findFirst(value, (entry) => textOf(entry, depth + 1));
  return isNode(value) ? text(value, "name", depth + 1) : Option.none();
}

/** A node member's text. */
function text(node: Node, key: string, depth = 0): Option.Option<string> {
  return Option.flatMap(get(node, key), (value) => textOf(value, depth));
}

/** A node's `@type`s, lower-cased. */
const typesOf = (node: Node): string[] =>
  members(node, "@type").flatMap((type) => (Predicate.isString(type) ? [type.toLowerCase()] : []));

/** Every node of a JSON-LD document: top-level objects, list members and `@graph` members, a few levels deep. */
function nodesOf(value: Schema.Json, depth = 0): Node[] {
  if (depth > 3) return [];
  return listOf(Option.some(value)).flatMap((entry) =>
    isNode(entry)
      ? [entry, ...members(entry, "@graph").flatMap((graph) => nodesOf(graph, depth + 1))]
      : [],
  );
}

/** A schema.org person or organisation as a CSL name object (with an ORCID from its `@id` / `sameAs`). */
function personItem(value: Schema.Json): Option.Option<Item> {
  if (Predicate.isString(value)) return Option.some(nameItem(value));
  if (!isNode(value)) return Option.none();
  const orcid = Array.findFirst([...members(value, "@id"), ...members(value, "sameAs")], (link) =>
    Predicate.isString(link) && /orcid\.org\//i.test(link)
      ? Option.some(link.replace(/^.*orcid\.org\//i, ""))
      : Option.none(),
  );
  const base = Option.match(text(value, "familyName"), {
    onSome: (family) => item({ family: Option.some(family), given: text(value, "givenName") }),
    onNone: () =>
      typesOf(value).includes("organization")
        ? item({ literal: text(value, "name") })
        : nameItem(Option.getOrElse(text(value, "name"), () => "")),
  });
  return Option.some({ ...base, ...item({ orcid }) });
}

/** The container a work is part of (a periodical, through its volume and issue), with the volume and issue numbers. */
function partOf(node: Node, depth = 0): Item {
  if (depth > 4) return {};
  return Option.match(Array.findFirst(members(node, "isPartOf"), isNode), {
    onNone: () => ({}),
    onSome: (parent) => {
      const types = typesOf(parent);
      const own = types.includes("publicationissue")
        ? item({ issue: text(parent, "issueNumber") })
        : types.includes("publicationvolume")
          ? item({ volume: text(parent, "volumeNumber") })
          : item({ "container-title": text(parent, "name"), ISSN: text(parent, "issn") });
      return { ...partOf(parent, depth + 1), ...own };
    },
  });
}

/** A node's identifiers' text: plain values and `PropertyValue` nodes' `value`. */
const identifiersOf = (node: Node): string[] =>
  members(node, "identifier").flatMap((value) =>
    Option.toArray(
      Option.orElse(textOf(value), () => (isNode(value) ? text(value, "value") : Option.none())),
    ),
  );

/** A schema.org creative work as a CSL item; `None` for a node of another kind or without a name. */
function schemaItem(node: Node): Option.Option<Item> {
  const type = Array.findFirst(typesOf(node), (candidate) => HashMap.get(SCHEMA_TYPES, candidate));
  const title = Option.orElse(text(node, "headline"), () => text(node, "name"));
  const people = (key: string): Option.Option<Schema.Json> =>
    Option.some(members(node, key).flatMap((person) => Option.toArray(personItem(person))));
  return Option.map(Option.all({ type, title }), (found) => ({
    ...item({
      type: Option.some(found.type),
      title: Option.some(found.title),
      author: people("author"),
      editor: people("editor"),
      issued: Option.flatMap(
        Option.orElse(text(node, "datePublished"), () => text(node, "dateCreated")),
        dateParts,
      ),
      publisher: text(node, "publisher"),
      volume: text(node, "volumeNumber"),
      issue: text(node, "issueNumber"),
      page: Option.orElse(text(node, "pagination"), () =>
        pageRange(text(node, "pageStart"), text(node, "pageEnd")),
      ),
      language: text(node, "inLanguage"),
      abstract: text(node, "description"),
      keyword: Option.some(
        members(node, "keywords")
          .flatMap((value) => Option.toArray(textOf(value)))
          .join(", "),
      ),
      URL: text(node, "url"),
      ISBN: text(node, "isbn"),
    }),
    ...partOf(node),
    ...item({
      DOI: Array.findFirst(
        [
          ...Option.toArray(text(node, "doi")),
          ...identifiersOf(node),
          ...Option.toArray(text(node, "sameAs")),
          ...Option.toArray(text(node, "@id")),
        ],
        doiIn,
      ),
    }),
  }));
}

/** The schema.org works the page's JSON-LD scripts describe. */
function jsonLd(html: string): Item[] {
  return Array.flatMap(
    Array.fromIterable(html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)),
    (match) =>
      Option.exists(HashMap.get(attributes(match[1]), "type"), (type) =>
        /^\s*application\/ld\+json\s*$/i.test(type),
      )
        ? Option.match(decodeJson(match[2].trim()), {
            onNone: () => [],
            onSome: (document) => Array.getSomes(nodesOf(document).map(schemaItem)),
          })
        : [],
  );
}

// ── COinS ─────────────────────────────────────────────────────────────

/** An OpenURL `rft.genre` / format → CSL item type. */
const COINS_GENRES = HashMap.fromIterable<string, CslItemType>([
  ["article", "article-journal"],
  ["journal", "article-journal"],
  ["issue", "periodical"],
  ["book", "book"],
  ["bookitem", "chapter"],
  ["proceeding", "paper-conference"],
  ["conference", "paper-conference"],
  ["report", "report"],
  ["document", "document"],
  ["preprint", "article"],
  ["dissertation", "thesis"],
  ["patent", "patent"],
]);

/** Decodes one `application/x-www-form-urlencoded` component; a malformed one stays as written. */
const formDecode = (value: string): string =>
  Result.getOrElse(
    Result.try(() => decodeURIComponent(value.replace(/\+/g, " "))),
    () => value,
  );

/** The first present value of several. */
const either = (...values: Option.Option<string>[]): Option.Option<string> =>
  Option.firstSomeOf(values);

/** One COinS span's ContextObject as a CSL item; `None` without a title. */
function coinsItem(kev: string): Option.Option<Item> {
  const pairs = kev.split("&").map((pair) => {
    const at = pair.indexOf("=");
    return at < 0
      ? ([formDecode(pair), ""] as const)
      : ([formDecode(pair.slice(0, at)), formDecode(pair.slice(at + 1))] as const);
  });
  const param = (key: string): Option.Option<string> =>
    Option.map(
      Array.findFirst(pairs, ([name]) => name === key),
      ([, value]) => value,
    );
  const getAll = (key: string): string[] =>
    pairs.filter(([name]) => name === key).map(([, value]) => value);
  const genre = either(
    param("rft.genre"),
    Option.map(param("rft_val_fmt"), (format) => format.replace(/^.*:/, "")),
  );
  const type = Option.getOrElse(
    Option.flatMap(genre, (key) => HashMap.get(COINS_GENRES, key.toLowerCase())),
    (): CslItemType => "document",
  );
  const contained = type === "article-journal" || type === "chapter" || type === "paper-conference";
  const title = contained
    ? either(param("rft.atitle"), param("rft.title"))
    : either(param("rft.btitle"), param("rft.title"), param("rft.atitle"));
  const primary = Option.map(param("rft.aulast"), (family) => ({
    family,
    given: either(param("rft.aufirst"), param("rft.auinit")),
  }));
  const primaryName = Option.map(
    primary,
    (name) => `${name.family}, ${Option.getOrElse(name.given, () => "")}`,
  );
  const ids = getAll("rft_id");
  return Option.map(title, (found) =>
    item({
      type: Option.some(type),
      title: Option.some(found),
      author: Option.some(
        [
          ...Option.toArray(
            Option.map(primary, (name) =>
              item({ family: Option.some(name.family), given: name.given }),
            ),
          ),
          ...getAll("rft.au")
            .filter((name) => !Option.contains(primaryName, name))
            .map(nameItem),
        ].slice(0, 1000),
      ),
      issued: Option.flatMap(param("rft.date"), dateParts),
      "container-title": contained
        ? either(param("rft.jtitle"), param("rft.btitle"), param("rft.title"))
        : Option.none(),
      "container-title-short": param("rft.stitle"),
      volume: param("rft.volume"),
      issue: param("rft.issue"),
      page: Option.orElse(param("rft.pages"), () =>
        pageRange(param("rft.spage"), param("rft.epage")),
      ),
      publisher: either(param("rft.pub"), param("rft.inst")),
      "publisher-place": param("rft.place"),
      edition: param("rft.edition"),
      ISBN: param("rft.isbn"),
      ISSN: either(param("rft.issn"), param("rft.eissn")),
      DOI: Array.findFirst(ids, (id) =>
        id.startsWith("info:doi/") ? Option.some(id.slice(9)) : doiIn(id),
      ),
      PMID: Array.findFirst(ids, (id) =>
        id.startsWith("info:pmid/") ? Option.some(id.slice(10)) : Option.none(),
      ),
      URL: Array.findFirst(ids, (id) => /^https?:\/\//i.test(id) && Option.isNone(doiIn(id))),
    }),
  );
}

/** The ContextObjects of the page's COinS spans (`<span class="Z3988" title="…">`). */
const coins = (html: string): Item[] =>
  Array.getSomes(
    tags(html, "span")
      .filter((attrs) =>
        Option.exists(HashMap.get(attrs, "class"), (value) => /(?:^|\s)Z3988(?:\s|$)/.test(value)),
      )
      .map((attrs) => Option.flatMap(HashMap.get(attrs, "title"), coinsItem)),
  );

// ── Assembly ──────────────────────────────────────────────────────────

/** A record from an assembled item, stamped as read from the page. */
function toRecord(found: Item, options: EmbeddedOptions): BiblioRecord {
  const rest = Record.remove<string, Schema.Json, string>(found, "number_arxiv");
  const arxiv = Option.filter(get(found, "number_arxiv"), Predicate.isString);
  const withArxiv =
    Option.isSome(arxiv) && !hasKey(rest, "number")
      ? { ...rest, number: `arXiv:${arxiv.value.replace(/^arxiv:/i, "")}` }
      : rest;
  const record = fromCslJson(withArxiv, options);
  const endpoint = Option.flatMap(Option.fromUndefinedOr(options.url), (url) => sanitiseText(url));
  return {
    ...record,
    provenance: Option.match(endpoint, {
      onNone: () => ({ source: "html" }),
      onSome: (url) => ({
        source: "html",
        retrievedBy: { identifierType: "url", identifier: url },
      }),
    }),
  };
}

/**
 * Reads the citation metadata embedded in a web page: the page's own
 * record from its Highwire Press `citation_*` tags (what Google Scholar
 * indexes), else its schema.org JSON-LD (`ScholarlyArticle`, `Book`,
 * `Chapter`, … with authors, ORCIDs and the periodical, volume and issue it
 * is part of), else its Dublin Core `DC.*` tags — the first that has a
 * title, with any field it lacks filled from the others, and the page URL
 * (`options.url`) as its `URL` when none is given — and one record per COinS
 * span. Records are stamped `provenance.source: "html"`. Pure and total: a
 * page with no metadata yields `{ page: Option.none(), coins: [] }`, and a
 * page longer than `options.maxInputLength` yields nothing.
 *
 * @example
 * ```ts
 * import * as assert from "node:assert"
 * import * as Option from "effect/Option"
 * import { readEmbeddedMetadata } from "@thomasfosterau/biblio"
 *
 * const html = `<html><head>
 *   <meta name="citation_title" content="Structure of Scientific Revolutions">
 *   <meta name="citation_author" content="Kuhn, Thomas S.">
 *   <meta name="citation_publication_date" content="1962/01/01">
 *   <meta name="citation_journal_title" content="Journal of Science">
 *   <meta name="citation_doi" content="10.1037/0003-066X.59.1.29">
 * </head><body>
 *   <span class="Z3988" title="ctx_ver=Z39.88-2004&amp;rft_val_fmt=info%3Aofi%2Ffmt%3Akev%3Amtx%3Abook&amp;rft.btitle=Sapiens&amp;rft.isbn=9780062316097"></span>
 * </body></html>`
 *
 * const { page, coins } = readEmbeddedMetadata(html, { url: "https://example.org/kuhn" })
 * const record = Option.getOrThrow(page)
 * assert.strictEqual(record.title, "Structure of Scientific Revolutions")
 * assert.deepStrictEqual(record.author, [{ family: "Kuhn", given: "Thomas S." }])
 * assert.strictEqual(record.identifiers.doi, "10.1037/0003-066x.59.1.29")
 * assert.strictEqual(record.URL, "https://example.org/kuhn")
 * assert.strictEqual(coins[0].identifiers.isbn, "9780062316097")
 * ```
 *
 * @since 1.0.0
 */
export function readEmbeddedMetadata(
  html: string,
  options: EmbeddedOptions = {},
): EmbeddedMetadata {
  if (html.length > limitOr(Option.fromUndefinedOr(options.maxInputLength), MAX_INPUT_LENGTH)) {
    return { page: Option.none(), coins: [] };
  }
  const found = metas(html);
  const candidates = [
    ...Option.toArray(highwire(found)),
    ...jsonLd(html),
    ...Option.toArray(dublinCore(found)),
  ];
  const page = Option.map(
    Array.findFirst(candidates, (candidate) => hasKey(candidate, "title")),
    (primary) => {
      const merged = Array.reduce(candidates, primary, (acc, other) => ({ ...other, ...acc }));
      const url = Option.fromUndefinedOr(options.url);
      return toRecord(
        hasKey(merged, "URL") || Option.isNone(url) ? merged : { ...merged, URL: url.value },
        options,
      );
    },
  );
  const maxRecords = limitOr(Option.fromUndefinedOr(options.maxRecords), MAX_RECORDS);
  return {
    page,
    coins: coins(html)
      .slice(0, maxRecords)
      .map((record) => toRecord(record, options)),
  };
}
