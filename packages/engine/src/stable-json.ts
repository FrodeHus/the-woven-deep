export function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isArrayElementKey(key: string, length: number): boolean {
  const index = Number(key);
  return Number.isInteger(index) && index >= 0 && index < length && String(index) === key;
}

function serializeArray(value: unknown[], ancestors: Set<object>): string {
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    throw new TypeError('stable JSON arrays must be plain');
  }
  if (ancestors.has(value)) {
    throw new TypeError('stable JSON cannot contain a cycle');
  }

  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key === 'symbol')) {
    throw new TypeError('stable JSON cannot contain symbol keys');
  }

  const entries: string[] = [];
  const nested = new Set(ancestors).add(value);
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined) {
      throw new TypeError('stable JSON cannot contain a sparse array');
    }
    if (!descriptor.enumerable || !('value' in descriptor)) {
      throw new TypeError('stable JSON arrays require enumerable data properties');
    }
    entries.push(serialize(descriptor.value, nested));
  }

  if (keys.length !== value.length + 1) {
    for (const key of keys as string[]) {
      if (key === 'length' || isArrayElementKey(key, value.length)) {
        continue;
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (!descriptor.enumerable || !('value' in descriptor)) {
        throw new TypeError('stable JSON arrays require enumerable data properties');
      }
    }
    throw new TypeError('stable JSON arrays cannot contain extra properties');
  }

  return `[${entries.join(',')}]`;
}

function serializeObject(value: object, ancestors: Set<object>): string {
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('stable JSON objects must be plain');
  }
  if (ancestors.has(value)) {
    throw new TypeError('stable JSON cannot contain a cycle');
  }

  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key === 'symbol')) {
    throw new TypeError('stable JSON cannot contain symbol keys');
  }

  const descriptors = new Map<string, PropertyDescriptor>();
  for (const key of keys as string[]) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!descriptor.enumerable || !('value' in descriptor)) {
      throw new TypeError('stable JSON objects require enumerable data properties');
    }
    descriptors.set(key, descriptor);
  }

  const nested = new Set(ancestors).add(value);
  const entries = (keys as string[])
    .sort(compareCodeUnits)
    .map((key) => `${JSON.stringify(key)}:${serialize(descriptors.get(key)!.value, nested)}`);
  return `{${entries.join(',')}}`;
}

function serialize(value: unknown, ancestors: Set<object>): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number') {
    if (
      !Number.isFinite(value) ||
      Math.abs(value) > Number.MAX_SAFE_INTEGER ||
      Object.is(value, -0)
    ) {
      throw new TypeError(
        'stable JSON numbers must be finite, unambiguous, and within safe magnitude',
      );
    }
    return String(value);
  }
  if (Array.isArray(value)) return serializeArray(value, ancestors);
  if (typeof value === 'object') return serializeObject(value, ancestors);
  throw new TypeError(`unsupported stable JSON value: ${typeof value}`);
}

export function stableJson(value: unknown): string {
  return serialize(value, new Set());
}
