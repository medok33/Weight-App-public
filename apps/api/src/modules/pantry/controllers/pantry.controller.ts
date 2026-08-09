import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { RequestUser } from '../../auth/domain/request-user.types';
import { PantryService } from '../application/pantry.service';

@Controller('pantry')
export class PantryController {
  constructor(@Inject(PantryService) private readonly service: PantryService) {}

  @Get()
  async inventory(@CurrentUser() user: RequestUser) {
    try {
      return await this.service.inventory(user.id);
    } catch (error) {
      throw this.mapError(error);
    }
  }

  @Post('items')
  async upsert(
    @CurrentUser() user: RequestUser,
    @Body() body: { name?: string; quantity?: number; unit?: string; expiresOn?: string | null },
  ) {
    try {
      return await this.service.upsertItem(user.id, body);
    } catch (error) {
      throw this.mapError(error);
    }
  }

  @Post('meal-weighting')
  async mealWeighting(
    @CurrentUser() user: RequestUser,
    @Body()
    body: {
      candidates?: Array<{ id: string; name: string; calories: number; proteinG?: number; tags?: string[] }>;
      excludedTags?: string[];
      mealNames?: string[];
    },
  ) {
    try {
      const candidates = body.candidates ?? [];
      return {
        candidates: await this.service.weightCandidates(user.id, candidates, body.excludedTags ?? []),
        explanation: await this.service.explainPlanIngredients(user.id, body.mealNames ?? candidates.map((candidate) => candidate.name)),
      };
    } catch (error) {
      throw this.mapError(error);
    }
  }

  @Delete('items/:id')
  async remove(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    try {
      return await this.service.removeItem(user.id, id);
    } catch (error) {
      throw this.mapError(error);
    }
  }

  private mapError(error: unknown): Error {
    const message = error instanceof Error ? error.message : 'PANTRY_FAILED';
    if (message === 'PANTRY_FORBIDDEN') return new ForbiddenException(message);
    if (message === 'PANTRY_ITEM_NOT_FOUND') return new NotFoundException(message);
    return new BadRequestException(message);
  }
}
