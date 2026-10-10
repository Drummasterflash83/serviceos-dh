/** Only explicit database rejections permit abandoning a saved request. */
export class SlackImportError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "SlackImportError";
    this.code = code;
  }
}
export const rejectedSlackImport = (error: unknown) =>
  error instanceof SlackImportError && ["PT409", "40001", "55000", "22023"].includes(error.code);
