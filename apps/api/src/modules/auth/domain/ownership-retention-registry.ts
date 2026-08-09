export type OwnershipClass =
  | 'DIRECT_USER_OWNED'
  | 'TRANSITIVE_USER_OWNED'
  | 'GLOBAL_SHARED'
  | 'SECURITY_AUDIT'
  | 'DERIVED_EPHEMERAL';

export type RetentionClass =
  | 'USER_PERSONAL_PURGE'
  | 'USER_PERSONAL_ANONYMIZE'
  | 'SECURITY_AUDIT_MINIMAL'
  | 'GLOBAL_NON_USER_DATA'
  | 'DERIVED_EPHEMERAL';

export type RegistryEntry = {
  ownership: OwnershipClass;
  retention: RetentionClass;
  exportable: boolean;
  deletion: 'PURGE' | 'ANONYMIZE' | 'MINIMAL_RETAIN' | 'PRESERVE_GLOBAL' | 'DROP_DERIVED';
  reason: string;
};

export const FINANCIAL_RETENTION_DURATION = 'FUTURE_POLICY_REQUIRED' as const;

export const OWNERSHIP_RETENTION_REGISTRY = {
  User: e('DIRECT_USER_OWNED', 'USER_PERSONAL_ANONYMIZE', true, 'ANONYMIZE', 'Account tombstone releases email/username and blocks auth.'),
  AuthIdentity: e('DIRECT_USER_OWNED', 'USER_PERSONAL_PURGE', true, 'PURGE', 'Reusable login credential and provider subject must be removed.'),
  BetaInvite: e('SECURITY_AUDIT', 'SECURITY_AUDIT_MINIMAL', false, 'MINIMAL_RETAIN', 'Invite lifecycle may survive, while creator/target identity is detached.'),
  PasswordRecoveryToken: e('DIRECT_USER_OWNED', 'USER_PERSONAL_PURGE', false, 'PURGE', 'Recovery token is credential-like and must not survive deletion.'),
  UserSubscription: e('DIRECT_USER_OWNED', 'USER_PERSONAL_PURGE', true, 'PURGE', 'Subscription entitlement state is user-owned outside retained financial records.'),
  AnonymousMigration: e('DIRECT_USER_OWNED', 'USER_PERSONAL_PURGE', true, 'PURGE', 'Migration link identifies a user account.'),
  Session: e('DIRECT_USER_OWNED', 'USER_PERSONAL_PURGE', true, 'PURGE', 'Durable session tokens are user-owned auth state.'),
  AccountDeletionRequest: e('SECURITY_AUDIT', 'SECURITY_AUDIT_MINIMAL', false, 'MINIMAL_RETAIN', 'Minimal deletion lifecycle/idempotency evidence retained with the anonymized account tombstone.'),
  OwnerMfaCredential: e('DIRECT_USER_OWNED', 'USER_PERSONAL_PURGE', false, 'PURGE', 'MFA secret material must not survive deletion.'),
  OwnerMfaEnrollmentDraft: e('DIRECT_USER_OWNED', 'USER_PERSONAL_PURGE', false, 'PURGE', 'MFA draft secret material must not survive deletion.'),
  OwnerMfaRecoveryCode: e('DIRECT_USER_OWNED', 'USER_PERSONAL_PURGE', false, 'PURGE', 'MFA recovery codes are credential material.'),
  MfaPreAuthChallenge: e('DIRECT_USER_OWNED', 'USER_PERSONAL_PURGE', false, 'PURGE', 'MFA challenge is auth state.'),
  OwnerMfaReplayState: e('DIRECT_USER_OWNED', 'USER_PERSONAL_PURGE', false, 'PURGE', 'Replay guard is auth state linked to credential lifecycle.'),
  UserProfile: e('DIRECT_USER_OWNED', 'USER_PERSONAL_PURGE', true, 'PURGE', 'Personal profile data.'),
  UserGoal: e('DIRECT_USER_OWNED', 'USER_PERSONAL_PURGE', true, 'PURGE', 'Personal health goal.'),
  PolicyVersion: e('GLOBAL_SHARED', 'GLOBAL_NON_USER_DATA', false, 'PRESERVE_GLOBAL', 'Global policy/catalog version.'),
  AIConversation: e('DIRECT_USER_OWNED', 'USER_PERSONAL_PURGE', true, 'PURGE', 'Personal assistant conversation.'),
  AIMessage: e('TRANSITIVE_USER_OWNED', 'USER_PERSONAL_PURGE', true, 'PURGE', 'Message belongs to user conversation.'),
  AIMessageFeedback: e('DIRECT_USER_OWNED', 'USER_PERSONAL_PURGE', true, 'PURGE', 'Personal feedback tied to user.'),
  AIUsageLog: e('DIRECT_USER_OWNED', 'USER_PERSONAL_PURGE', true, 'PURGE', 'Per-user usage ledger.'),
  Role: e('GLOBAL_SHARED', 'GLOBAL_NON_USER_DATA', false, 'PRESERVE_GLOBAL', 'Global authorization role.'),
  Permission: e('GLOBAL_SHARED', 'GLOBAL_NON_USER_DATA', false, 'PRESERVE_GLOBAL', 'Global authorization permission.'),
  OwnerAuditEvent: e('SECURITY_AUDIT', 'SECURITY_AUDIT_MINIMAL', false, 'MINIMAL_RETAIN', 'Minimal owner/security audit evidence.'),
  AuditEvent: e('SECURITY_AUDIT', 'SECURITY_AUDIT_MINIMAL', false, 'MINIMAL_RETAIN', 'Minimal security/audit evidence.'),
  AuthThrottleBucket: e('SECURITY_AUDIT', 'SECURITY_AUDIT_MINIMAL', false, 'MINIMAL_RETAIN', 'Hashed abuse throttle evidence.'),
  AuthAccountLockout: e('SECURITY_AUDIT', 'SECURITY_AUDIT_MINIMAL', false, 'MINIMAL_RETAIN', 'Hashed account abuse lockout evidence.'),
  AuditLog: e('SECURITY_AUDIT', 'SECURITY_AUDIT_MINIMAL', false, 'MINIMAL_RETAIN', 'Owner audit log with minimal retention.'),
  ProductOffer: e('GLOBAL_SHARED', 'GLOBAL_NON_USER_DATA', false, 'PRESERVE_GLOBAL', 'Global payment offer/catalog record.'),
  AIControl: e('GLOBAL_SHARED', 'GLOBAL_NON_USER_DATA', false, 'PRESERVE_GLOBAL', 'Global AI control flag.'),
  FeatureFlag: e('GLOBAL_SHARED', 'GLOBAL_NON_USER_DATA', false, 'PRESERVE_GLOBAL', 'Global feature flag.'),
  Payment: e('DIRECT_USER_OWNED', 'USER_PERSONAL_ANONYMIZE', true, 'ANONYMIZE', `Financial reconciliation record; retention duration ${FINANCIAL_RETENTION_DURATION}.`),
  Entitlement: e('DIRECT_USER_OWNED', 'USER_PERSONAL_ANONYMIZE', true, 'ANONYMIZE', 'Active entitlement must be revoked before historical record can be detached.'),
  PaymentEvent: e('TRANSITIVE_USER_OWNED', 'USER_PERSONAL_ANONYMIZE', true, 'ANONYMIZE', 'Payment event retained only as part of anonymized financial record.'),
  Refund: e('TRANSITIVE_USER_OWNED', 'USER_PERSONAL_ANONYMIZE', true, 'ANONYMIZE', `Refund reconciliation record; retention duration ${FINANCIAL_RETENTION_DURATION}.`),
  ExportJob: e('DIRECT_USER_OWNED', 'USER_PERSONAL_PURGE', true, 'PURGE', 'Export payload/result is personal data.'),
  ShareLink: e('DIRECT_USER_OWNED', 'USER_PERSONAL_PURGE', false, 'PURGE', 'Export share token is user-owned access state.'),
  EligibilityAssessment: e('DIRECT_USER_OWNED', 'USER_PERSONAL_PURGE', true, 'PURGE', 'Personal eligibility answers/outcome.'),
  Product: e('GLOBAL_SHARED', 'GLOBAL_NON_USER_DATA', false, 'PRESERVE_GLOBAL', 'Global product catalog.'),
  ProductReviewDecision: e('GLOBAL_SHARED', 'GLOBAL_NON_USER_DATA', false, 'PRESERVE_GLOBAL', 'Global content review decision.'),
  CulinaryRole: e('GLOBAL_SHARED', 'GLOBAL_NON_USER_DATA', false, 'PRESERVE_GLOBAL', 'Global recipe taxonomy.'),
  ProductCulinaryRole: e('GLOBAL_SHARED', 'GLOBAL_NON_USER_DATA', false, 'PRESERVE_GLOBAL', 'Global product taxonomy link.'),
  CookingMethod: e('GLOBAL_SHARED', 'GLOBAL_NON_USER_DATA', false, 'PRESERVE_GLOBAL', 'Global cooking taxonomy.'),
  ProductSubstitution: e('GLOBAL_SHARED', 'GLOBAL_NON_USER_DATA', false, 'PRESERVE_GLOBAL', 'Global product substitution catalog.'),
  RetailProduct: e('GLOBAL_SHARED', 'GLOBAL_NON_USER_DATA', false, 'PRESERVE_GLOBAL', 'Global retail product catalog.'),
  ProductCategory: e('GLOBAL_SHARED', 'GLOBAL_NON_USER_DATA', false, 'PRESERVE_GLOBAL', 'Global product category.'),
  ProductAlias: e('GLOBAL_SHARED', 'GLOBAL_NON_USER_DATA', false, 'PRESERVE_GLOBAL', 'Global product alias.'),
  ProductNutritionVersion: e('GLOBAL_SHARED', 'GLOBAL_NON_USER_DATA', false, 'PRESERVE_GLOBAL', 'Global nutrition version.'),
  Allergen: e('GLOBAL_SHARED', 'GLOBAL_NON_USER_DATA', false, 'PRESERVE_GLOBAL', 'Global allergen catalog.'),
  DietaryTag: e('GLOBAL_SHARED', 'GLOBAL_NON_USER_DATA', false, 'PRESERVE_GLOBAL', 'Global dietary tag catalog.'),
  ProductAllergen: e('GLOBAL_SHARED', 'GLOBAL_NON_USER_DATA', false, 'PRESERVE_GLOBAL', 'Global product allergen link.'),
  ProductDietaryTag: e('GLOBAL_SHARED', 'GLOBAL_NON_USER_DATA', false, 'PRESERVE_GLOBAL', 'Global product dietary link.'),
  Recipe: e('GLOBAL_SHARED', 'GLOBAL_NON_USER_DATA', false, 'PRESERVE_GLOBAL', 'Global recipe catalog.'),
  RecipeFamily: e('GLOBAL_SHARED', 'GLOBAL_NON_USER_DATA', false, 'PRESERVE_GLOBAL', 'Global recipe family.'),
  RecipeVersion: e('GLOBAL_SHARED', 'GLOBAL_NON_USER_DATA', false, 'PRESERVE_GLOBAL', 'Global recipe version.'),
  RecipeCoverageSlot: e('GLOBAL_SHARED', 'GLOBAL_NON_USER_DATA', false, 'PRESERVE_GLOBAL', 'Global recipe coverage slot.'),
  RecipeCoverageAssignment: e('GLOBAL_SHARED', 'GLOBAL_NON_USER_DATA', false, 'PRESERVE_GLOBAL', 'Global recipe coverage assignment.'),
  RecipeDuplicateCandidate: e('GLOBAL_SHARED', 'GLOBAL_NON_USER_DATA', false, 'PRESERVE_GLOBAL', 'Global duplicate candidate.'),
  MediaAsset: e('GLOBAL_SHARED', 'GLOBAL_NON_USER_DATA', false, 'PRESERVE_GLOBAL', 'Global media asset.'),
  RecipeVersionMedia: e('GLOBAL_SHARED', 'GLOBAL_NON_USER_DATA', false, 'PRESERVE_GLOBAL', 'Global recipe media link.'),
  RecipeVersionLifecycle: e('GLOBAL_SHARED', 'GLOBAL_NON_USER_DATA', false, 'PRESERVE_GLOBAL', 'Global recipe lifecycle.'),
  RecipeVersionLifecycleEvent: e('GLOBAL_SHARED', 'GLOBAL_NON_USER_DATA', false, 'PRESERVE_GLOBAL', 'Global recipe lifecycle event.'),
  RecipeProductDependency: e('GLOBAL_SHARED', 'GLOBAL_NON_USER_DATA', false, 'PRESERVE_GLOBAL', 'Global recipe dependency.'),
  RecipeRevalidationTask: e('GLOBAL_SHARED', 'GLOBAL_NON_USER_DATA', false, 'PRESERVE_GLOBAL', 'Global recipe revalidation task.'),
  RecipeStep: e('GLOBAL_SHARED', 'GLOBAL_NON_USER_DATA', false, 'PRESERVE_GLOBAL', 'Global recipe step.'),
  RecipeIngredient: e('GLOBAL_SHARED', 'GLOBAL_NON_USER_DATA', false, 'PRESERVE_GLOBAL', 'Global recipe ingredient.'),
  Exercise: e('GLOBAL_SHARED', 'GLOBAL_NON_USER_DATA', false, 'PRESERVE_GLOBAL', 'Global exercise catalog.'),
  WorkoutProfile: e('DIRECT_USER_OWNED', 'USER_PERSONAL_PURGE', true, 'PURGE', 'Personal workout profile.'),
  ExerciseMedia: e('GLOBAL_SHARED', 'GLOBAL_NON_USER_DATA', false, 'PRESERVE_GLOBAL', 'Global exercise media.'),
  ExerciseFamily: e('GLOBAL_SHARED', 'GLOBAL_NON_USER_DATA', false, 'PRESERVE_GLOBAL', 'Global exercise family.'),
  ExerciseRevision: e('GLOBAL_SHARED', 'GLOBAL_NON_USER_DATA', false, 'PRESERVE_GLOBAL', 'Global exercise revision.'),
  WorkoutCatalogMuscleCode: e('GLOBAL_SHARED', 'GLOBAL_NON_USER_DATA', false, 'PRESERVE_GLOBAL', 'Global workout taxonomy.'),
  WorkoutCatalogMovementPatternCode: e('GLOBAL_SHARED', 'GLOBAL_NON_USER_DATA', false, 'PRESERVE_GLOBAL', 'Global workout taxonomy.'),
  ExerciseRevisionTaxonomy: e('GLOBAL_SHARED', 'GLOBAL_NON_USER_DATA', false, 'PRESERVE_GLOBAL', 'Global exercise taxonomy link.'),
  ExerciseRevisionMuscleInvolvement: e('GLOBAL_SHARED', 'GLOBAL_NON_USER_DATA', false, 'PRESERVE_GLOBAL', 'Global muscle involvement.'),
  WorkoutCatalogEquipmentCode: e('GLOBAL_SHARED', 'GLOBAL_NON_USER_DATA', false, 'PRESERVE_GLOBAL', 'Global equipment taxonomy.'),
  ExerciseRevisionEquipmentGroup: e('GLOBAL_SHARED', 'GLOBAL_NON_USER_DATA', false, 'PRESERVE_GLOBAL', 'Global equipment group.'),
  ExerciseRevisionEquipmentItem: e('GLOBAL_SHARED', 'GLOBAL_NON_USER_DATA', false, 'PRESERVE_GLOBAL', 'Global equipment item.'),
  ExerciseRevisionReadiness: e('GLOBAL_SHARED', 'GLOBAL_NON_USER_DATA', false, 'PRESERVE_GLOBAL', 'Global exercise readiness.'),
  ExerciseEnergyProfile: e('GLOBAL_SHARED', 'GLOBAL_NON_USER_DATA', false, 'PRESERVE_GLOBAL', 'Global exercise energy profile.'),
  ExerciseEnergyTimingProfile: e('GLOBAL_SHARED', 'GLOBAL_NON_USER_DATA', false, 'PRESERVE_GLOBAL', 'Global exercise energy timing.'),
  ExerciseSafetyProfile: e('GLOBAL_SHARED', 'GLOBAL_NON_USER_DATA', false, 'PRESERVE_GLOBAL', 'Global exercise safety profile.'),
  ExerciseCatalogSource: e('GLOBAL_SHARED', 'GLOBAL_NON_USER_DATA', false, 'PRESERVE_GLOBAL', 'Global exercise source.'),
  ExerciseSourceReference: e('GLOBAL_SHARED', 'GLOBAL_NON_USER_DATA', false, 'PRESERVE_GLOBAL', 'Global exercise source reference.'),
  ExerciseVariantRelation: e('GLOBAL_SHARED', 'GLOBAL_NON_USER_DATA', false, 'PRESERVE_GLOBAL', 'Global exercise variant relation.'),
  WorkoutCatalogRelease: e('GLOBAL_SHARED', 'GLOBAL_NON_USER_DATA', false, 'PRESERVE_GLOBAL', 'Global workout catalog release.'),
  WorkoutCatalogReleaseItem: e('GLOBAL_SHARED', 'GLOBAL_NON_USER_DATA', false, 'PRESERVE_GLOBAL', 'Global workout release item.'),
  WorkoutTemplate: e('GLOBAL_SHARED', 'GLOBAL_NON_USER_DATA', false, 'PRESERVE_GLOBAL', 'Global workout template.'),
  WorkoutPlan: e('DIRECT_USER_OWNED', 'USER_PERSONAL_PURGE', true, 'PURGE', 'Personal workout plan.'),
  WorkoutPlanDay: e('TRANSITIVE_USER_OWNED', 'USER_PERSONAL_PURGE', true, 'PURGE', 'Workout plan day belongs to user workout plan.'),
  WorkoutSession: e('DIRECT_USER_OWNED', 'USER_PERSONAL_PURGE', true, 'PURGE', 'Personal workout session.'),
  WorkoutSessionExercise: e('TRANSITIVE_USER_OWNED', 'USER_PERSONAL_PURGE', true, 'PURGE', 'Workout exercise belongs to user workout session.'),
  WorkoutAdaptation: e('DIRECT_USER_OWNED', 'USER_PERSONAL_PURGE', true, 'PURGE', 'Personal workout adaptation.'),
  WorkoutAdaptationCommand: e('DIRECT_USER_OWNED', 'USER_PERSONAL_PURGE', true, 'PURGE', 'Personal workout adaptation command.'),
  WorkoutSessionSet: e('TRANSITIVE_USER_OWNED', 'USER_PERSONAL_PURGE', true, 'PURGE', 'Set belongs to personal workout session.'),
  WorkoutPlanDayOverride: e('DIRECT_USER_OWNED', 'USER_PERSONAL_PURGE', true, 'PURGE', 'Personal workout plan override.'),
  Plan: e('DIRECT_USER_OWNED', 'USER_PERSONAL_PURGE', true, 'PURGE', 'Personal meal plan.'),
  PlanRevision: e('DIRECT_USER_OWNED', 'USER_PERSONAL_PURGE', true, 'PURGE', 'Personal meal plan revision.'),
  PlanDay: e('TRANSITIVE_USER_OWNED', 'USER_PERSONAL_PURGE', true, 'PURGE', 'Plan day belongs to user meal plan.'),
  Meal: e('TRANSITIVE_USER_OWNED', 'USER_PERSONAL_PURGE', true, 'PURGE', 'Meal belongs to user meal plan.'),
  MealItem: e('TRANSITIVE_USER_OWNED', 'USER_PERSONAL_PURGE', true, 'PURGE', 'Meal item belongs to user meal.'),
  MealCompletion: e('DIRECT_USER_OWNED', 'USER_PERSONAL_PURGE', true, 'PURGE', 'Personal meal completion.'),
  ProgressEntry: e('DIRECT_USER_OWNED', 'USER_PERSONAL_PURGE', true, 'PURGE', 'Personal progress entry.'),
  ShoppingList: e('DIRECT_USER_OWNED', 'USER_PERSONAL_PURGE', true, 'PURGE', 'Private shopping list.'),
  ShoppingItem: e('TRANSITIVE_USER_OWNED', 'USER_PERSONAL_PURGE', true, 'PURGE', 'Private shopping item.'),
  Retailer: e('GLOBAL_SHARED', 'GLOBAL_NON_USER_DATA', false, 'PRESERVE_GLOBAL', 'Global retailer catalog.'),
  Region: e('GLOBAL_SHARED', 'GLOBAL_NON_USER_DATA', false, 'PRESERVE_GLOBAL', 'Global region catalog.'),
  RetailStore: e('GLOBAL_SHARED', 'GLOBAL_NON_USER_DATA', false, 'PRESERVE_GLOBAL', 'Global retail store.'),
  ExternalProduct: e('GLOBAL_SHARED', 'GLOBAL_NON_USER_DATA', false, 'PRESERVE_GLOBAL', 'Global external product.'),
  ProductMatch: e('GLOBAL_SHARED', 'GLOBAL_NON_USER_DATA', false, 'PRESERVE_GLOBAL', 'Global product match.'),
  PriceObservation: e('GLOBAL_SHARED', 'GLOBAL_NON_USER_DATA', false, 'PRESERVE_GLOBAL', 'Global price observation.'),
  PriceSnapshot: e('GLOBAL_SHARED', 'GLOBAL_NON_USER_DATA', false, 'PRESERVE_GLOBAL', 'Global price snapshot.'),
  Pantry: e('DIRECT_USER_OWNED', 'USER_PERSONAL_PURGE', true, 'PURGE', 'Private pantry.'),
  PantryItem: e('TRANSITIVE_USER_OWNED', 'USER_PERSONAL_PURGE', true, 'PURGE', 'Private pantry item.'),
  Family: e('GLOBAL_SHARED', 'GLOBAL_NON_USER_DATA', true, 'PRESERVE_GLOBAL', 'Shared household aggregate; deleted only when last active member is deleted.'),
  FamilyMember: e('DIRECT_USER_OWNED', 'USER_PERSONAL_PURGE', true, 'PURGE', 'Deleted user membership/private state is purged.'),
  FamilyInvitation: e('GLOBAL_SHARED', 'GLOBAL_NON_USER_DATA', true, 'PRESERVE_GLOBAL', 'Shared family invitation lifecycle with actor identity detached as needed.'),
  SharedDish: e('GLOBAL_SHARED', 'GLOBAL_NON_USER_DATA', true, 'PRESERVE_GLOBAL', 'Shared household dish retained for remaining active members.'),
  SharedDishPortion: e('DIRECT_USER_OWNED', 'USER_PERSONAL_PURGE', true, 'PURGE', 'Deleted user portion is personal; other members portions remain.'),
  FamilyShoppingList: e('GLOBAL_SHARED', 'GLOBAL_NON_USER_DATA', true, 'PRESERVE_GLOBAL', 'Shared household shopping list retained for remaining active members.'),
  FamilyShoppingItem: e('GLOBAL_SHARED', 'GLOBAL_NON_USER_DATA', true, 'PRESERVE_GLOBAL', 'Shared household shopping item retained with family list.'),
  NotificationPreference: e('DIRECT_USER_OWNED', 'USER_PERSONAL_PURGE', true, 'PURGE', 'Personal notification preferences.'),
  Notification: e('DIRECT_USER_OWNED', 'USER_PERSONAL_PURGE', true, 'PURGE', 'Personal notification content/state.'),
  NotificationOutbox: e('TRANSITIVE_USER_OWNED', 'USER_PERSONAL_PURGE', false, 'PURGE', 'Outbox belongs to personal notification.'),
  DeliveryAttempt: e('TRANSITIVE_USER_OWNED', 'USER_PERSONAL_PURGE', false, 'PURGE', 'Delivery attempt belongs to personal notification.'),
  EngagementState: e('DIRECT_USER_OWNED', 'USER_PERSONAL_PURGE', true, 'PURGE', 'Personal engagement state.'),
  IntegrationConnection: e('DIRECT_USER_OWNED', 'USER_PERSONAL_PURGE', true, 'PURGE', 'Personal integration credentials/tokens.'),
  IntegrationWebhookEvent: e('GLOBAL_SHARED', 'GLOBAL_NON_USER_DATA', false, 'PRESERVE_GLOBAL', 'Provider webhook event is global operational idempotency state.'),
  HealthPlatformConsent: e('DIRECT_USER_OWNED', 'USER_PERSONAL_PURGE', true, 'PURGE', 'Personal health-platform consent.'),
  ActivityProviderConnection: e('DIRECT_USER_OWNED', 'USER_PERSONAL_PURGE', true, 'PURGE', 'Personal activity provider connection.'),
  ActivitySyncClient: e('DIRECT_USER_OWNED', 'USER_PERSONAL_PURGE', true, 'PURGE', 'Personal sync client.'),
  ActivityDailySnapshot: e('DIRECT_USER_OWNED', 'USER_PERSONAL_PURGE', true, 'PURGE', 'Personal activity snapshot.'),
  ActivitySyncOperation: e('DIRECT_USER_OWNED', 'USER_PERSONAL_PURGE', true, 'PURGE', 'Personal activity sync operation.'),
  ActivitySyncRateBucket: e('DIRECT_USER_OWNED', 'USER_PERSONAL_PURGE', false, 'PURGE', 'Per-user sync rate bucket.'),
  SchemaMigrationLedger: e('GLOBAL_SHARED', 'GLOBAL_NON_USER_DATA', false, 'PRESERVE_GLOBAL', 'Global schema/seed ledger.'),
  CatalogSeedBatch: e('GLOBAL_SHARED', 'GLOBAL_NON_USER_DATA', false, 'PRESERVE_GLOBAL', 'Global catalog seed batch.'),
} as const satisfies Record<string, RegistryEntry>;

export type RegisteredModelName = keyof typeof OWNERSHIP_RETENTION_REGISTRY;

export function ownershipRegistryEntries(): Array<[RegisteredModelName, RegistryEntry]> {
  return Object.entries(OWNERSHIP_RETENTION_REGISTRY) as Array<[RegisteredModelName, RegistryEntry]>;
}

export function assertRegistryCoversModels(modelNames: readonly string[]): void {
  const registered = new Set(Object.keys(OWNERSHIP_RETENTION_REGISTRY));
  const actual = new Set(modelNames);
  const missing = [...actual].filter((name) => !registered.has(name)).sort();
  const extra = [...registered].filter((name) => !actual.has(name)).sort();
  if (missing.length || extra.length) {
    throw new Error(`OWNERSHIP_RETENTION_REGISTRY_MISMATCH missing=${missing.join(',') || '-'} extra=${extra.join(',') || '-'}`);
  }
}

function e(
  ownership: OwnershipClass,
  retention: RetentionClass,
  exportable: boolean,
  deletion: RegistryEntry['deletion'],
  reason: string,
): RegistryEntry {
  return { ownership, retention, exportable, deletion, reason };
}
