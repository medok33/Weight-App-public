import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Inject,
  Param,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { RequestUser } from '../../auth/domain/request-user.types';
import { FamilyModeService } from '../application/family-mode.service';
import type { SharedDishInput } from '../domain/family-meals.policy';

@Controller('family-mode')
export class FamilyModeController {
  constructor(@Inject(FamilyModeService) private readonly service: FamilyModeService) {}

  @Post()
  create(@CurrentUser() user: RequestUser, @Body() body: { name?: string }) {
    return this.run(() => this.service.createFamily(user.id, body.name ?? ''));
  }

  @Get()
  mine(@CurrentUser() user: RequestUser) {
    return this.service.getMyFamily(user.id);
  }

  /** Static path must be registered before `:familyId` routes to avoid IDOR/param capture. */
  @Post('invitations/accept')
  accept(@CurrentUser() user: RequestUser, @Body() body: { token?: string }) {
    return this.run(() => this.service.acceptInvitation(user.id, body.token ?? ''));
  }

  @Get(':familyId/members')
  members(@CurrentUser() user: RequestUser, @Param('familyId') familyId: string) {
    return this.run(() => this.service.listMembers(user.id, familyId));
  }

  @Post(':familyId/invitations')
  invite(
    @CurrentUser() user: RequestUser,
    @Param('familyId') familyId: string,
    @Body() body: { emailOrUsername?: string },
  ) {
    return this.run(() => this.service.invite(user.id, familyId, body.emailOrUsername));
  }

  @Post(':familyId/invitations/:invitationId/revoke')
  revoke(
    @CurrentUser() user: RequestUser,
    @Param('familyId') familyId: string,
    @Param('invitationId') invitationId: string,
  ) {
    return this.run(() => this.service.revokeInvitation(user.id, familyId, invitationId));
  }

  @Delete(':familyId/members/:memberUserId')
  remove(
    @CurrentUser() user: RequestUser,
    @Param('familyId') familyId: string,
    @Param('memberUserId') memberUserId: string,
  ) {
    return this.run(() => this.service.removeMember(user.id, familyId, memberUserId));
  }

  @Post(':familyId/leave')
  leave(@CurrentUser() user: RequestUser, @Param('familyId') familyId: string) {
    return this.run(() => this.service.leaveFamily(user.id, familyId));
  }

  @Post(':familyId/health-share')
  consent(
    @CurrentUser() user: RequestUser,
    @Param('familyId') familyId: string,
    @Body() body: { granted?: boolean },
  ) {
    return this.run(() => this.service.setHealthShareConsent(user.id, familyId, body.granted === true));
  }

  @Post(':familyId/shared-dishes/plan')
  planSharedDish(@CurrentUser() user: RequestUser, @Param('familyId') familyId: string, @Body() body: SharedDishInput) {
    return this.run(() => this.service.planSharedDish(user.id, familyId, body));
  }

  @Post(':familyId/shopping-list/regenerate')
  regenerateShopping(
    @CurrentUser() user: RequestUser,
    @Param('familyId') familyId: string,
    @Body()
    body: {
      meals?: Array<{ dishName: string; servings: number; ingredients: SharedDishInput['ingredients'] }>;
      pantry?: Array<{ productKey?: string; name: string; unit: string; quantity: number; expiresOn?: string | null }>;
    },
  ) {
    return this.run(() =>
      this.service.regenerateFamilyShoppingList(user.id, familyId, body.meals ?? [], body.pantry ?? []),
    );
  }

  @Get(':familyId/shopping-list')
  shoppingList(@CurrentUser() user: RequestUser, @Param('familyId') familyId: string) {
    return this.run(() => this.service.getFamilyShoppingList(user.id, familyId));
  }

  @Post(':familyId/shopping-list/items/:itemId/purchased')
  markPurchased(
    @CurrentUser() user: RequestUser,
    @Param('familyId') familyId: string,
    @Param('itemId') itemId: string,
    @Body() body: { purchased?: boolean; version?: number },
  ) {
    return this.run(() =>
      this.service.markFamilyShoppingPurchased(
        user.id,
        familyId,
        itemId,
        body.purchased === true,
        Number(body.version ?? 0),
      ),
    );
  }

  private async run<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'FAMILY_FAILED';
      if (message === 'FAMILY_FORBIDDEN') throw new ForbiddenException(message);
      throw new BadRequestException(message);
    }
  }
}
