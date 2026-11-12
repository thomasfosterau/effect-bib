/**
 * The optional bibliographic slots the scholarly sources fill alike: the
 * container title, volume, issue, page range, authors and issue date, each
 * present only when the upstream record had it.
 *
 * @module effect-bib/sources/slots
 * @since 0.2.0
 */

import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import type * as Types from "effect/Types";
import type { BiblioRecord, CslDate, CslName } from "../record.ts";

/** What an upstream work offers for {@link optionalSlots}, each member possibly absent. */
interface UpstreamSlots {
  readonly containerTitle: Option.Option<string>;
  readonly volume: Option.Option<string>;
  readonly issue: Option.Option<string>;
  readonly page: Option.Option<string>;
  readonly author: ReadonlyArray<CslName>;
  readonly issued: Option.Option<CslDate>;
}

/**
 * Copies each present slot into the record's optional members, leaving an
 * absent one (or an empty author list) out rather than `undefined`.
 *
 * @since 0.2.0
 */
export function optionalSlots(slots: UpstreamSlots): Partial<BiblioRecord> {
  const optional: Types.Mutable<Partial<BiblioRecord>> = {};
  if (Option.isSome(slots.containerTitle)) optional["container-title"] = slots.containerTitle.value;
  if (Option.isSome(slots.volume)) optional.volume = slots.volume.value;
  if (Option.isSome(slots.issue)) optional.issue = slots.issue.value;
  if (Option.isSome(slots.page)) optional.page = slots.page.value;
  if (Arr.isReadonlyArrayNonEmpty(slots.author)) optional.author = slots.author;
  if (Option.isSome(slots.issued)) optional.issued = slots.issued.value;
  return optional;
}
