import type { IncomingMessage, ServerResponse } from 'node:http';

export type VercelRequestQuery = Record<string, string | string[] | undefined>;

export interface VercelRequest extends IncomingMessage {
  body?: any;
  cookies?: Record<string, string>;
  query: VercelRequestQuery;
}

export interface VercelResponse extends ServerResponse {
  status(code: number): VercelResponse;
  json(body: any): VercelResponse;
  send(body: any): VercelResponse;
  redirect(url: string): VercelResponse;
  redirect(status: number, url: string): VercelResponse;
}
