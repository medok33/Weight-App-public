import { describe, expect, it } from "vitest";
import {
  assertActivityStepsValue,
  pickEffectiveSnapshot,
  remainingSteps,
  resolveActivityProviderStatus,
  resolveActivityStaleHours,
  resolveConsentStateFromRows,
} from "../domain/activity.types";

describe("activity domain", () => {
  it("distinguishes validation for steps", () => {
    expect(assertActivityStepsValue(0)).toBe(0);
    expect(assertActivityStepsValue(6420)).toBe(6420);
    expect(() => assertActivityStepsValue(-1)).toThrow("ACTIVITY_STEPS_OUT_OF_RANGE");
    expect(() => assertActivityStepsValue(1.5)).toThrow("ACTIVITY_STEPS_INVALID");
    expect(() => assertActivityStepsValue(Number.NaN)).toThrow("ACTIVITY_STEPS_INVALID");
    expect(() => assertActivityStepsValue(200_001)).toThrow("ACTIVITY_STEPS_OUT_OF_RANGE");
  });

  it("never returns negative remaining", () => {
    expect(remainingSteps(8000, 6420)).toBe(1580);
    expect(remainingSteps(8000, 9000)).toBe(0);
    expect(remainingSteps(null, 100)).toBeNull();
  });

  it("picks effective snapshot without summing sources", () => {
    const picked = pickEffectiveSnapshot([
      {
        value: 1000,
        sourceType: "HEALTHKIT",
        syncClientId: "a",
        receivedAt: "2026-08-04T10:00:00.000Z",
      },
      {
        value: 2000,
        sourceType: "HEALTH_CONNECT",
        syncClientId: "b",
        receivedAt: "2026-08-04T11:00:00.000Z",
      },
    ]);
    expect(picked?.value).toBe(2000);
    expect(picked?.sourceType).toBe("HEALTH_CONNECT");
  });

  it("uses stable tie-break when receivedAt equal", () => {
    const picked = pickEffectiveSnapshot([
      {
        value: 3000,
        sourceType: "HEALTHKIT",
        syncClientId: "z",
        receivedAt: "2026-08-04T10:00:00.000Z",
      },
      {
        value: 1000,
        sourceType: "HEALTH_CONNECT",
        syncClientId: "a",
        receivedAt: "2026-08-04T10:00:00.000Z",
      },
    ]);
    expect(picked?.sourceType).toBe("HEALTH_CONNECT");
    expect(picked?.value).toBe(1000);
  });
});

describe("ACTIVITY-01B connection status matrix", () => {
  const now = new Date("2026-08-04T12:00:00.000Z");
  const staleAfterHours = 48;

  it("no consent + no connection → BLOCKED_BY_CONSENT / NOT_CONNECTED", () => {
    const view = resolveActivityProviderStatus({
      source: "HEALTHKIT",
      consentState: "NOT_GRANTED",
      connectionStatus: null,
      connectedAt: null,
      disconnectedAt: null,
      lastSuccessfulSyncAt: null,
      now,
      staleAfterHours,
    });
    expect(view.connectionState).toBe("NOT_CONNECTED");
    expect(view.syncHealth).toBe("BLOCKED_BY_CONSENT");
  });

  it("granted consent + no connection → NEVER_SYNCED / NOT_CONNECTED", () => {
    const view = resolveActivityProviderStatus({
      source: "HEALTHKIT",
      consentState: "GRANTED",
      connectionStatus: null,
      connectedAt: null,
      disconnectedAt: null,
      lastSuccessfulSyncAt: null,
      now,
      staleAfterHours,
    });
    expect(view.connectionState).toBe("NOT_CONNECTED");
    expect(view.syncHealth).toBe("NEVER_SYNCED");
  });

  it("connected + never synced", () => {
    const view = resolveActivityProviderStatus({
      source: "HEALTH_CONNECT",
      consentState: "GRANTED",
      connectionStatus: "CONNECTED",
      connectedAt: "2026-08-04T10:00:00.000Z",
      disconnectedAt: null,
      lastSuccessfulSyncAt: null,
      now,
      staleAfterHours,
    });
    expect(view.connectionState).toBe("CONNECTED");
    expect(view.syncHealth).toBe("NEVER_SYNCED");
  });

  it("connected + healthy", () => {
    const view = resolveActivityProviderStatus({
      source: "HEALTHKIT",
      consentState: "GRANTED",
      connectionStatus: "CONNECTED",
      connectedAt: "2026-08-01T10:00:00.000Z",
      disconnectedAt: null,
      lastSuccessfulSyncAt: "2026-08-04T10:00:00.000Z",
      now,
      staleAfterHours,
    });
    expect(view.syncHealth).toBe("HEALTHY");
  });

  it("connected + stale", () => {
    const view = resolveActivityProviderStatus({
      source: "HEALTHKIT",
      consentState: "GRANTED",
      connectionStatus: "CONNECTED",
      connectedAt: "2026-07-01T10:00:00.000Z",
      disconnectedAt: null,
      lastSuccessfulSyncAt: "2026-08-01T10:00:00.000Z",
      now,
      staleAfterHours,
    });
    expect(view.syncHealth).toBe("STALE");
  });

  it("revoked consent + connected → BLOCKED_BY_CONSENT (consent wins)", () => {
    const view = resolveActivityProviderStatus({
      source: "HEALTHKIT",
      consentState: "REVOKED",
      connectionStatus: "CONNECTED",
      connectedAt: "2026-08-01T10:00:00.000Z",
      disconnectedAt: null,
      lastSuccessfulSyncAt: "2026-08-04T10:00:00.000Z",
      now,
      staleAfterHours,
    });
    expect(view.connectionState).toBe("CONNECTED");
    expect(view.syncHealth).toBe("BLOCKED_BY_CONSENT");
  });

  it("disconnected + granted consent → BLOCKED_BY_DISCONNECT", () => {
    const view = resolveActivityProviderStatus({
      source: "HEALTHKIT",
      consentState: "GRANTED",
      connectionStatus: "DISCONNECTED",
      connectedAt: "2026-08-01T10:00:00.000Z",
      disconnectedAt: "2026-08-04T09:00:00.000Z",
      lastSuccessfulSyncAt: "2026-08-04T08:00:00.000Z",
      now,
      staleAfterHours,
    });
    expect(view.connectionState).toBe("DISCONNECTED");
    expect(view.syncHealth).toBe("BLOCKED_BY_DISCONNECT");
  });

  it("disconnected + revoked consent → BLOCKED_BY_CONSENT", () => {
    const view = resolveActivityProviderStatus({
      source: "HEALTH_CONNECT",
      consentState: "REVOKED",
      connectionStatus: "DISCONNECTED",
      connectedAt: "2026-08-01T10:00:00.000Z",
      disconnectedAt: "2026-08-04T09:00:00.000Z",
      lastSuccessfulSyncAt: "2026-08-03T08:00:00.000Z",
      now,
      staleAfterHours,
    });
    expect(view.syncHealth).toBe("BLOCKED_BY_CONSENT");
  });

  it("resolves consent rows and stale hours config", () => {
    expect(resolveConsentStateFromRows([])).toBe("NOT_GRANTED");
    expect(resolveConsentStateFromRows([{ status: "REVOKED" }])).toBe("REVOKED");
    expect(resolveConsentStateFromRows([{ status: "GRANTED" }])).toBe("GRANTED");
    expect(resolveActivityStaleHours(undefined)).toBe(48);
    expect(resolveActivityStaleHours("1")).toBe(1);
    expect(resolveActivityStaleHours("48")).toBe(48);
    expect(resolveActivityStaleHours("720")).toBe(720);
    expect(() => resolveActivityStaleHours("")).toThrow(/ACTIVITY_SYNC_STALE_HOURS_INVALID/);
    expect(() => resolveActivityStaleHours("   ")).toThrow(/ACTIVITY_SYNC_STALE_HOURS_INVALID/);
    expect(() => resolveActivityStaleHours("0")).toThrow(/ACTIVITY_SYNC_STALE_HOURS_INVALID/);
    expect(() => resolveActivityStaleHours("-1")).toThrow(/ACTIVITY_SYNC_STALE_HOURS_INVALID/);
    expect(() => resolveActivityStaleHours("721")).toThrow(/ACTIVITY_SYNC_STALE_HOURS_INVALID/);
    expect(() => resolveActivityStaleHours("1.5")).toThrow(/ACTIVITY_SYNC_STALE_HOURS_INVALID/);
    expect(() => resolveActivityStaleHours("NaN")).toThrow(/ACTIVITY_SYNC_STALE_HOURS_INVALID/);
    expect(() => resolveActivityStaleHours("nope")).toThrow(/ACTIVITY_SYNC_STALE_HOURS_INVALID/);
    expect(() => resolveActivityStaleHours("48x")).toThrow(/ACTIVITY_SYNC_STALE_HOURS_INVALID/);
  });
});
