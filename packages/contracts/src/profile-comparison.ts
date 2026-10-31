// JSONB may reorder object keys, and optional record lists may be absent in a
// new profile. Compare their values consistently across the API and the UI.
const canonical = (value: any): any =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])]),
        )
      : value;

export const canonicalProfileField = (value: unknown) => canonical(value ?? []);
export const sameProfileField = (left: unknown, right: unknown) =>
  JSON.stringify(canonicalProfileField(left)) === JSON.stringify(canonicalProfileField(right));
