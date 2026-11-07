import { CurrencyMismatchError } from '../errors/currency-mismatch.error.js';
import { InvalidMoneyError } from '../errors/invalid-money.error.js';

const AMOUNT_PATTERN = /^(0|[1-9]\d*)\.(\d{2})$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const MINOR_UNITS_PER_MAJOR = 100n;

export type SerializedMoney = Readonly<{
  amount: string;
  currency: string;
}>;

export class Money {
  private constructor(
    private readonly minorUnits: bigint,
    readonly currency: string,
  ) {
    Object.freeze(this);
  }

  static from(amount: string, currency: string): Money {
    Money.assertValidCurrency(currency);

    if (typeof amount !== 'string') {
      throw new InvalidMoneyError('Amount must be provided as a string');
    }

    const match = AMOUNT_PATTERN.exec(amount);

    if (match === null) {
      throw new InvalidMoneyError(
        'Amount must be a non-negative decimal string with exactly two fractional digits',
      );
    }

    const [, majorUnits, fractionalUnits] = match;
    const minorUnits =
      BigInt(majorUnits) * MINOR_UNITS_PER_MAJOR + BigInt(fractionalUnits);

    return new Money(minorUnits, currency);
  }

  static zero(currency: string): Money {
    Money.assertValidCurrency(currency);

    return new Money(0n, currency);
  }

  get amount(): string {
    return this.formatAmount();
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);

    return Money.fromMinorUnits(
      this.minorUnits + other.minorUnits,
      this.currency,
    );
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);

    return Money.fromMinorUnits(
      this.minorUnits - other.minorUnits,
      this.currency,
    );
  }

  negate(): Money {
    return Money.fromMinorUnits(-this.minorUnits, this.currency);
  }

  isZero(): boolean {
    return this.minorUnits === 0n;
  }

  isPositive(): boolean {
    return this.minorUnits > 0n;
  }

  isNegative(): boolean {
    return this.minorUnits < 0n;
  }

  isLessThan(other: Money): boolean {
    this.assertSameCurrency(other);

    return this.minorUnits < other.minorUnits;
  }

  equals(other: Money): boolean {
    this.assertSameCurrency(other);

    return this.minorUnits === other.minorUnits;
  }

  assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new CurrencyMismatchError(this.currency, other.currency);
    }
  }

  toJSON(): SerializedMoney {
    return Object.freeze({
      amount: this.amount,
      currency: this.currency,
    });
  }

  toString(): string {
    return `${this.currency} ${this.amount}`;
  }

  private static fromMinorUnits(minorUnits: bigint, currency: string): Money {
    return new Money(minorUnits, currency);
  }

  private static assertValidCurrency(currency: string): void {
    if (typeof currency !== 'string' || !CURRENCY_PATTERN.test(currency)) {
      throw new InvalidMoneyError(
        'Currency must be a three-letter uppercase ISO-4217 code',
      );
    }
  }

  private formatAmount(): string {
    const isNegative = this.minorUnits < 0n;
    const absoluteMinorUnits = isNegative ? -this.minorUnits : this.minorUnits;
    const majorUnits = absoluteMinorUnits / MINOR_UNITS_PER_MAJOR;
    const fractionalUnits = (absoluteMinorUnits % MINOR_UNITS_PER_MAJOR)
      .toString()
      .padStart(2, '0');

    return `${isNegative ? '-' : ''}${majorUnits}.${fractionalUnits}`;
  }
}
