import { Body, Controller, Get, Inject, NotFoundException, Post, Put } from '@nestjs/common';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { RequestUser } from '../../auth/domain/request-user.types';
import { ShoppingListService } from '../application/shopping-list.service';

@Controller('shopping-list')
export class ShoppingListController {
  constructor(@Inject(ShoppingListService) private readonly service: ShoppingListService) {}

  @Get()
  async get(@CurrentUser() user: RequestUser) {
    try {
      const list = await this.service.getLatest(user.id);
      if (!list) throw new NotFoundException('SHOPPING_LIST_NOT_FOUND');
      return list;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new NotFoundException('SHOPPING_LIST_NOT_FOUND');
    }
  }

  @Get('budget')
  async budget(@CurrentUser() user: RequestUser) {
    try {
      return await this.service.getBudget(user.id);
    } catch {
      throw new NotFoundException('SHOPPING_BUDGET_NOT_FOUND');
    }
  }

  @Post('generate')
  async generate(@CurrentUser() user: RequestUser) {
    try {
      return await this.service.generateFromMealPlan(user.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'SHOPPING_GENERATE_FAILED';
      throw new NotFoundException(message);
    }
  }

  @Put('items/purchase')
  async purchase(
    @CurrentUser() user: RequestUser,
    @Body() body: { itemId?: string; purchased?: boolean },
  ) {
    if (!body.itemId || body.purchased == null) throw new NotFoundException('SHOPPING_PURCHASE_INVALID');
    try {
      return await this.service.setPurchased(user.id, body.itemId, Boolean(body.purchased));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'SHOPPING_PURCHASE_FAILED';
      throw new NotFoundException(message);
    }
  }
}
