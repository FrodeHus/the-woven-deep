import { describe, expect, it } from 'vitest';
import { compareCodeUnits, stableJson } from '../src/index.js';

describe('compareCodeUnits', () => {
  it('orders strings by UTF-16 code units', () => {
    expect(compareCodeUnits('\u{10000}', '\uE000')).toBe(-1);
    expect(compareCodeUnits('same', 'same')).toBe(0);
    expect(compareCodeUnits('z', 'a')).toBe(1);
  });
});

describe('stableJson', () => {
  it('sorts object keys recursively and retains array order', () => {
    expect(stableJson({ z: 1, a: { beta: 2, alpha: 1 }, list: [3, 2, 1] }))
      .toBe('{"a":{"alpha":1,"beta":2},"list":[3,2,1],"z":1}');
    expect(stableJson({ 2: 'two', 10: 'ten' })).toBe('{"10":"ten","2":"two"}');
  });

  it.each([NaN, Infinity, -Infinity, -0, 1.5, Number.MAX_SAFE_INTEGER + 1, undefined, new Map()])(
    'rejects unsupported value %s',
    (value) => expect(() => stableJson({ value })).toThrow(),
  );

  it.each([() => undefined, 1n, Symbol('value')])(
    'rejects unsupported primitive %s',
    (value) => expect(() => stableJson(value)).toThrow(/unsupported/),
  );

  it('rejects sparse arrays, cycles, non-plain objects, and undefined children', () => {
    const sparse = Array(2); sparse[1] = 1;
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
    expect(() => stableJson(sparse)).toThrow(/sparse/);
    expect(() => stableJson(cyclic)).toThrow(/cycle/);
    expect(() => stableJson(new (class Value {})())).toThrow(/plain/);
    expect(() => stableJson({ missing: undefined })).toThrow(/unsupported/);
  });

  it('rejects symbol keys and accessor properties instead of silently dropping or invoking them', () => {
    expect(() => stableJson({ [Symbol('hidden')]: 1 })).toThrow(/symbol/);
    const accessed = Object.defineProperty({}, 'value', { enumerable: true, get: () => 1 });
    expect(() => stableJson(accessed)).toThrow(/data properties/);
  });

  it('rejects non-enumerable object properties', () => {
    const hidden = Object.defineProperty({}, 'value', { value: 1 });
    expect(() => stableJson(hidden)).toThrow(/enumerable data properties/);
  });

  it('rejects array accessors and extra properties without invoking accessors', () => {
    let invoked = false;
    const accessor = [1];
    Object.defineProperty(accessor, 0, {
      enumerable: true,
      get: () => {
        invoked = true;
        return 1;
      },
    });
    expect(() => stableJson(accessor)).toThrow(/data properties/);
    expect(invoked).toBe(false);

    const extra = [1] as number[] & { ignored?: number };
    extra.ignored = 2;
    expect(() => stableJson(extra)).toThrow(/properties/);
  });

  it('rejects array subclasses', () => {
    class ArraySubclass extends Array<number> {}
    expect(() => stableJson(new ArraySubclass(1))).toThrow(/plain/);
  });

  it('rejects array symbol properties', () => {
    const array = [1] as number[] & { [key: symbol]: number };
    array[Symbol('hidden')] = 2;
    expect(() => stableJson(array)).toThrow(/symbol/);
  });

  it('rejects non-enumerable extra array properties', () => {
    const array = Object.defineProperty([1], 'hidden', { value: 2 });
    expect(() => stableJson(array)).toThrow(/enumerable data properties/);
  });

  it('accepts null-prototype plain objects', () => {
    const value = Object.assign(Object.create(null) as Record<string, number>, { b: 2, a: 1 });
    expect(stableJson(value)).toBe('{"a":1,"b":2}');
  });

  it('serializes shared non-cyclic references normally', () => {
    const shared = { b: 2, a: 1 };
    expect(stableJson([shared, shared])).toBe('[{"a":1,"b":2},{"a":1,"b":2}]');
  });

  it('emits byte-stable compact text without a trailing newline', () => {
    const first = stableJson({ b: 2, a: 1 });
    expect(stableJson(JSON.parse(first))).toBe(first);
    expect(first.endsWith('\n')).toBe(false);
  });
});
