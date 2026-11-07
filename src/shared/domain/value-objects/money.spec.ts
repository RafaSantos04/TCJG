import { CurrencyMismatchError } from '../errors/currency-mismatch.error.js';
import { InvalidMoneyError } from '../errors/invalid-money.error.js';
import { Money } from './money.js';

describe('Money', () => {
  describe('from', () => {
    it.each([
      ['0.00', '0.00'],
      ['25.00', '25.00'],
      ['0.01', '0.01'],
      ['9007199254740993.99', '9007199254740993.99'],
    ])('creates an exact amount from %s', (input, expected) => {
      const money = Money.from(input, 'BRL');

      expect(money.toJSON()).toEqual({
        amount: expected,
        currency: 'BRL',
      });
    });

    it.each([
      '',
      'NaN',
      'Infinity',
      '1e3',
      '1',
      '1.0',
      '1.000',
      '-1.00',
      '01.00',
      '.50',
      ' 1.00',
      '1.00 ',
    ])('rejects the invalid amount %j', (amount) => {
      expect(() => Money.from(amount, 'BRL')).toThrow(InvalidMoneyError);
    });

    it('rejects number input even when its decimal representation looks valid', () => {
      expect(() => Money.from(1.23 as unknown as string, 'BRL')).toThrow(
        InvalidMoneyError,
      );
    });

    it.each(['brl', 'BR', 'BRLL', '123', '', ' BRL'])(
      'rejects the invalid currency %j',
      (currency) => {
        expect(() => Money.from('1.00', currency)).toThrow(InvalidMoneyError);
      },
    );
  });

  it('adds decimal amounts exactly', () => {
    const result = Money.from('0.10', 'BRL').add(Money.from('0.20', 'BRL'));

    expect(result.amount).toBe('0.30');
  });

  it('subtracts amounts exactly and can produce an internal negative value', () => {
    const result = Money.from('10.00', 'BRL').subtract(
      Money.from('25.50', 'BRL'),
    );

    expect(result.amount).toBe('-15.50');
    expect(result.isNegative()).toBe(true);
  });

  it('negates an amount without allowing negative public input', () => {
    const original = Money.from('12.34', 'BRL');
    const negative = original.negate();

    expect(negative.amount).toBe('-12.34');
    expect(negative.negate().equals(original)).toBe(true);
  });

  it('creates zero and identifies amount signs', () => {
    const zero = Money.zero('BRL');
    const positive = Money.from('0.01', 'BRL');
    const negative = positive.negate();

    expect(zero.isZero()).toBe(true);
    expect(zero.isPositive()).toBe(false);
    expect(zero.isNegative()).toBe(false);
    expect(positive.isPositive()).toBe(true);
    expect(negative.isNegative()).toBe(true);
  });

  it('compares amounts of the same currency', () => {
    const smaller = Money.from('9.99', 'BRL');
    const larger = Money.from('10.00', 'BRL');

    expect(smaller.isLessThan(larger)).toBe(true);
    expect(larger.isLessThan(smaller)).toBe(false);
    expect(larger.equals(Money.from('10.00', 'BRL'))).toBe(true);
  });

  it.each(['add', 'subtract', 'isLessThan', 'equals'] as const)(
    'rejects a currency mismatch in %s',
    (operation) => {
      const reais = Money.from('10.00', 'BRL');
      const dollars = Money.from('10.00', 'USD');

      expect(() => reais[operation](dollars)).toThrow(CurrencyMismatchError);
    },
  );

  it('exposes mismatch details in the domain error', () => {
    const reais = Money.from('10.00', 'BRL');
    const dollars = Money.from('10.00', 'USD');

    try {
      reais.assertSameCurrency(dollars);
      expect.fail('Expected assertSameCurrency to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(CurrencyMismatchError);
      expect(error).toMatchObject({
        expectedCurrency: 'BRL',
        receivedCurrency: 'USD',
      });
    }
  });

  it('returns new instances and leaves the operands unchanged', () => {
    const original = Money.from('10.00', 'BRL');
    const increment = Money.from('2.50', 'BRL');
    const result = original.add(increment);

    expect(result).not.toBe(original);
    expect(result).not.toBe(increment);
    expect(original.amount).toBe('10.00');
    expect(increment.amount).toBe('2.50');
    expect(result.amount).toBe('12.50');
    expect(Object.isFrozen(original)).toBe(true);
  });

  it('serializes consistently', () => {
    const money = Money.from('25.00', 'BRL');

    expect(money.toJSON()).toEqual({ amount: '25.00', currency: 'BRL' });
    expect(money.toString()).toBe('BRL 25.00');
    expect(JSON.stringify(money)).toBe('{"amount":"25.00","currency":"BRL"}');
  });
});
