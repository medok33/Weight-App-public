import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { Roles } from "../../auth/decorators/roles.decorator";
import { OwnerMfaGuard } from "../../auth/guards/owner-mfa.guard";
import { RolesGuard } from "../../auth/guards/roles.guard";
import type { RequestUser } from "../../auth/domain/request-user.types";
import { ExerciseMediaService } from "../application/exercise-media.service";
import {
  isExerciseMediaFoundationRole,
  type RegisterExerciseMediaInput,
} from "../domain/exercise-media.types";

@Controller("admin/workout-catalog")
@UseGuards(RolesGuard, OwnerMfaGuard)
@Roles("OWNER", "ADMIN")
export class WorkoutCatalogAdminController {
  constructor(@Inject(ExerciseMediaService) private readonly media: ExerciseMediaService) {}

  private mapError(error: unknown): never {
    const message = error instanceof Error ? error.message : "EXERCISE_MEDIA_ERROR";
    if (message === "OWNER_ACCESS_FORBIDDEN") throw new UnauthorizedException(message);
    if (
      message === "EXERCISE_REVISION_NOT_FOUND" ||
      message === "EXERCISE_MEDIA_NOT_FOUND"
    ) {
      throw new NotFoundException(message);
    }
    if (message === "EXERCISE_MEDIA_APPROVED_ROLE_EXISTS") {
      throw new ConflictException(message);
    }
    if (message.startsWith("EXERCISE_MEDIA_")) {
      throw new BadRequestException(message);
    }
    throw error;
  }

  @Get("revisions/:revisionId/media")
  async listMedia(
    @CurrentUser() _user: RequestUser,
    @Param("revisionId") revisionId: string,
  ) {
    try {
      return { media: await this.media.listForRevisionAdmin(revisionId) };
    } catch (error) {
      this.mapError(error);
    }
  }

  @Post("revisions/:revisionId/media")
  async registerMedia(
    @CurrentUser() _user: RequestUser,
    @Param("revisionId") revisionId: string,
    @Body() body: Record<string, unknown>,
  ) {
    try {
      const role = String(body.role ?? "");
      if (!isExerciseMediaFoundationRole(role)) {
        throw new Error("EXERCISE_MEDIA_ROLE_INVALID");
      }
      const input: RegisterExerciseMediaInput = {
        role,
        storageKey: String(body.storageKey ?? ""),
        mimeType: String(body.mimeType ?? ""),
        width: Number(body.width),
        height: Number(body.height),
        checksum: String(body.checksum ?? ""),
        provider: body.provider == null ? undefined : String(body.provider),
        model: body.model == null ? undefined : String(body.model),
        promptVersion: body.promptVersion == null ? undefined : String(body.promptVersion),
        promptHash: body.promptHash == null ? undefined : String(body.promptHash),
        characterProfileKey:
          body.characterProfileKey == null ? undefined : String(body.characterProfileKey),
        visualStyleKey: body.visualStyleKey == null ? undefined : String(body.visualStyleKey),
        outfitProfileKey: body.outfitProfileKey == null ? undefined : String(body.outfitProfileKey),
        backgroundProfileKey:
          body.backgroundProfileKey == null ? undefined : String(body.backgroundProfileKey),
        altText: body.altText == null ? undefined : String(body.altText),
      };
      return await this.media.registerMetadata(revisionId, input);
    } catch (error) {
      this.mapError(error);
    }
  }

  @Patch("revisions/:revisionId/media/:mediaId/approve")
  async approveMedia(
    @CurrentUser() _user: RequestUser,
    @Param("revisionId") revisionId: string,
    @Param("mediaId") mediaId: string,
  ) {
    try {
      return await this.media.approve(revisionId, mediaId);
    } catch (error) {
      this.mapError(error);
    }
  }

  @Patch("revisions/:revisionId/media/:mediaId/retire")
  async retireMedia(
    @CurrentUser() _user: RequestUser,
    @Param("revisionId") revisionId: string,
    @Param("mediaId") mediaId: string,
  ) {
    try {
      return await this.media.retire(revisionId, mediaId);
    } catch (error) {
      this.mapError(error);
    }
  }
}
