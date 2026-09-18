/**
 * A consumer's view of the package through its EMITTED declarations. Never
 * executed; type-checked only.
 */

import { placeholder } from "@thomasfosterau/biblio";
import { sourcesPlaceholder } from "@thomasfosterau/biblio/sources";

/** A compile-time assertion: `T` must be exactly `true`. */
type Assert<T extends true> = T;
type Equals<A, B> =
  (<X>() => X extends A ? 1 : 2) extends <X>() => X extends B ? 1 : 2 ? true : false;

export type Checks = [
  Assert<Equals<typeof placeholder, "biblio">>,
  Assert<Equals<typeof sourcesPlaceholder, "biblio/sources">>,
];
