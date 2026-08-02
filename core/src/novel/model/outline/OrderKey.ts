/** Provides dense opaque ordering keys without renumbering existing siblings. */
import {
  NOVEL_PROTOCOL_FAILURE,
  NovelProtocolValidationError,
} from "../../error/index.js";

declare const orderKeyBrand: unique symbol;

export type OrderKey = string & {
  readonly [orderKeyBrand]: "OrderKey";
};

export interface OrderKeyFactory {
  initial(): OrderKey;
  before(next: OrderKey): OrderKey;
  after(previous: OrderKey): OrderKey;
  between(previous: OrderKey, next: OrderKey): OrderKey;
}

const DIGIT_WIDTH = 4;
const DIGIT_RADIX = 16;
const DIGIT_LIMIT = 0x1_0000;
const INITIAL_DIGIT = DIGIT_LIMIT / 2;
const ORDER_KEY_PATTERN = /^(?:[0-9A-F]{4})+$/u;

export function captureOrderKey(value: unknown): OrderKey {
  if (
    typeof value !== "string" ||
    !ORDER_KEY_PATTERN.test(value) ||
    value.endsWith("0000")
  ) {
    throw invalidOrderKey();
  }
  return value as OrderKey;
}

export function compareOrderKeys(
  leftInput: OrderKey,
  rightInput: OrderKey,
): number {
  const left = captureOrderKey(leftInput);
  const right = captureOrderKey(rightInput);
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

export class FractionalOrderKeyFactory implements OrderKeyFactory {
  initial(): OrderKey {
    return encodeDigits([INITIAL_DIGIT]);
  }

  before(nextInput: OrderKey): OrderKey {
    const next = captureOrderKey(nextInput);
    return createBetween(undefined, decodeDigits(next));
  }

  after(previousInput: OrderKey): OrderKey {
    const previous = captureOrderKey(previousInput);
    return createBetween(decodeDigits(previous), undefined);
  }

  between(previousInput: OrderKey, nextInput: OrderKey): OrderKey {
    const previous = captureOrderKey(previousInput);
    const next = captureOrderKey(nextInput);
    if (compareOrderKeys(previous, next) >= 0) throw invalidOrderKey();
    return createBetween(decodeDigits(previous), decodeDigits(next));
  }
}

function createBetween(
  lower: readonly number[] | undefined,
  upper: readonly number[] | undefined,
): OrderKey {
  const digits: number[] = [];
  let depth = 0;
  let upperIsBounded = upper !== undefined;

  while (true) {
    const lowerDigit = lower?.[depth] ?? 0;
    const upperDigit = upperIsBounded
      ? (upper?.[depth] ?? DIGIT_LIMIT)
      : DIGIT_LIMIT;

    if (lowerDigit === upperDigit) {
      digits.push(lowerDigit);
      depth += 1;
      continue;
    }

    if (upperDigit - lowerDigit > 1) {
      digits.push(Math.floor((lowerDigit + upperDigit) / 2));
      return encodeDigits(digits);
    }

    digits.push(lowerDigit);
    depth += 1;
    upperIsBounded = false;
  }
}

function decodeDigits(orderKey: OrderKey): number[] {
  const digits: number[] = [];
  for (let offset = 0; offset < orderKey.length; offset += DIGIT_WIDTH) {
    digits.push(
      Number.parseInt(orderKey.slice(offset, offset + DIGIT_WIDTH), DIGIT_RADIX),
    );
  }
  return digits;
}

function encodeDigits(digits: readonly number[]): OrderKey {
  return captureOrderKey(
    digits
      .map((digit) =>
        digit.toString(DIGIT_RADIX).toUpperCase().padStart(DIGIT_WIDTH, "0"),
      )
      .join(""),
  );
}

function invalidOrderKey(): NovelProtocolValidationError {
  return new NovelProtocolValidationError(
    NOVEL_PROTOCOL_FAILURE.invalidOrderKey,
    "orderKey",
  );
}
