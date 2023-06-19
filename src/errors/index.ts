export class ClientError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly payload?: { [key: string]: unknown },
  ) {
    super(message);
    Object.setPrototypeOf(this, ClientError.prototype);
  }
}
