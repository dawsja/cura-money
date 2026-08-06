/**
 * HTTP error helpers. Routes return JSON only; the React UI handles errors.
 */
import type { Context } from 'hono';
import { logger } from './logger';

export type AppError = {
  error: string;
  code?: string;
  details?: unknown;
};

export function badRequest(c: Context, error: string, code = 'bad_request'): Response {
  return c.json({ error, code }, 400);
}

export function unauthorized(c: Context, error = 'unauthorized'): Response {
  return c.json({ error, code: 'unauthorized' }, 401);
}

export function forbidden(c: Context, error = 'forbidden'): Response {
  return c.json({ error, code: 'forbidden' }, 403);
}

export function notFound(c: Context, error = 'not found'): Response {
  return c.json({ error, code: 'not_found' }, 404);
}

export function conflict(c: Context, error: string, code = 'conflict'): Response {
  return c.json({ error, code }, 409);
}

export function serverError(c: Context, error = 'internal server error'): Response {
  return c.json({ error, code: 'server_error' }, 500);
}

/**
 * Wrap a route handler so any thrown Error becomes a JSON response.
 *
 * If the error has a numeric `status` property, we honour it (so route
 * helpers like `requireAdmin` can throw a 403). Otherwise it falls through
 * to a 500.
 */
export function safe<T>(fn: (c: Context) => Promise<T>) {
  return async (c: Context): Promise<Response | T> => {
    try {
      return await fn(c);
    } catch (err) {
      const e = err as { status?: number; message?: string };
      const status = (typeof e.status === 'number' ? e.status : 500) as 400 | 401 | 403 | 404 | 409 | 422 | 500;
      const expected = status >= 400 && status < 500;
      const message = expected ? (e.message ?? 'request failed') : 'internal server error';
      if (!expected) logger.error({ err }, 'request handler failed');
      return c.json(
        { error: message, code: status === 403 ? 'forbidden' : expected ? 'handler_error' : 'server_error' },
        status,
      );
    }
  };
}
