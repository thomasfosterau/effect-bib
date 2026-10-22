/**
 * A per-document work budget. Macro expansion and inheritance let a small
 * document reuse one large value many times, so the work they cause is
 * bounded by a running budget, not only by the input's length.
 *
 * @copyright Thomas Foster
 * @module biblio/bibtex/budget
 * @since 0.1.0
 */

/**
 * A running budget of characters, spent as work is done.
 *
 * @since 0.1.0
 */
export interface Budget {
  remaining: number;
}

/**
 * Spends `amount` from the budget when it covers it; `false` (and nothing
 * spent) when it does not, so the caller skips that piece of work.
 *
 * @since 0.1.0
 */
export function spend(budget: Budget, amount: number): boolean {
  if (amount > budget.remaining) return false;
  budget.remaining -= amount;
  return true;
}
