import "server-only";

export class ProblemThreadError extends Error {
  constructor(readonly code: string) { super(code); }
}
