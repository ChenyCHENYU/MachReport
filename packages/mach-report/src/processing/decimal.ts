/** Bounded base-ten arithmetic. Decimal strings never pass through IEEE-754 numbers. */
export interface DecimalValue {
  coefficient: bigint;
  scale: number;
}
const MAX_DIGITS = 1000;
function power(exponent: number): bigint {
  if (
    !Number.isSafeInteger(exponent) ||
    exponent < 0 ||
    exponent > MAX_DIGITS * 2
  )
    throw new Error("十进制精度超出预算");
  return 10n ** BigInt(exponent);
}
function bounded(value: DecimalValue): DecimalValue {
  if (
    value.coefficient.toString().length > MAX_DIGITS * 2 ||
    value.scale > MAX_DIGITS * 2
  )
    throw new Error("十进制结果超出精度预算");
  return value;
}
export function parseDecimal(input: unknown): DecimalValue {
  if (
    typeof input !== "string" &&
    !(typeof input === "number" && Number.isFinite(input))
  )
    throw new Error("十进制参数必须是有限数字或十进制文本");
  const source = String(input);
  if (source.length > MAX_DIGITS) throw new Error("十进制文本超出精度预算");
  const match = /^([+-]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d{1,4}))?$/.exec(
    source,
  );
  if (!match) throw new Error("无效十进制文本");
  const fraction = match[3] ?? "",
    exponent = Number(match[4] ?? 0);
  const scale = fraction.length - exponent;
  const coefficient = BigInt(
    `${match[1] === "-" ? "-" : ""}${match[2]}${fraction}`,
  );
  return bounded(
    scale < 0
      ? { coefficient: coefficient * power(-scale), scale: 0 }
      : { coefficient, scale },
  );
}
function aligned(a: DecimalValue, b: DecimalValue): [bigint, bigint, number] {
  const scale = Math.max(a.scale, b.scale);
  return [
    a.coefficient * power(scale - a.scale),
    b.coefficient * power(scale - b.scale),
    scale,
  ];
}
export function compareDecimal(a: DecimalValue, b: DecimalValue): number {
  const [left, right] = aligned(a, b);
  return left < right ? -1 : left > right ? 1 : 0;
}
export function addDecimal(a: DecimalValue, b: DecimalValue): DecimalValue {
  const [left, right, scale] = aligned(a, b);
  return bounded({ coefficient: left + right, scale });
}
export function multiplyDecimal(
  a: DecimalValue,
  b: DecimalValue,
): DecimalValue {
  return bounded({
    coefficient: a.coefficient * b.coefficient,
    scale: a.scale + b.scale,
  });
}
function roundedQuotient(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator,
    remainder = numerator % denominator;
  const absolute = (value: bigint) => (value < 0n ? -value : value);
  if (absolute(remainder) * 2n < absolute(denominator)) return quotient;
  return quotient + (numerator < 0n === denominator < 0n ? 1n : -1n);
}
export function decimalDigits(digits: number): void {
  if (!Number.isInteger(digits) || digits < 0 || digits > 100)
    throw new Error("十进制小数位应为 0–100 的整数");
}
export function divideDecimal(
  a: DecimalValue,
  b: DecimalValue,
  digits = 20,
): DecimalValue {
  decimalDigits(digits);
  if (b.coefficient === 0n) throw new Error("不能除以零");
  const exponent = b.scale - a.scale + digits;
  const numerator = a.coefficient * power(Math.max(0, exponent));
  const denominator = b.coefficient * power(Math.max(0, -exponent));
  return bounded({
    coefficient: roundedQuotient(numerator, denominator),
    scale: digits,
  });
}
export function printDecimal(value: DecimalValue, digits?: number): string {
  let coefficient = value.coefficient,
    scale = value.scale;
  if (digits !== undefined) {
    decimalDigits(digits);
    coefficient =
      digits >= scale
        ? coefficient * power(digits - scale)
        : roundedQuotient(coefficient, power(scale - digits));
    scale = digits;
  }
  const negative = coefficient < 0n,
    text = (negative ? -coefficient : coefficient)
      .toString()
      .padStart(scale + 1, "0");
  let fraction = scale ? text.slice(-scale) : "";
  if (digits === undefined) fraction = fraction.replace(/0+$/, "");
  return `${negative ? "-" : ""}${scale ? text.slice(0, -scale) : text}${fraction ? `.${fraction}` : ""}`;
}
/** Formats decimal data exactly while preserving it as text in Excel. */
export function formatDecimal(
  input: string,
  digits?: number,
  thousands = false,
  percent = false,
): string {
  let value = parseDecimal(input);
  if (percent) value = multiplyDecimal(value, { coefficient: 100n, scale: 0 });
  const [integer, fraction] = printDecimal(value, digits).split(".");
  const head = thousands
    ? integer!.replace(/\B(?=(\d{3})+(?!\d))/g, ",")
    : integer!;
  return `${head}${fraction === undefined ? "" : `.${fraction}`}${percent ? "%" : ""}`;
}
