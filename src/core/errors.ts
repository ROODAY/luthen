export type ErrorCode =
  | "INVALID_SHARE"
  | "MIXED_SETS"
  | "DUPLICATE_SHARE"
  | "NOT_ENOUGH_SHARES"
  | "DECRYPT_FAILED"
  | "BAD_SCHEME";

export class LuthenError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "LuthenError";
    this.code = code;
  }
}
