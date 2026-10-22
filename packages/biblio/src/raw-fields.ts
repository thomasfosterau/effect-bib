/**
 * The pre-assembly field bag every file parser fills from one source entry,
 * before the shared assembly sanitises it into a record.
 *
 * @copyright Thomas Foster
 * @module biblio/raw-fields
 * @since 0.1.0
 */

import type * as Option from "effect/Option";
import type { CslItemType, CslName } from "./record.ts";

/**
 * The fields a parser pulls out of one source entry. Names are already
 * structured ({@link CslName}); identifier and free-text values are still
 * raw, for the shared assembly to decode and sanitise.
 *
 * @since 0.1.0
 */
export interface RawFields {
  /** The CSL item type, or `Option.none()` to infer it from the identifier. */
  readonly type: Option.Option<CslItemType>;
  readonly title: Option.Option<string>;
  readonly subtitle: Option.Option<string>;
  /** A year as a number or as text that holds one (`2015`, `"2015"`). */
  readonly year: Option.Option<string | number>;
  readonly publisher: Option.Option<string>;
  readonly containerTitle: Option.Option<string>;
  readonly volume: Option.Option<string>;
  readonly issue: Option.Option<string>;
  readonly page: Option.Option<string>;
  readonly isbn: Option.Option<string>;
  readonly issn: Option.Option<string>;
  readonly doi: Option.Option<string>;
  readonly names: readonly CslName[];
  readonly editors: readonly CslName[];
}
