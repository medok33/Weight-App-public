import { BadRequestException, HttpException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { WorkoutEngineController, mapWorkoutError } from "../controllers/workout-engine.controller";

describe("workout engine HTTP catalog error mapping", () => {
  it("maps WORKOUT_CATALOG_RELEASE_MISSING to 400 with exact code", () => {
    const error = mapWorkoutError(new Error("WORKOUT_CATALOG_RELEASE_MISSING"));
    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as HttpException).getStatus()).toBe(400);
    expect((error as HttpException).getResponse()).toEqual({
      message: "WORKOUT_CATALOG_RELEASE_MISSING",
      statusCode: 400,
      error: "Bad Request",
    });
  });

  it("maps WORKOUT_CATALOG_RELEASE_EMPTY to 400 with exact code", () => {
    const error = mapWorkoutError(new Error("WORKOUT_CATALOG_RELEASE_EMPTY"));
    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as HttpException).getStatus()).toBe(400);
    expect((error as HttpException).getResponse()).toEqual({
      message: "WORKOUT_CATALOG_RELEASE_EMPTY",
      statusCode: 400,
      error: "Bad Request",
    });
  });

  it("generate endpoint preserves RELEASE_MISSING code (not GENERATE_FAILED)", async () => {
    const controller = new WorkoutEngineController(
      {
        generatePlan: async () => {
          throw new Error("WORKOUT_CATALOG_RELEASE_MISSING");
        },
      } as never,
      {} as never,
      {} as never,
    );
    const caught = await controller
      .generate({ id: "user-1" } as never, {})
      .catch((error: HttpException) => error);
    expect(caught.getStatus()).toBe(400);
    const body = caught.getResponse() as { message?: string };
    expect(body.message).toBe("WORKOUT_CATALOG_RELEASE_MISSING");
    expect(JSON.stringify(body)).not.toMatch(/WORKOUT_PLAN_GENERATE_FAILED/);
  });

  it("generate endpoint preserves RELEASE_EMPTY code (not GENERATE_FAILED)", async () => {
    const controller = new WorkoutEngineController(
      {
        generatePlan: async () => {
          throw new Error("WORKOUT_CATALOG_RELEASE_EMPTY");
        },
      } as never,
      {} as never,
      {} as never,
    );
    const caught = await controller
      .generate({ id: "user-1" } as never, {})
      .catch((error: HttpException) => error);
    expect(caught.getStatus()).toBe(400);
    const body = caught.getResponse() as { message?: string };
    expect(body.message).toBe("WORKOUT_CATALOG_RELEASE_EMPTY");
  });
});
