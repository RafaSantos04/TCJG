export class InvalidMoneyError extends Error {
  override readonly name = 'InvalidMoneyError';

  constructor(message: string) {
    super(message);
  }
}
