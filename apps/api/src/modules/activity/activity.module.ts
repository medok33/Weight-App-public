import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../infrastructure/database/database.module";
import {
  ActivityService,
  ACTIVITY_CLOCK,
  ACTIVITY_RATE_LIMIT,
} from "./application/activity.service";
import { ActivityController } from "./controllers/activity.controller";
import {
  DEFAULT_ACTIVITY_SYNC_RATE_LIMIT,
  SYSTEM_ACTIVITY_CLOCK,
} from "./domain/activity.types";

@Module({
  imports: [DatabaseModule],
  controllers: [ActivityController],
  providers: [
    ActivityService,
    { provide: ACTIVITY_CLOCK, useValue: SYSTEM_ACTIVITY_CLOCK },
    { provide: ACTIVITY_RATE_LIMIT, useValue: DEFAULT_ACTIVITY_SYNC_RATE_LIMIT },
  ],
  exports: [ActivityService],
})
export class ActivityModule {}
