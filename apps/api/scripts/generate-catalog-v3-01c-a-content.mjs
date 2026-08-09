/**
 * CATALOG-V3-01C-A — generate Batch A content SoT from target CSV + curated selection.
 *   node apps/api/scripts/generate-catalog-v3-01c-a-content.mjs
 *   node apps/api/scripts/generate-catalog-v3-01c-a-content.mjs --check
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSV = path.resolve(
  'D:/WA/audit-artifacts/WORKOUT-CATALOG-V3-SCOPE-01/04_TARGET_CATALOG_V3.csv',
);
const OUT = path.resolve(
  __dirname,
  '../src/modules/workout-engine/catalog/catalog-v3-01c-a-content.ts',
);

/** High-value Batch A selection (~40). */
export const BATCH_A_KEYS = [
  'dumbbell_bench_press',
  'chest_press_dumbbell_incline',
  'dumbbell_fly',
  'cable_fly',
  'wall_push_up',
  'push_up_decline',
  'close_grip_push_up',
  'pull_up',
  'chin_up',
  'lat_pulldown_wide',
  'seated_row_machine',
  'face_pull_cable',
  'straight_arm_pulldown',
  'single_arm_cable_row',
  'rear_delt_fly_dumbbell',
  'arnold_press_dumbbell',
  'dumbbell_bicep_curl',
  'hammer_curl_dumbbell',
  'triceps_pushdown',
  'overhead_triceps_extension_dumbbell',
  'barbell_back_squat',
  'bulgarian_split_squat',
  'walking_lunge_bodyweight',
  'kettlebell_goblet_squat',
  'sumo_squat_dumbbell',
  'conventional_deadlift',
  'romanian_deadlift_kettlebell',
  'kettlebell_deadlift',
  'kettlebell_swing',
  'leg_curl_lying',
  'cable_kickback',
  'single_leg_glute_bridge',
  'hanging_knee_raise',
  'cable_crunch',
  'ab_wheel_regression',
  'cable_woodchop',
  'farmer_carry_kettlebell',
  'step_up_bodyweight',
  'band_bicep_curl',
  'band_triceps_extension',
];

/** Held ADD candidates (not authored in Batch A). */
export const BATCH_A_HELD = [
  {
    key: 'front_squat_goblet_to_barbell',
    reason: 'BATCH_A_HELD_FOR_IDENTITY_REVIEW: dual implement (DB/barbell) encoded as one key',
  },
  {
    key: 'leg_press_narrow',
    reason: 'BATCH_A_HELD_FOR_IDENTITY_REVIEW: micro-variant of existing machine_leg_press',
  },
  {
    key: 'meadows_row',
    reason: 'BATCH_A_HELD_FOR_IDENTITY_REVIEW: obscure specialty row; defer to later batch',
  },
  {
    key: 'hip_airplane',
    reason: 'BATCH_A_HELD_FOR_IDENTITY_REVIEW: advanced niche balance drill',
  },
  {
    key: 'copenhagen_adductor_regression',
    reason: 'BATCH_A_HELD_FOR_IDENTITY_REVIEW: specialized rehab-style progression',
  },
  {
    key: 'inverted_row',
    reason: 'BATCH_A_HELD_FOR_IDENTITY_REVIEW: equipment OR uses BAR_RACK not in V3 vocab',
  },
  {
    key: 'y_raise_prone',
    reason: 'BATCH_A_HELD_FOR_IDENTITY_REVIEW: LIGHT_DUMBBELL not in V3 equipment vocab',
  },
  {
    key: 'nordic_hamstring_regression',
    reason: 'BATCH_A_HELD_FOR_IDENTITY_REVIEW: advanced niche; needs clearer regression identity',
  },
  {
    key: 'smith_squat',
    reason: 'BATCH_A_HELD_FOR_IDENTITY_REVIEW: machine micro-variant of barbell squat family',
  },
  {
    key: 'tibialis_raise',
    reason: 'BATCH_A_HELD_FOR_IDENTITY_REVIEW: low-priority accessory; deferred for coverage balance',
  },
];

/** Per-key technique content (Russian). */
const CONTENT = {
  dumbbell_bench_press: {
    techniqueRu:
      'Лягте на скамью, гантели над грудью на прямых руках; опустите к сторонам груди и выжмите вверх, не прогибая поясницу.',
    commonMistakeRu: 'Разводить локти слишком широко и отрывать таз от скамьи.',
    easierVariantRu: 'Выполняйте жим гантелей на полу с меньшей амплитудой.',
    harderVariantRu: 'Увеличьте паузу в нижней точке на 1–2 секунды.',
    breathingRu: 'Вдох при опускании, выдох при жиме вверх.',
    stopConditionsRu: 'Остановитесь при острой боли в плече или груди.',
  },
  chest_press_dumbbell_incline: {
    techniqueRu:
      'Сядьте на наклонную скамью, гантели над верхней частью груди; опустите к плечам и выжмите вверх по дуге.',
    commonMistakeRu: 'Сильно прогибать поясницу и разводить локти до ушей.',
    easierVariantRu: 'Уменьшите угол наклона скамьи.',
    harderVariantRu: 'Добавьте медленный негатив 3 секунды.',
    breathingRu: 'Вдох вниз, выдох вверх.',
    stopConditionsRu: 'Остановитесь при боли в передней части плеча.',
  },
  dumbbell_fly: {
    techniqueRu:
      'Лёжа на скамье, гантели над грудью слегка согнутыми локтями; разведите руки в стороны по дуге и сведите обратно.',
    commonMistakeRu: 'Сгибать локти как в жиме или опускать слишком глубоко.',
    easierVariantRu: 'Сократите амплитуду и используйте меньший вес.',
    harderVariantRu: 'Задержите растяжение внизу на секунду.',
    breathingRu: 'Вдох при разведении, выдох при сведении.',
    stopConditionsRu: 'Остановитесь при резкой боли в плече.',
  },
  cable_fly: {
    techniqueRu:
      'Встаньте между блоками, руки слегка согнуты; сведите рукояти перед грудью по дуге и контролируемо верните.',
    commonMistakeRu: 'Тянуть руками за счёт сгибания локтей вместо дуги в плече.',
    easierVariantRu: 'Установите блоки выше и сократите амплитуду.',
    harderVariantRu: 'Сведите рукояти с паузой в центре.',
    breathingRu: 'Выдох при сведении, вдох при возврате.',
    stopConditionsRu: 'Остановитесь при дискомфорте в плечевом суставе.',
  },
  wall_push_up: {
    techniqueRu:
      'Упритесь ладонями в стену на уровне груди, тело прямой линией; согните локти, приблизьте грудь к стене и отожмитесь.',
    commonMistakeRu: 'Прогибать поясницу и «ронять» бёдра к стене.',
    easierVariantRu: 'Поставьте ноги ближе к стене.',
    harderVariantRu: 'Отойдите дальше от стены, увеличив наклон.',
    breathingRu: 'Вдох к стене, выдох от стены.',
    stopConditionsRu: 'Остановитесь при боли в запястье или плече.',
  },
  push_up_decline: {
    techniqueRu:
      'Носки на устойчивой возвышенности, ладони на полу под плечами; опустите грудь между руками и отожмитесь цельной линией.',
    commonMistakeRu: 'Проваливать поясницу и поднимать таз.',
    easierVariantRu: 'Используйте более низкую опору для ног.',
    harderVariantRu: 'Замедлите негатив до 3 секунд.',
    breathingRu: 'Вдох вниз, выдох вверх.',
    stopConditionsRu: 'Остановитесь при боли в плече или запястье.',
  },
  close_grip_push_up: {
    techniqueRu:
      'Ладони уже плеч, тело прямой линией; опуститесь, держа локти ближе к корпусу, и отожмитесь.',
    commonMistakeRu: 'Разводить локти в стороны как в широких отжиманиях.',
    easierVariantRu: 'Выполняйте с колен с узкой постановкой рук.',
    harderVariantRu: 'Добавьте паузу внизу.',
    breathingRu: 'Вдох вниз, выдох вверх.',
    stopConditionsRu: 'Остановитесь при боли в локте или запястье.',
  },
  pull_up: {
    techniqueRu:
      'Повисните прямым хватом чуть шире плеч; подтяните грудь к перекладине, сводя лопатки, и опуститесь под контролем.',
    commonMistakeRu: 'Раскачиваться корпусом и не разгибать руки внизу.',
    easierVariantRu: 'Используйте резиновую петлю или негативные подтягивания.',
    harderVariantRu: 'Добавьте паузу вверху у перекладины.',
    breathingRu: 'Выдох вверх, вдох вниз.',
    stopConditionsRu: 'Остановитесь при острой боли в локте или плече.',
  },
  chin_up: {
    techniqueRu:
      'Повисните обратным хватом на ширине плеч; подтянитесь, направляя грудь к перекладине, и плавно опуститесь.',
    commonMistakeRu: 'Сильно отклонять корпус назад и сокращать амплитуду.',
    easierVariantRu: 'Используйте ленту-ассист или негативы.',
    harderVariantRu: 'Замедлите опускание до 3–4 секунд.',
    breathingRu: 'Выдох вверх, вдох вниз.',
    stopConditionsRu: 'Остановитесь при боли в локте или бицепсе.',
  },
  lat_pulldown_wide: {
    techniqueRu:
      'Сядьте в тренажёр, возьмите рукоять широко; тяните к верхней груди, сводя лопатки вниз-назад, затем отпустите вверх.',
    commonMistakeRu: 'Тянуть рукоять за голову и сильно отклоняться назад.',
    easierVariantRu: 'Уменьшите вес и используйте нейтральный хват.',
    harderVariantRu: 'Пауза 1 секунда у груди.',
    breathingRu: 'Выдох при тяге, вдох при возврате.',
    stopConditionsRu: 'Остановитесь при боли в плече.',
  },
  seated_row_machine: {
    techniqueRu:
      'Сядьте с упором груди/ног по конструкции тренажёра; тяните рукоять к животу, сводя лопатки, и медленно верните.',
    commonMistakeRu: 'Округлять спину и дергать вес корпусом.',
    easierVariantRu: 'Снизьте вес и сократите амплитуду.',
    harderVariantRu: 'Добавьте паузу в сокращении.',
    breathingRu: 'Выдох на тяге, вдох на возврате.',
    stopConditionsRu: 'Остановитесь при боли в пояснице.',
  },
  face_pull_cable: {
    techniqueRu:
      'Поставьте блок на уровень лица; тяните канат к лицу, разводя руки и направляя локти назад-в стороны.',
    commonMistakeRu: 'Тянуть только бицепсом без внешней ротации плеч.',
    easierVariantRu: 'Используйте меньший вес и шагните ближе.',
    harderVariantRu: 'Удерживайте конечную точку 1–2 секунды.',
    breathingRu: 'Выдох на тяге, вдох на возврате.',
    stopConditionsRu: 'Остановитесь при щелчках/боли в плече.',
  },
  straight_arm_pulldown: {
    techniqueRu:
      'Встаньте перед верхним блоком, руки почти прямые; тяните рукоять дугой к бёдрам за счёт широчайших и медленно верните.',
    commonMistakeRu: 'Сильно сгибать локти, превращая движение в обычную тягу.',
    easierVariantRu: 'Сократите амплитуду и уменьшите вес.',
    harderVariantRu: 'Пауза у бёдер внизу.',
    breathingRu: 'Выдох вниз, вдох вверх.',
    stopConditionsRu: 'Остановитесь при боли в пояснице или плече.',
  },
  single_arm_cable_row: {
    techniqueRu:
      'Встаньте боком к блоку, свободная рука на опоре; тяните рукоять к поясу, локоть вдоль корпуса, затем отпустите.',
    commonMistakeRu: 'Разворачивать весь корпус вместо работы лопатки.',
    easierVariantRu: 'Сядьте и выполняйте с упором.',
    harderVariantRu: 'Добавьте паузу у корпуса.',
    breathingRu: 'Выдох на тяге, вдох на возврате.',
    stopConditionsRu: 'Остановитесь при боли в плече или пояснице.',
  },
  rear_delt_fly_dumbbell: {
    techniqueRu:
      'Наклонитесь с прямой спиной, гантели под плечами; разведите руки в стороны до линии корпуса, локти мягкие.',
    commonMistakeRu: 'Поднимать вес рывком трапециями вверх к ушам.',
    easierVariantRu: 'Опереться грудью о наклонную скамью.',
    harderVariantRu: 'Замедлите негатив.',
    breathingRu: 'Выдох на разведении, вдох на опускании.',
    stopConditionsRu: 'Остановитесь при боли в шее или плече.',
  },
  arnold_press_dumbbell: {
    techniqueRu:
      'Сидя или стоя, гантели перед плечами ладонями к себе; разворачивая запястья наружу, выжмите вверх и верните обратно.',
    commonMistakeRu: 'Прогибать поясницу и ударять гантели друг о друга вверху.',
    easierVariantRu: 'Жмите сидя с опорой спины без полного разворота.',
    harderVariantRu: 'Выполняйте стоя с более медленным темпом.',
    breathingRu: 'Выдох вверх, вдох вниз.',
    stopConditionsRu: 'Остановитесь при боли в плече.',
  },
  dumbbell_bicep_curl: {
    techniqueRu:
      'Встаньте, гантели у бёдер; сгибайте локти, поднимая вес к плечам без раскачки корпуса, и опустите под контролем.',
    commonMistakeRu: 'Забрасывать гантели за счёт наклона назад.',
    easierVariantRu: 'Выполняйте поочерёдно с меньшей амплитудой.',
    harderVariantRu: 'Добавьте паузу вверху.',
    breathingRu: 'Выдох вверх, вдох вниз.',
    stopConditionsRu: 'Остановитесь при боли в локте.',
  },
  hammer_curl_dumbbell: {
    techniqueRu:
      'Держите гантели нейтральным хватом; сгибайте локти, сохраняя кисти «молотом», без раскачки туловища.',
    commonMistakeRu: 'Разворачивать кисти и помогать корпусом.',
    easierVariantRu: 'Сгибайте руки поочерёдно.',
    harderVariantRu: 'Замедлите опускание.',
    breathingRu: 'Выдох вверх, вдох вниз.',
    stopConditionsRu: 'Остановитесь при боли в предплечье или локте.',
  },
  triceps_pushdown: {
    techniqueRu:
      'Встаньте у верхнего блока, локти прижаты к корпусу; разогните руки вниз до полного выпрямления и плавно верните.',
    commonMistakeRu: 'Отводить локти вперёд и наклоняться всем телом на вес.',
    easierVariantRu: 'Используйте канат и меньший вес.',
    harderVariantRu: 'Пауза внизу при разогнутых руках.',
    breathingRu: 'Выдох вниз, вдох вверх.',
    stopConditionsRu: 'Остановитесь при боли в локте.',
  },
  overhead_triceps_extension_dumbbell: {
    techniqueRu:
      'Поднимите гантель над головой двумя руками; сгибая локти, опустите вес за голову и разогните руки вверх.',
    commonMistakeRu: 'Раздвигать локти в стороны и прогибать поясницу.',
    easierVariantRu: 'Выполняйте сидя с опорой спины.',
    harderVariantRu: 'Используйте одну гантель на руку поочерёдно.',
    breathingRu: 'Вдох вниз, выдох вверх.',
    stopConditionsRu: 'Остановитесь при боли в локте или плече.',
  },
  barbell_back_squat: {
    techniqueRu:
      'Штанга на верхней части спины, стопы на ширине плеч; отведите таз назад-вниз до комфортной глубины и встаньте, сохраняя опору на всей стопе.',
    commonMistakeRu: 'Заваливать колени внутрь и округлять поясницу.',
    easierVariantRu: 'Приседайте до параллели с меньшей нагрузкой в раме.',
    harderVariantRu: 'Увеличьте паузу внизу.',
    breathingRu: 'Вдох на опускании, выдох на подъёме.',
    stopConditionsRu: 'Остановитесь при острой боли в колене или пояснице.',
  },
  bulgarian_split_squat: {
    techniqueRu:
      'Задняя стопа на скамье/опоре, передняя впереди; опуститесь сгибанием переднего колена и встаньте, корпус почти вертикален.',
    commonMistakeRu: 'Ставить переднюю стопу слишком близко и заваливать колено внутрь.',
    easierVariantRu: 'Уменьшите глубину или выполняйте без отягощения.',
    harderVariantRu: 'Держите гантели в руках.',
    breathingRu: 'Вдох вниз, выдох вверх.',
    stopConditionsRu: 'Остановитесь при боли в колене или сгибателе бедра.',
  },
  walking_lunge_bodyweight: {
    techniqueRu:
      'Шагните вперёд, опустите заднее колено к полу под контролем; оттолкнитесь передней ногой и шагайте в следующий выпад.',
    commonMistakeRu: 'Падать коленом внутрь и наклоняться чрезмерно вперёд.',
    easierVariantRu: 'Делайте выпады на месте с опорой рукой.',
    harderVariantRu: 'Увеличьте длину шага и глубину.',
    breathingRu: 'Вдох вниз, выдох при шаге вверх.',
    stopConditionsRu: 'Остановитесь при боли в колене.',
  },
  kettlebell_goblet_squat: {
    techniqueRu:
      'Держите гирю у груди за рога/корпус; присядьте, разводя колени по носкам, и встаньте, сохраняя корпус вертикальным.',
    commonMistakeRu: 'Округлять спину и отрывать пятки.',
    easierVariantRu: 'Приседайте до удобной глубины без гири у груди (руки перед собой).',
    harderVariantRu: 'Добавьте паузу внизу.',
    breathingRu: 'Вдох вниз, выдох вверх.',
    stopConditionsRu: 'Остановитесь при боли в коленях или пояснице.',
  },
  sumo_squat_dumbbell: {
    techniqueRu:
      'Широкая постановка стоп носками наружу, гантель между ног; присядьте, сохраняя грудь вверх, и встаньте, сжимая ягодицы.',
    commonMistakeRu: 'Заваливать колени внутрь и округлять поясницу.',
    easierVariantRu: 'Уменьшите ширину стойки и вес.',
    harderVariantRu: 'Углубите присед с паузой.',
    breathingRu: 'Вдох вниз, выдох вверх.',
    stopConditionsRu: 'Остановитесь при боли во внутренней стороне бедра или колене.',
  },
  conventional_deadlift: {
    techniqueRu:
      'Штанга над серединой стопы, хват снаружи ног; поднимите вес разгибанием ног и корпуса до вертикали, затем опустите по той же траектории.',
    commonMistakeRu: 'Округлять поясницу и рано выпрямлять ноги, оставляя гриф далеко.',
    easierVariantRu: 'Тяните с плинтов/блоков или используйте гирю.',
    harderVariantRu: 'Добавьте паузу ниже колена на подъёме.',
    breathingRu: 'Вдох перед съёмом, выдох вверху или при опускании по технике.',
    stopConditionsRu: 'Остановитесь при острой боли в пояснице.',
  },
  romanian_deadlift_kettlebell: {
    techniqueRu:
      'Встаньте с гирей перед собой; отводите таз назад, скользя гирей вдоль ног с мягкими коленями, затем вернитесь, сжав ягодицы.',
    commonMistakeRu: 'Сильно сгибать колени в присед и округлять спину.',
    easierVariantRu: 'Сократите амплитуду до середины голени.',
    harderVariantRu: 'Замедлите негатив.',
    breathingRu: 'Вдох при наклоне, выдох при подъёме.',
    stopConditionsRu: 'Остановитесь при боли в пояснице или задней поверхности бедра.',
  },
  kettlebell_deadlift: {
    techniqueRu:
      'Гиря между стоп; возьмитесь за дужку, выпрямите спину и встаньте за счёт ног и таза, затем опустите гирю на пол.',
    commonMistakeRu: 'Тянуть спиной с округлённой поясницей.',
    easierVariantRu: 'Поставьте гирю на небольшую возвышенность.',
    harderVariantRu: 'Используйте более тяжёлую гирю с паузой у пола.',
    breathingRu: 'Вдох перед съёмом, выдох вверху.',
    stopConditionsRu: 'Остановитесь при боли в пояснице.',
  },
  kettlebell_swing: {
    techniqueRu:
      'Хип-хинджем отведите гирю назад между ног и резко разогните таз, вынося гирю до уровня груди; руки остаются «верёвками».',
    commonMistakeRu: 'Приседать слишком глубоко и поднимать гирю руками.',
    easierVariantRu: 'Делайте махи до уровня пояса с лёгкой гирей.',
    harderVariantRu: 'Увеличьте мощность разгибания таза до уровня плеч.',
    breathingRu: 'Выдох на разгибании таза, вдох на возврате.',
    stopConditionsRu: 'Остановитесь при боли в пояснице или потери контроля гири.',
  },
  leg_curl_lying: {
    techniqueRu:
      'Лягте в тренажёр, валик на нижней части голени; сгибайте ноги к ягодицам и медленно разгибайте.',
    commonMistakeRu: 'Отрывать таз от подушки и помогать рывком.',
    easierVariantRu: 'Уменьшите вес и амплитуду.',
    harderVariantRu: 'Пауза в сокращении.',
    breathingRu: 'Выдох на сгибании, вдох на разгибании.',
    stopConditionsRu: 'Остановитесь при боли в колене или задней поверхности бедра.',
  },
  cable_kickback: {
    techniqueRu:
      'Прикрепите манжету к нижнему блоку; отведите ногу назад, сохраняя корпус стабильным, и медленно верните.',
    commonMistakeRu: 'Прогибать поясницу и разворачивать таз.',
    easierVariantRu: 'Уменьшите амплитуду и вес.',
    harderVariantRu: 'Пауза в верхней точке.',
    breathingRu: 'Выдох при отведении, вдох при возврате.',
    stopConditionsRu: 'Остановитесь при боли в пояснице.',
  },
  single_leg_glute_bridge: {
    techniqueRu:
      'Лёжа на спине, одна стопа на полу, другая выпрямлена; поднимите таз, сжимая ягодицу опорной ноги, и опустите.',
    commonMistakeRu: 'Прогибать поясницу и вращать таз в сторону.',
    easierVariantRu: 'Держите вторую ногу согнутой в воздухе.',
    harderVariantRu: 'Добавьте паузу вверху.',
    breathingRu: 'Выдох вверх, вдох вниз.',
    stopConditionsRu: 'Остановитесь при боли в пояснице.',
  },
  hanging_knee_raise: {
    techniqueRu:
      'Повисните на перекладине; подтяните колени к груди, не раскачиваясь, и медленно опустите.',
    commonMistakeRu: 'Раскачиваться махом и помогать только бёдрами без контроля пресса.',
    easierVariantRu: 'Выполняйте подъёмы коленей лёжа или в упоре на брусьях с поддержкой.',
    harderVariantRu: 'Выпрямляйте ноги в подъёме носков к перекладине.',
    breathingRu: 'Выдох вверх, вдох вниз.',
    stopConditionsRu: 'Остановитесь при боли в пояснице или хвате.',
  },
  cable_crunch: {
    techniqueRu:
      'Встаньте на колени у верхнего блока, рукоять у головы; скрутите корпус вниз, округляя грудной отдел, и вернитесь.',
    commonMistakeRu: 'Тянуть руками и сгибать только тазобедренный сустав.',
    easierVariantRu: 'Уменьшите вес и амплитуду.',
    harderVariantRu: 'Пауза внизу в сжатии.',
    breathingRu: 'Выдох при скручивании, вдох при подъёме.',
    stopConditionsRu: 'Остановитесь при боли в шее или пояснице.',
  },
  ab_wheel_regression: {
    techniqueRu:
      'С колен возьмите ролик; прокатите его вперёд, сохраняя нейтральную поясницу, и верните к коленям.',
    commonMistakeRu: 'Проваливать поясницу и «падать» плечами вниз.',
    easierVariantRu: 'Сократите выкат до короткой дистанции.',
    harderVariantRu: 'Увеличьте дистанцию выката.',
    breathingRu: 'Вдох наружу, выдох на возврате.',
    stopConditionsRu: 'Остановитесь при боли в пояснице.',
  },
  cable_woodchop: {
    techniqueRu:
      'Поставьте блок высоко сбоку; тяните рукоять диагонально вниз-через корпус к противоположному бедру с поворотом туловища.',
    commonMistakeRu: 'Крутить только руками без участия корпуса.',
    easierVariantRu: 'Уменьшите вес и амплитуду поворота.',
    harderVariantRu: 'Выполняйте из более высокого блока с паузой внизу.',
    breathingRu: 'Выдох на рубке, вдох на возврате.',
    stopConditionsRu: 'Остановитесь при боли в пояснице.',
  },
  farmer_carry_kettlebell: {
    techniqueRu:
      'Возьмите гири по бокам, встаньте высоко; идите короткими шагами, сохраняя корпус жёстким и плечи опущенными.',
    commonMistakeRu: 'Сутулиться и раскачиваться в стороны.',
    easierVariantRu: 'Несите одну гирю легче на короткую дистанцию.',
    harderVariantRu: 'Увеличьте вес или дистанцию.',
    breathingRu: 'Дышите ровно, не задерживая дыхание надолго.',
    stopConditionsRu: 'Остановитесь при потере хвата или боли в пояснице.',
  },
  step_up_bodyweight: {
    techniqueRu:
      'Поставьте всю стопу на тумбу; встаньте на неё ведущей ногой без толчка задней и контролируемо шагните вниз.',
    commonMistakeRu: 'Отталкиваться задней ногой и заваливать колено внутрь.',
    easierVariantRu: 'Используйте более низкую тумбу.',
    harderVariantRu: 'Замедлите спуск с тумбы.',
    breathingRu: 'Выдох вверх, вдох вниз.',
    stopConditionsRu: 'Остановитесь при боли в колене.',
  },
  band_bicep_curl: {
    techniqueRu:
      'Встаньте на ленту, рукояти в руках; сгибайте локти к плечам, прижимая локти к корпусу, и медленно разогните.',
    commonMistakeRu: 'Помогать раскачкой корпуса.',
    easierVariantRu: 'Возьмите более лёгкую ленту.',
    harderVariantRu: 'Сделайте паузу вверху.',
    breathingRu: 'Выдох вверх, вдох вниз.',
    stopConditionsRu: 'Остановитесь при боли в локте.',
  },
  band_triceps_extension: {
    techniqueRu:
      'Закрепите ленту сверху/перед собой; разогните руки в локтях, сохраняя плечи стабильными, и верните под контролем.',
    commonMistakeRu: 'Раздвигать локти и помогать корпусом.',
    easierVariantRu: 'Укоротите рычаг ленты (встаньте ближе к точке крепления).',
    harderVariantRu: 'Пауза в разогнутом положении.',
    breathingRu: 'Выдох при разгибании, вдох при сгибании.',
    stopConditionsRu: 'Остановитесь при боли в локте.',
  },
};

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const headers = lines[0].split(',');
  const parseLine = (line) => {
    const out = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        q = !q;
        continue;
      }
      if (c === ',' && !q) {
        out.push(cur);
        cur = '';
        continue;
      }
      cur += c;
    }
    out.push(cur);
    return out;
  };
  return lines.slice(1).map((line) => {
    const cols = parseLine(line);
    const o = {};
    headers.forEach((h, i) => {
      o[h] = cols[i] ?? '';
    });
    return o;
  });
}

function parseEquipment(req) {
  // Supports: A+B, A|OR_B, A|OR_B+C (second branch becomes OPTIONAL items if +)
  if (!req || req === 'NONE') {
    return [{ groupKind: 'ALL_OF', sortOrder: 0, items: [{ equipmentCode: 'NONE', sortOrder: 0 }] }];
  }
  if (req.includes('|OR_')) {
    const [left, rightRaw] = req.split('|OR_');
    const right = rightRaw;
    if (right.includes('+')) {
      // e.g. BODYWEIGHT|OR_DUMBBELL+BENCH → ALL_OF BODYWEIGHT; OPTIONAL DUMBBELL; OPTIONAL BENCH
      const groups = [
        {
          groupKind: 'ALL_OF',
          sortOrder: 0,
          items: [{ equipmentCode: left, sortOrder: 0 }],
        },
      ];
      right.split('+').forEach((code, i) => {
        groups.push({
          groupKind: 'OPTIONAL',
          sortOrder: i + 1,
          items: [{ equipmentCode: code, sortOrder: 0 }],
        });
      });
      return groups;
    }
    return [
      {
        groupKind: 'ANY_OF',
        sortOrder: 0,
        items: [
          { equipmentCode: left, sortOrder: 0 },
          { equipmentCode: right, sortOrder: 1 },
        ],
      },
    ];
  }
  if (req.includes('+')) {
    return [
      {
        groupKind: 'ALL_OF',
        sortOrder: 0,
        items: req.split('+').map((equipmentCode, sortOrder) => ({ equipmentCode, sortOrder })),
      },
    ];
  }
  return [
    {
      groupKind: 'ALL_OF',
      sortOrder: 0,
      items: [{ equipmentCode: req, sortOrder: 0 }],
    },
  ];
}

function mapHubPattern(v3) {
  const m = {
    HORIZONTAL_PUSH: 'push',
    VERTICAL_PUSH: 'push',
    HORIZONTAL_PULL: 'pull',
    VERTICAL_PULL: 'pull',
    SQUAT: 'squat',
    LUNGE: 'squat',
    KNEE_EXTENSION: 'squat',
    HINGE: 'hinge',
    HIP_EXTENSION: 'hinge',
    KNEE_FLEXION: 'hinge',
    HIP_ABDUCTION: 'hinge',
    HIP_ADDUCTION: 'hinge',
    CALF_RAISE: 'squat',
    CARRY: 'cardio',
    CORE_FLEXION: 'core',
    CORE_ANTI_EXTENSION: 'core',
    CORE_ANTI_ROTATION: 'core',
    CORE_ROTATION: 'core',
    LOCOMOTION: 'cardio',
    JUMP: 'cardio',
    CONDITIONING: 'cardio',
    MOBILITY: 'mobility',
    ELBOW_FLEXION: 'pull',
    ELBOW_EXTENSION: 'push',
  };
  return m[v3] ?? 'core';
}

function muscles(primary, secondaryCsv) {
  const out = [{ muscleCode: primary, involvement: 'PRIMARY', sortOrder: 0 }];
  const secs = (secondaryCsv || '')
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((c) => c !== 'LEGS' && c !== 'SHOULDERS' && c !== 'CORE');
  // Map informal aliases
  const alias = { SHOULDERS: 'SIDE_DELTS', LEGS: 'QUADS', CORE: 'ABS' };
  let i = 1;
  for (const s of secs) {
    const code = alias[s] ?? s;
    if (code === primary) continue;
    out.push({ muscleCode: code, involvement: 'SECONDARY', sortOrder: i++ });
  }
  return out;
}

function lit(v) {
  return JSON.stringify(v);
}

function emitEntry(row) {
  const key = row.canonicalKey;
  const c = CONTENT[key];
  if (!c) throw new Error(`Missing CONTENT for ${key}`);
  const reps = row.prescriptionMode === 'DURATION';
  const equipmentGroups = parseEquipment(row.equipmentRequirement);
  const mus = muscles(row.primaryMuscle, row.secondaryMuscles);
  const places = row.environment.split('|').filter(Boolean);
  return `  {
    exerciseKey: ${lit(key)},
    nameRu: ${lit(row.ruName)},
    nameEn: ${lit(row.enAlias)},
    familySlug: ${lit(row.progressionGroup)},
    familyNameRu: ${lit(row.ruName)},
    familyNameEn: ${lit(row.enAlias)},
    primaryMovementPattern: ${lit(row.movementPattern)},
    trainingRole: ${lit(row.trainingRole)},
    difficulty: ${lit(row.difficulty)},
    progressionGroup: ${lit(row.progressionGroup)},
    generatorMovementPattern: ${lit(mapHubPattern(row.movementPattern))},
    repetitionMode: ${lit(row.prescriptionMode)},
    supportedPlaces: ${lit(places)},
    muscles: ${lit(mus)},
    equipmentGroups: ${lit(equipmentGroups)},
    techniqueRu: ${lit(c.techniqueRu)},
    commonMistakeRu: ${lit(c.commonMistakeRu)},
    easierVariantRu: ${lit(c.easierVariantRu)},
    harderVariantRu: ${lit(c.harderVariantRu)},
    breathingRu: ${lit(c.breathingRu)},
    stopConditionsRu: ${lit(c.stopConditionsRu)},
    defaultSets: ${reps ? 'null' : '3'},
    defaultRepsMin: ${reps ? 'null' : '8'},
    defaultRepsMax: ${reps ? 'null' : '12'},
    defaultDurationSeconds: ${reps ? '40' : 'null'},
    defaultRestSeconds: 60,
    estimatedDurationSeconds: ${reps ? '240' : '180'},
    estimatedMinutes: ${reps ? '5' : '4'},
    riskLevel: 'low',
    beginnerAllowed: ${lit(row.difficulty === 'BEGINNER')},
  }`;
}

function main() {
  const check = process.argv.includes('--check');
  const rows = parseCsv(fs.readFileSync(CSV, 'utf8'));
  const addMap = new Map(rows.filter((r) => r.status === 'ADD').map((r) => [r.canonicalKey, r]));
  for (const k of BATCH_A_KEYS) {
    if (!addMap.has(k)) throw new Error(`Batch A key not ADD in CSV: ${k}`);
    if (!CONTENT[k]) throw new Error(`Missing technique content: ${k}`);
  }
  if (new Set(BATCH_A_KEYS).size !== BATCH_A_KEYS.length) {
    throw new Error('Duplicate BATCH_A_KEYS');
  }

  const entries = BATCH_A_KEYS.map((k) => emitEntry(addMap.get(k)));
  const held = BATCH_A_HELD.map(
    (h) => `  { exerciseKey: ${lit(h.key)}, reason: ${lit(h.reason)} }`,
  );

  const body = `/**
 * CATALOG-V3-01C-A — Batch A NEW exercise content SoT.
 * Generated from WORKOUT-CATALOG-V3-SCOPE-01/04_TARGET_CATALOG_V3.csv (status=ADD).
 * Regenerator: node apps/api/scripts/generate-catalog-v3-01c-a-content.mjs
 * Do not invent UNKNOWN readiness / Energy / Timing / Media.
 */
import type { V3EquipmentGroupDraft, V3MuscleInvolvementDraft } from './catalog-v3-taxonomy';

export const CATALOG_V3_01C_A_VERSION = 'workout-catalog-v3-01c-a.1' as const;
export const CATALOG_V3_01C_A_CREATED_BY = 'system:catalog-v3-01c-a' as const;
export const CATALOG_V3_01C_A_ADVISORY_LOCK_KEY = 219_01_003;
export const CATALOG_V3_01C_A_EXPECTED_COUNT = ${BATCH_A_KEYS.length} as const;

export const V3_01C_A_DIFFICULTIES = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED'] as const;
export type V301cADifficulty = (typeof V3_01C_A_DIFFICULTIES)[number];

export type V301cAHeldEntry = {
  exerciseKey: string;
  reason: string;
};

export type V301cAContentEntry = {
  exerciseKey: string;
  nameRu: string;
  nameEn: string;
  familySlug: string;
  familyNameRu: string;
  familyNameEn: string;
  primaryMovementPattern: string;
  trainingRole: string;
  difficulty: V301cADifficulty;
  progressionGroup: string;
  generatorMovementPattern: string;
  repetitionMode: 'REPS' | 'DURATION';
  supportedPlaces: readonly string[];
  muscles: readonly V3MuscleInvolvementDraft[];
  equipmentGroups: readonly V3EquipmentGroupDraft[];
  techniqueRu: string;
  commonMistakeRu: string;
  easierVariantRu: string;
  harderVariantRu: string;
  breathingRu: string;
  stopConditionsRu: string;
  defaultSets: number | null;
  defaultRepsMin: number | null;
  defaultRepsMax: number | null;
  defaultDurationSeconds: number | null;
  defaultRestSeconds: number;
  estimatedDurationSeconds: number;
  estimatedMinutes: number;
  riskLevel: string;
  beginnerAllowed: boolean;
};

export const CATALOG_V3_01C_A_HELD: readonly V301cAHeldEntry[] = [
${held.join(',\n')}
];

export const CATALOG_V3_01C_A_CONTENT: readonly V301cAContentEntry[] = [
${entries.join(',\n')}
];
`;

  if (check) {
    const existing = fs.readFileSync(OUT, 'utf8');
    if (existing !== body) {
      console.error('CATALOG-V3-01C-A content SoT is stale; regenerate.');
      process.exit(1);
    }
    console.info('CATALOG-V3-01C-A content SoT check passed:', BATCH_A_KEYS.length);
    return;
  }
  fs.writeFileSync(OUT, body, 'utf8');
  console.info('Wrote', OUT, 'entries=', BATCH_A_KEYS.length);
}

main();
