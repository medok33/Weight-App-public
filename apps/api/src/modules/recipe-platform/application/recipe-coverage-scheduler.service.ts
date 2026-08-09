import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { RecipeCoverageAnalyzer } from './recipe-coverage-analyzer.service';
import { COVERAGE_MATRIX_VERSION_V1 } from '../domain/recipe-coverage.policy';

/**
 * In-process coverage tick (dirty debounce + daily FULL safety).
 * Complements worker poll — no external cron platform.
 */
@Injectable()
export class RecipeCoverageScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(RecipeCoverageScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @Optional() @Inject(RecipeCoverageAnalyzer) private readonly analyzer?: RecipeCoverageAnalyzer,
  ) {}

  onModuleInit() {
    if (process.env.COVERAGE_ANALYZER_SCHEDULER === '0') return;
    const ms = Number(process.env.COVERAGE_ANALYZER_POLL_MS ?? 60_000);
    this.timer = setInterval(() => void this.tick(), ms);
    this.log.log(`Coverage analyzer scheduler registered (poll=${ms}ms)`);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick() {
    if (!this.analyzer || this.running) return;
    this.running = true;
    try {
      try {
        await this.analyzer.processDirtyQueue(COVERAGE_MATRIX_VERSION_V1);
      } catch (error) {
        if ((error as Error).message !== 'COVERAGE_ANALYSIS_ALREADY_RUNNING') {
          this.log.warn(`dirty queue: ${(error as Error).message}`);
        }
      }
      try {
        await this.analyzer.maybeScheduledFull(COVERAGE_MATRIX_VERSION_V1);
      } catch (error) {
        if ((error as Error).message !== 'COVERAGE_ANALYSIS_ALREADY_RUNNING') {
          this.log.warn(`scheduled full: ${(error as Error).message}`);
        }
      }
    } finally {
      this.running = false;
    }
  }
}
