/**
 * Tiny helper to build parameterised WHERE clauses. Values are always bound as
 * $n parameters, never interpolated. Usage:
 *   const w = new Where();
 *   w.add("t.status = $?::trip_status", status);
 *   pool.query(`SELECT ... ${w.sql()}`, w.params);
 */
export class Where {
  params = [];
  #parts = [];

  /** Adds a condition; every "$?" placeholder is replaced by the next $n. */
  add(condition, ...values) {
    let i = 0;
    const text = condition.replace(/\$\?/g, () => {
      this.params.push(values[i++]);
      return `$${this.params.length}`;
    });
    if (i !== values.length) throw new Error(`Where.add: ${values.length} values for ${i} placeholders`);
    this.#parts.push(text);
    return this;
  }

  /** Adds the condition only when value is not undefined/null. */
  addIf(value, condition) {
    return value === undefined || value === null ? this : this.add(condition, value);
  }

  /** Binds an extra parameter (e.g. LIMIT) and returns its placeholder. */
  bind(value) {
    this.params.push(value);
    return `$${this.params.length}`;
  }

  sql() {
    return this.#parts.length ? `WHERE ${this.#parts.join(" AND ")}` : "";
  }
}

/** Escapes LIKE wildcards in user input (used with ESCAPE '\'). */
export const escapeLike = (s) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

/** Standard list envelope: { items, page, pageSize, total, totalPages } */
export function paginate(items, total, page, pageSize) {
  return { items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

export const offsetOf = (page, pageSize) => (page - 1) * pageSize;

/** Whitelisted ORDER BY - never interpolate user input directly. */
export function orderBy(map, key, order, tieBreaker) {
  const col = map[key];
  if (!col) throw new Error(`orderBy: unknown sort key ${key}`);
  const dir = order === "asc" ? "ASC" : "DESC";
  return `ORDER BY ${col} ${dir}, ${tieBreaker} ${dir}`;
}
