import {
  BadRequestException,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Post,
  Body,
  UnauthorizedException,
} from "@nestjs/common";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import type { RequestUser } from "../../auth/domain/request-user.types";
import { ActivityService } from "../application/activity.service";

@Controller("activity")
export class ActivityController {
  constructor(@Inject(ActivityService) private readonly activity: ActivityService) {}

  @Get("today")
  async today(@CurrentUser() user: RequestUser) {
    return this.activity.getToday(user.id);
  }

  @Get("connections")
  async connections(@CurrentUser() user: RequestUser) {
    return this.activity.listConnections(user.id);
  }

  @Post("connections/:source/connect")
  async connect(@CurrentUser() user: RequestUser, @Param("source") source: string) {
    try {
      return await this.activity.connectProvider(user.id, source);
    } catch (error) {
      this.mapError(error);
    }
  }

  @Post("connections/:source/disconnect")
  async disconnect(@CurrentUser() user: RequestUser, @Param("source") source: string) {
    try {
      return await this.activity.disconnectProvider(user.id, source);
    } catch (error) {
      this.mapError(error);
    }
  }

  @Post("sync/steps")
  async syncSteps(
    @CurrentUser() user: RequestUser,
    @Body() body: Record<string, unknown>,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    try {
      const payload = { ...body };
      if (!payload.operationId && idempotencyKey) {
        payload.operationId = idempotencyKey;
      }
      return await this.activity.syncSteps(user.id, payload);
    } catch (error) {
      this.mapError(error);
    }
  }

  private mapError(error: unknown): never {
    const message = error instanceof Error ? error.message : "ACTIVITY_ERROR";
    const current = (error as { current?: unknown })?.current;

    if (message === "OWNER_ACCESS_FORBIDDEN") throw new UnauthorizedException(message);
    if (message === "HEALTH_CONSENT_REQUIRED") throw new ForbiddenException(message);

    if (message === "ACTIVITY_CONNECTION_DISCONNECTED") {
      throw new ForbiddenException({
        code: "ACTIVITY_CONNECTION_DISCONNECTED",
        message: "Activity provider connection is disconnected.",
      });
    }

    if (message === "ACTIVITY_SYNC_RATE_LIMITED") {
      throw new HttpException(
        {
          code: "ACTIVITY_SYNC_RATE_LIMITED",
          message: "Activity sync rate limit exceeded.",
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (
      message === "ACTIVITY_SEQUENCE_STALE" ||
      message === "ACTIVITY_OPERATION_PAYLOAD_CONFLICT"
    ) {
      throw new ConflictException({
        code: message,
        ...(current ? { current } : {}),
      });
    }

    if (message.startsWith("ACTIVITY_") || message === "WORKOUT_TIMEZONE_INVALID") {
      throw new BadRequestException({ code: message });
    }
    throw error;
  }
}
