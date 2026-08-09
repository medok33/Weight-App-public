# ADR-189: defer scale changes with thresholds

Decision: `DEFER_WITH_THRESHOLDS`.

The current web/API/worker/Postgres architecture is sufficient for the locally evidenced workload. Do not add Redis cache capacity, queues, or microservices solely for this review.

Revisit the decision when sustained p95 API latency exceeds 500 ms, worker queue age exceeds 60 seconds, Postgres CPU exceeds 70% for 15 minutes, or job failure rate exceeds 1% over 15 minutes. Measure these through existing observability before a targeted change.
