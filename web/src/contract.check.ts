// Compile-time parity check: representative JSON fixtures must fit the wire-facing type.
import type { Result } from "./contract";
import done from "../../contracts/mocks/result_ok.json";
import partial from "../../contracts/mocks/result_partial_unanalyzable.json";
import failed from "../../contracts/mocks/result_failed.json";

// TypeScript widens imported JSON strings. Preserve shape checks and leave enum values
// and cross-field invariants to the server's schema/fixture tests.
type JsonShape<T> = T extends string ? string : T extends number ? number :
  T extends readonly (infer Item)[] ? JsonShape<Item>[] :
  T extends object ? string extends keyof T ? Partial<{ [Key in keyof T]: JsonShape<T[Key]> }> :
    { [Key in keyof T]: JsonShape<T[Key]> } : T;

export const contractFixtures: JsonShape<Result>[] = [done, partial, failed];
