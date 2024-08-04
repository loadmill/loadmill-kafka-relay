import {
  AbortError,
  ClientClosedError,
  ClientOfflineError,
  ConnectionTimeoutError,
  DisconnectsClientError,
  ErrorReply,
  MultiErrorReply,
  ReconnectStrategyError,
  RootNodesUnavailableError,
  SocketClosedUnexpectedlyError,
  WatchError,
} from '@redis/client';

export type RedisError =
  AbortError |
  ClientClosedError |
  ClientOfflineError |
  ConnectionTimeoutError |
  DisconnectsClientError |
  ErrorReply |
  MultiErrorReply |
  ReconnectStrategyError |
  RootNodesUnavailableError |
  SocketClosedUnexpectedlyError |
  WatchError;
