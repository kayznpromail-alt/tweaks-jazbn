import { userFacingError } from "../api";
import { ProfileError } from "../profiles";
import { StorageError } from "../storage/store";

const messages = {
  project: "choose an existing project directory.",
  busy: "wait for the operation to finish or interrupt the response.",
  closed: "the chat controller is closed.",
  uninitialized: "initialize the conversation first.",
  disconnected: "connect an api key first.",
  model: "choose a model available to this key.",
  session: "session not found in the current project.",
  text: "enter a nonempty message.",
  retry: "no unfinished response to retry.",
  key: "enter a valid api key.",
  credential_read: "could not read the key from the system credential store.",
  credential_write: "could not save the key to the system credential store. you can explicitly choose memory-only mode.",
  credential_delete: "could not delete the key from the system credential store.",
  unsaved: "part of the conversation was not saved. copy the visible text before reloading the session or closing.",
} as const;

export class CoreError extends Error {
  constructor(readonly code: keyof typeof messages) {
    super(messages[code]);
  }
}

/** nigdy nie ufamy error.message, nawet w błędach znanych klas. */
export function safeError(error: unknown): string {
  if (error instanceof CoreError && Object.hasOwn(messages, error.code)) return messages[error.code];
  if (error instanceof StorageError) return new StorageError(error.code).message;
  if (error instanceof ProfileError) return new ProfileError(error.code).message;
  return userFacingError(error);
}
