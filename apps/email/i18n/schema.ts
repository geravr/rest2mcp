export type Widened<T> = T extends string
  ? string
  : T extends readonly (infer U)[]
    ? Widened<U>[]
    : T extends object
      ? { [K in keyof T]: Widened<T[K]> }
      : T;
