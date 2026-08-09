import { describe, expect, it } from 'vitest';
import { parseSetCookieHeader, readSetCookieHeaders } from '../auth-bff';

describe('auth BFF cookie forwarding', () => {
  it('parses HttpOnly session cookie attributes from upstream API', () => {
    const parsed = parseSetCookieHeader(
      'wa_session_local=abc123; HttpOnly; Path=/; SameSite=Lax; Max-Age=2592000',
    );
    expect(parsed).toMatchObject({
      name: 'wa_session_local',
      value: 'abc123',
      httpOnly: true,
      path: '/',
      sameSite: 'Lax',
      maxAge: 2592000,
    });
  });

  it('reads multiple Set-Cookie headers when available', () => {
    const response = new Response(null, {
      headers: {
        'set-cookie': 'wa_session_local=token; Path=/; HttpOnly; SameSite=Lax',
      },
    });
    expect(readSetCookieHeaders(response).length).toBeGreaterThan(0);
  });
});
