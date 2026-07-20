// Compile-time drift guards binding each Zod schema's inferred output to its
// hand-written interface. `Clean` normalizes representational differences that
// are irrelevant to structural agreement (readonly modifiers, and the gap
// between an optional property and an explicitly-`undefined` one), so the
// remaining comparison fails only on genuine drift: a field present on one side
// and absent on the other, or a changed field type. `Expect<Equals<...>>` turns
// any such disagreement into a `tsc` error.

export type Clean<T> = T extends readonly (infer E)[]
  ? readonly Clean<E>[]
  : T extends object
    ? { -readonly [K in keyof T]-?: Clean<Exclude<T[K], undefined>> }
    : T;

export type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

export type Expect<T extends true> = T;

export type SchemaMatches<SchemaOutput, Interface> = Equals<Clean<SchemaOutput>, Clean<Interface>>;
