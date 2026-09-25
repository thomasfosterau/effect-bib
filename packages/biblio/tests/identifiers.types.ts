/**
 * Type-level tests for the identifier brands (`Isbn` / `Doi` / `Issn` /
 * `Orcid`): a proven identifier is a distinct type from the raw string it
 * came from and from every other brand, at every site that consumes one.
 *
 * This file is type-checked by the package's `check` task (`tsconfig.json`
 * includes `tests/`); the expect-error directives are the assertions. Every
 * binding is exported so an unused-local error can never stand in for the
 * assertion a directive expects. Never executed.
 *
 * @module biblio/tests/identifiers.types
 */

import * as Option from "effect/Option";
import {
  type BiblioRecord,
  type CslName,
  decodeDoi,
  decodeIsbn,
  decodeIssn,
  decodeOrcid,
  Doi,
  Isbn,
  isbnForms,
  Issn,
  Orcid,
  type RecordIdentifiers,
} from "@thomasfosterau/biblio";

/** A compile-time assertion: `T` must be exactly `true`. */
type Assert<T extends true> = T;
type Equals<A, B> =
  (<X>() => X extends A ? 1 : 2) extends <X>() => X extends B ? 1 : 2 ? true : false;
type Not<T extends boolean> = T extends true ? false : true;

declare const raw: string;
declare const isbn: Isbn;
declare const doi: Doi;
declare const issn: Issn;
declare const orcid: Orcid;

// ---------------------------------------------------------------------------
// A raw string is never a proven identifier; a proven identifier is a string
// ---------------------------------------------------------------------------

// @ts-expect-error -- a raw string has not been checksummed
export const rawIsbn: Isbn = raw;
// @ts-expect-error -- a raw string has not been checksummed
export const rawDoi: Doi = raw;
// @ts-expect-error -- a raw string has not been checksummed
export const rawIssn: Issn = raw;
// @ts-expect-error -- a raw string has not been checksummed
export const rawOrcid: Orcid = raw;

// The brand widens to `string` wherever a string is wanted (a URL path, a
// column value) — the guarantee is one-way.
export const isbnAsString: string = isbn;
export const doiAsString: string = doi;
export const issnAsString: string = issn;
export const orcidAsString: string = orcid;

// ---------------------------------------------------------------------------
// The four brands are distinct from each other
// ---------------------------------------------------------------------------

// @ts-expect-error -- an ISBN is not a DOI
export const isbnAsDoi: Doi = isbn;
// @ts-expect-error -- a DOI is not an ISSN
export const doiAsIssn: Issn = doi;
// @ts-expect-error -- an ISSN is not an ORCID
export const issnAsOrcid: Orcid = issn;
// @ts-expect-error -- an ORCID is not an ISBN
export const orcidAsIsbn: Isbn = orcid;

// ---------------------------------------------------------------------------
// The decoders are the only way in, and each yields its own brand
// ---------------------------------------------------------------------------

export const decodedIsbn: Option.Option<Isbn> = decodeIsbn(raw);
export const decodedDoi: Option.Option<Doi> = decodeDoi(raw);
export const decodedIssn: Option.Option<Issn> = decodeIssn(raw);
export const decodedOrcid: Option.Option<Orcid> = decodeOrcid(raw);
// @ts-expect-error -- the ISBN decoder never yields a DOI
export const decoderCrossed: Option.Option<Doi> = decodeIsbn(raw);

// `Schema.brand` keeps the wire type at `string`: the brand is a proof, not
// a representation.
export type Checks = [
  Assert<Equals<typeof Isbn.Type, Isbn>>,
  Assert<Equals<typeof Isbn.Encoded, string>>,
  Assert<Equals<typeof Doi.Encoded, string>>,
  Assert<Equals<typeof Issn.Encoded, string>>,
  Assert<Equals<typeof Orcid.Encoded, string>>,
  Assert<Not<Equals<Isbn, string>>>,
  Assert<Not<Equals<Isbn, Doi>>>,
  /* oxlint-disable effect/prefer-option-over-null -- asserts the record's own optional-key wire shape */
  Assert<Equals<RecordIdentifiers["isbn"], Isbn | undefined>>,
  Assert<Equals<RecordIdentifiers["doi"], Doi | undefined>>,
  Assert<Equals<RecordIdentifiers["issn"], Issn | undefined>>,
  Assert<Equals<CslName["orcid"], Orcid | undefined>>,
  /* oxlint-enable effect/prefer-option-over-null */
];

// ---------------------------------------------------------------------------
// Consumers of a brand reject the raw string
// ---------------------------------------------------------------------------

export const forms = isbnForms(isbn);
// @ts-expect-error -- `isbnForms` takes only a proven ISBN
export const formsOfRaw = isbnForms(raw);
// @ts-expect-error -- a literal that looks like an ISBN is still unproven
export const formsOfLiteral = isbnForms("9780062316097");

export const record: BiblioRecord = {
  type: "book",
  identifiers: { isbn, doi, issn },
  provenance: { source: "manual" },
  author: [{ family: "Harari", orcid }],
};
export const badRecord: BiblioRecord = {
  type: "book",
  // @ts-expect-error -- the record's identifier slots are branded
  identifiers: { isbn: raw },
  provenance: { source: "manual" },
};
export const badName: CslName = {
  family: "Harari",
  // @ts-expect-error -- a contributor's ORCID slot is branded
  orcid: raw,
};
