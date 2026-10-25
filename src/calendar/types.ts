export type CalendarEvent = {
  id: string; calendarId: string; title: string; start: string; end: string;
  allDay: boolean; etag: string; htmlLink?: string; joinUrl?: string;
  attendees: string[]; createMeet: boolean;
  recurringEventId?: string; originalStartTime?: string;
};
export type CalendarInfo = { id: string; title: string; timeZone: string; accessRole: string; primary: boolean };
export type EventDraft = {
  calendarId: string; id?: string; etag?: string; title: string;
  start: string; end: string; attendees: string[]; createMeet: boolean;
};
export type TokenBundle = { accessToken: string; refreshToken: string; expiresAt: number; scopes: string[] };
export type StoredValue = { ciphertext: string | null; revision: number };
export type CalendarStore = {
  identity: string;
  get(slot: 'tokens' | 'oauth'): Promise<StoredValue>;
  set(slot: 'tokens' | 'oauth', ciphertext: string | null, revision: number): Promise<StoredValue>;
  close(): void;
};
export type CalendarConfig = { clientId: string; clientSecret: string; origin: string; key: Buffer };
