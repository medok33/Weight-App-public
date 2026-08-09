/**
 * Medical safety policy.
 * Nutrition/health lifestyle questions stay allowed (eggs, cravings, etc.).
 * Symptom / disease / treatment questions get a disclaimer — no diagnoses.
 */

export type MedicalSafetyResult = {
  /** Always false for nutrition lifestyle; true for clinical topics */
  requiresDisclaimer: boolean;
  disclaimer?: string;
  /** Soft flag — never blocks the request */
  blocked: false;
};

export const MEDICAL_DISCLAIMER =
  'Информация носит общий ознакомительный характер и не заменяет консультацию врача.';

/** Clinical / treatment signals — trigger disclaimer, do not block. */
const CLINICAL_PATTERN =
  /диагноз|лечени|симптом|болезн|заболеван|лекарств|врач|таблетк|антибиотик|давлен|диабет|онкологи|инфаркт|инсульт|рецепт врача|анализ крови|боль в груди|температур|лихорадк|аллергическ/i;

/** Nutrition examples that must NOT trigger disclaimer alone. */
const NUTRITION_SAFE_PATTERN =
  /яиц|яйц|egg|сладк|хочется|калор|белок|рацион|перекус|голод|порци|меню|кбжу|углевод|питат/i;

export function assessMedicalSafety(message: string): MedicalSafetyResult {
  const text = message.trim();
  if (!text) return { requiresDisclaimer: false, blocked: false };

  // Pure nutrition / craving questions → no disclaimer
  if (NUTRITION_SAFE_PATTERN.test(text) && !CLINICAL_PATTERN.test(text)) {
    return { requiresDisclaimer: false, blocked: false };
  }

  if (CLINICAL_PATTERN.test(text)) {
    return {
      requiresDisclaimer: true,
      disclaimer: MEDICAL_DISCLAIMER,
      blocked: false,
    };
  }

  return { requiresDisclaimer: false, blocked: false };
}

/** Append disclaimer to assistant output when needed (idempotent). */
export function applyMedicalDisclaimer(content: string, requiresDisclaimer: boolean): string {
  if (!requiresDisclaimer) return content;
  if (content.includes(MEDICAL_DISCLAIMER) || content.includes('не заменяет консультацию врача')) {
    return content;
  }
  return `${content.trim()}\n\n${MEDICAL_DISCLAIMER}`;
}
