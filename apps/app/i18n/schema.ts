export type Widened<T> = T extends readonly (infer U)[]
  ? readonly Widened<U>[]
  : T extends object
    ? { readonly [K in keyof T]: Widened<T[K]> }
    : T extends string
      ? string
      : T;

export function defineTranslations<const T extends Record<string, unknown>>(
  translations: T,
) {
  return translations;
}
