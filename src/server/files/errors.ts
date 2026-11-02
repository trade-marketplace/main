// Why an upload was turned away. `code` is for code and tests; `message` is plain English for the person.

export type UploadErrorCode =
  | "empty"
  | "too-large"
  | "wrong-type"
  | "unreadable"
  | "too-many-photos"
  | "not-allowed"
  | "not-found"
  | "storage-failed";

export class UploadError extends Error {
  constructor(
    readonly code: UploadErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "UploadError";
  }
}

export const MESSAGES = {
  empty: "That file is empty. Choose another one.",
  tooLarge: "That file is over 10 MB. Choose a smaller one.",
  photoType: "Photos must be a JPG, PNG or HEIC picture.",
  documentType: "Documents must be a PDF, JPG, PNG or HEIC file.",
  unreadable: "We couldn't read that picture. Try another one.",
  tooManyPhotos: "A job can have up to 10 photos.",
  notAllowed: "You can't do that.",
  notFound: "We couldn't find that file.",
  storageFailed: "We couldn't save that file. Try again.",
} as const;
