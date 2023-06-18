export class ClientError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly payload?: any,
  ) {
    super(message);
    Object.setPrototypeOf(this, ClientError.prototype);
  }
}
