/**
 * Error hierarchy. `ForgeError` is the base for every *expected*, user-facing failure
 * (bad file, unsupported format, currency mismatch, invalid CLI argument). The CLI renders
 * these as clean messages with a non-zero exit code; anything that is NOT a ForgeError is
 * treated as an unexpected internal bug.
 */
export class ForgeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}
