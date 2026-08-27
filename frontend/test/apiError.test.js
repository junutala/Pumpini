// WHAT A MANAGER IS SHOWN WHEN A REQUEST FAILS.
//
// On 27-Aug-2026 End Shift showed the owner, in a red box, as the whole
// explanation: `missing_closing_dip`. The backend had sent, in the SAME response,
// "Closing dip missing for Tank 1, Tank 2. Every tank must be read before this
// shift can close." — and the frontend threw it away, because lib/api.js already
// unwraps the axios error and forty-nine catch blocks read `e.response?.data`
// anyway, which is always undefined.
//
// These pin the two rules that stop it recurring: prefer the server's SENTENCE,
// and never show a machine CODE to a human.
import { describe, it, expect } from 'vitest';
import { errText, errCode, errPayload } from '../src/lib/apiError';

describe('errText — what a human is shown', () => {
  it('prefers the server sentence over the code', () => {
    expect(errText({ error: 'missing_closing_dip', message: 'Closing dip missing for Tank 1, Tank 2.' }, 'FB'))
      .toBe('Closing dip missing for Tank 1, Tank 2.');
  });

  it('NEVER shows a snake_case code — falls back to plain words instead', () => {
    expect(errText({ error: 'missing_closing_dip' }, 'Could not close the shift')).toBe('Could not close the shift');
    expect(errText({ error: 'active_pos' },          'Could not close the shift')).toBe('Could not close the shift');
    expect(errText({ error: 'ERR_BAD_REQUEST' },     'Could not save')).toBe('Could not save');
    expect(errText({ error: '42703' },               'Could not save')).toBe('Could not save');
  });

  it('does show an `error` that is real prose — many routes answer that way', () => {
    expect(errText({ error: 'That pump is already retired.' }, 'FB')).toBe('That pump is already retired.');
  });

  it('handles the UNWRAPPED shape, which is what lib/api.js actually throws', () => {
    // api.js: Promise.reject(err.response?.data || err) — so `e` IS the payload.
    expect(errText({ message: 'Shift not found or already closed' }, 'FB'))
      .toBe('Shift not found or already closed');
  });

  it('still handles a raw axios error, in case api.js ever stops unwrapping', () => {
    expect(errText({ response: { data: { message: 'Real axios shape.' } } }, 'FB')).toBe('Real axios shape.');
  });

  it('falls back on null, undefined and empty payloads', () => {
    expect(errText(null, 'FB')).toBe('FB');
    expect(errText(undefined, 'FB')).toBe('FB');
    expect(errText({}, 'FB')).toBe('FB');
    expect(errText({ error: '' }, 'FB')).toBe('FB');
  });
});

describe('errCode — what a SCREEN branches on', () => {
  it('returns the code so the dip dialog can reopen', () => {
    // This branch was dead code: it tested d.error on a d that was always undefined.
    expect(errCode({ error: 'missing_closing_dip', tanks: [{ tank_number: 1 }] })).toBe('missing_closing_dip');
  });
  it('is null when the server sent prose, not a code', () => {
    expect(errCode({ error: 'That pump is already retired.' })).toBe(null);
    expect(errCode({ message: 'Anything' })).toBe(null);
    expect(errCode(null)).toBe(null);
  });
});

describe('errPayload — the raw object, whichever shape it arrives in', () => {
  it('returns the payload from the unwrapped shape', () => {
    const p = { error: 'x_y', tanks: [1, 2] };
    expect(errPayload(p)).toEqual(p);
  });
  it('digs it out of a real axios error', () => {
    expect(errPayload({ response: { data: { error: 'x_y' } } })).toEqual({ error: 'x_y' });
  });
  it('never throws on rubbish', () => {
    expect(errPayload(null)).toEqual({});
    expect(errPayload('a string')).toEqual({});
  });
});
