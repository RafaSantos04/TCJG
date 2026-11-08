export class InvalidWagerMessageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidWagerMessageError';
  }
}
