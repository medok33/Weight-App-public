import { BadRequestException, ForbiddenException, HttpException, HttpStatus } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { ActivityController } from "../controllers/activity.controller";

describe("ActivityController error mapping", () => {
  it("maps rate limit to HTTP 429 without leaking payload identity", async () => {
    const controller = new ActivityController({
      syncSteps: async () => {
        throw new Error("ACTIVITY_SYNC_RATE_LIMITED");
      },
    } as never);

    const error = await controller
      .syncSteps({ id: "user-1" } as never, { steps: 9999, clientInstanceId: "secret-client" }, undefined)
      .catch((caught: HttpException) => caught);

    expect(error).toBeInstanceOf(HttpException);
    expect(error.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    const body = JSON.stringify(error.getResponse());
    expect(body).toContain("ACTIVITY_SYNC_RATE_LIMITED");
    expect(body).not.toMatch(/9999|secret-client|steps/i);
  });

  it("maps forbidden fields to 400 structured code without payload leak", async () => {
    const controller = new ActivityController({
      syncSteps: async () => {
        throw new Error("ACTIVITY_SYNC_FIELD_FORBIDDEN");
      },
    } as never);

    const error = await controller
      .syncSteps({ id: "user-1" } as never, { distanceKm: 3, clientInstanceId: "cli" }, undefined)
      .catch((caught: BadRequestException) => caught);

    expect(error.getStatus()).toBe(400);
    const body = JSON.stringify(error.getResponse());
    expect(body).toContain("ACTIVITY_SYNC_FIELD_FORBIDDEN");
    expect(body).not.toMatch(/distanceKm|cli/);
  });

  it("maps disconnected connection to HTTP 403 without leaking client identity", async () => {
    const controller = new ActivityController({
      syncSteps: async () => {
        throw new Error("ACTIVITY_CONNECTION_DISCONNECTED");
      },
    } as never);

    const error = await controller
      .syncSteps({ id: "user-1" } as never, { clientInstanceId: "secret-client-xyz" }, undefined)
      .catch((caught: ForbiddenException) => caught);

    expect(error).toBeInstanceOf(ForbiddenException);
    expect(error.getStatus()).toBe(403);
    const body = JSON.stringify(error.getResponse());
    expect(body).toContain("ACTIVITY_CONNECTION_DISCONNECTED");
    expect(body).not.toMatch(/secret-client/);
  });
});
