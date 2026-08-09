/**
 * CATALOG-V3-01C-B — generate Batch B content SoT + polish/deprecation packages.
 *   node apps/api/scripts/generate-catalog-v3-01c-b-content.mjs
 *   node apps/api/scripts/generate-catalog-v3-01c-b-content.mjs --check
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
  '../src/modules/workout-engine/catalog/catalog-v3-01c-b-content.ts',
);

/** Coverage-first Batch B. Priority: conditioning → mobility/warmup/recovery → gaps. */
export const BATCH_B_KEYS = [
  // A. cardio / conditioning
  'jump_rope_easy',
  'row_erg_easy',
  'stair_climber_easy',
  'battle_rope_alternating',
  'sled_push_light',
  'high_knees_easy',
  // B. warmup / mobility / recovery
  'march_in_place',
  'shoulder_caress_circles',
  'world_greatest_stretch',
  '90_90_hip_switch',
  'thread_the_needle',
  'couch_stretch',
  'neck_mobility_gentle',
  'child_pose',
  'foam_roll_quads',
  'box_breathing',
  // C–F. underrepresented patterns / equipment / muscles / familiar high-value
  'hip_adduction_machine',
  'donkey_calf_raise',
  'dead_bug_band',
  'russian_twist_bodyweight',
  'hollow_body_hold',
  'band_good_morning',
  'scapular_retraction_hang',
  'suitcase_carry_kettlebell',
  'box_step_down',
  'hack_squat_machine',
  'lateral_lunge',
  'shrug_dumbbell',
  'front_raise_dumbbell',
  'cable_bicep_curl',
  'ez_bar_curl',
  'bench_dip',
  'upright_row_dumbbell',
];

export const BATCH_B_HELD = [
  {
    key: 'front_squat_goblet_to_barbell',
    reason: 'BATCH_B_HELD_FOR_IDENTITY_REVIEW: dual implement (DB/barbell) encoded as one key',
  },
  {
    key: 'leg_press_narrow',
    reason: 'BATCH_B_HELD_FOR_IDENTITY_REVIEW: micro-variant of existing machine_leg_press',
  },
  {
    key: 'meadows_row',
    reason: 'BATCH_B_HELD_FOR_IDENTITY_REVIEW: obscure specialty row; defer',
  },
  {
    key: 'hip_airplane',
    reason: 'BATCH_B_HELD_FOR_IDENTITY_REVIEW: advanced niche balance drill',
  },
  {
    key: 'copenhagen_adductor_regression',
    reason: 'BATCH_B_HELD_FOR_IDENTITY_REVIEW: specialized rehab-style progression',
  },
  {
    key: 'inverted_row',
    reason: 'BATCH_B_HELD_FOR_IDENTITY_REVIEW: equipment OR uses BAR_RACK not in V3 vocab',
  },
  {
    key: 'y_raise_prone',
    reason: 'BATCH_B_HELD_FOR_IDENTITY_REVIEW: LIGHT_DUMBBELL not in V3 equipment vocab',
  },
  {
    key: 'nordic_hamstring_regression',
    reason: 'BATCH_B_HELD_FOR_IDENTITY_REVIEW: advanced niche; needs clearer regression identity',
  },
  {
    key: 'smith_squat',
    reason: 'BATCH_B_HELD_FOR_IDENTITY_REVIEW: machine micro-variant of barbell squat family',
  },
  {
    key: 'landmine_press',
    reason: 'BATCH_B_HELD_FOR_IDENTITY_REVIEW: landmine attachment missing from V3 equipment vocab (BARBELL alone insufficient)',
  },
  {
    key: 'machine_chest_fly',
    reason:
      'BATCH_B_HELD_DUPLICATE_OF_PUBLISHED: same pec-deck fly as pec_deck_machine; retain pec_deck_machine',
  },
  {
    key: 'glute_bridge_march_hold',
    reason:
      'BATCH_B_HELD_DUPLICATE_OF_PUBLISHED: same bridge+march as glute_bridge_march; retain glute_bridge_march',
  },
  {
    key: 'ankle_mobility_knee_over_toe',
    reason:
      'BATCH_B_HELD_DUPLICATE_OF_PUBLISHED: same knee-over-toe ankle rock as ankle_rocks; retain ankle_rocks',
  },
  {
    key: 'tibialis_raise',
    reason:
      'MISSING_ACCEPTED_ANKLE_DORSIFLEXION_PATTERN: KNEE_EXTENSION/CALF_RAISE are mechanically wrong; no accepted ankle dorsiflexion pattern without taxonomy expansion',
  },
];

/** Russian technique packs for Batch B ADDs. */
const CONTENT = {
  jump_rope_easy: {
    techniqueRu:
      'Держите скакалку на уровне бёдер, локти у корпуса; прыгайте мягко на передней части стопы в спокойном темпе без высоких подскоков.',
    commonMistakeRu: 'Прыгать слишком высоко и жёстко приземляться на прямые ноги.',
    easierVariantRu: 'Делайте низкие подскоки без скакалки, имитируя вращение.',
    harderVariantRu: 'Увеличьте темп, сохраняя низкий прыжок.',
    breathingRu: 'Дышите ровно в ритме прыжков, не задерживая дыхание.',
    stopConditionsRu: 'Остановитесь при боли в голеностопе, колене или одышке вне контроля.',
  },
  row_erg_easy: {
    techniqueRu:
      'Сядьте на гребной тренажёр, стопы в упорах; отталкивайтесь ногами, затем включайте корпус и руки, возврат — руки, корпус, ноги.',
    commonMistakeRu: 'Тянуть только руками и округлять поясницу в конце тяги.',
    easierVariantRu: 'Снизьте сопротивление и укоротите амплитуду выезда.',
    harderVariantRu: 'Добавьте чуть более длинный мощный толчок ногами.',
    breathingRu: 'Выдох на тяге, вдох на возврате.',
    stopConditionsRu: 'Остановитесь при боли в пояснице или резком дискомфорте в колене.',
  },
  stair_climber_easy: {
    techniqueRu:
      'Встаньте на степпер, держитесь лёгким хватом за поручни; шагайте полной стопой в ровном темпе без давления всем весом на руки.',
    commonMistakeRu: 'Переносить вес на поручни и семенить короткими шагами на носках.',
    easierVariantRu: 'Уменьшите уровень сопротивления и темп.',
    harderVariantRu: 'Увеличьте высоту/сопротивление, сохраняя опору корпуса.',
    breathingRu: 'Дышите ровно, согласуя вдох-выдох с шагами.',
    stopConditionsRu: 'Остановитесь при головокружении, боли в колене или острой одышке.',
  },
  battle_rope_alternating: {
    techniqueRu:
      'Встаньте в полуприсед, канаты в руках; поочерёдно поднимайте и опускайте руки, создавая волны, корпус стабилен.',
    commonMistakeRu: 'Раскачивать корпус и полностью разгибать локти рывком.',
    easierVariantRu: 'Делайте волны меньшей амплитуды и короче по времени.',
    harderVariantRu: 'Увеличьте амплитуду волн при том же контроле корпуса.',
    breathingRu: 'Дышите коротко и регулярно, не задерживая дыхание.',
    stopConditionsRu: 'Остановитесь при боли в плече, пояснице или потере контроля волн.',
  },
  sled_push_light: {
    techniqueRu:
      'Наклонитесь к саням, руки на упорах, корпус жёсткий; толкайте короткими мощными шагами, сохраняя нейтральную спину.',
    commonMistakeRu: 'Прогибать поясницу и «бегать» мелкими шагами без упора стопы.',
    easierVariantRu: 'Снизьте нагрузку на санях и укоротите дистанцию.',
    harderVariantRu: 'Увеличьте вес или длину отрезка при том же качестве шага.',
    breathingRu: 'Выдыхайте на усилиях шага, не задерживайте дыхание надолго.',
    stopConditionsRu: 'Остановитесь при боли в пояснице, колене или резкой потере опоры.',
  },
  high_knees_easy: {
    techniqueRu:
      'Бегите на месте, поднимая колени roughly к уровню бедра в контролируемом темпе, приземляясь мягко на переднюю часть стопы.',
    commonMistakeRu: 'Заваливать корпус назад и шлёпать пятками.',
    easierVariantRu: 'Маршируйте с высоким коленом без фазы полёта.',
    harderVariantRu: 'Ускорьте каденс, сохраняя высоту колена.',
    breathingRu: 'Дышите ритмично в темпе шагов.',
    stopConditionsRu: 'Остановитесь при боли в колене, голени или головокружении.',
  },
  march_in_place: {
    techniqueRu:
      'Стоя прямо, поочерёдно поднимайте колени до комфортной высоты, сохраняя лёгкую осанку и мягкую постановку стопы.',
    commonMistakeRu: 'Сутулиться и раскачивать таз из стороны в сторону.',
    easierVariantRu: 'Уменьшите высоту подъёма колена.',
    harderVariantRu: 'Добавьте лёгкое движение руками в противофазе.',
    breathingRu: 'Дышите спокойно и ровно.',
    stopConditionsRu: 'Остановитесь при боли в суставе или головокружении.',
  },
  shoulder_caress_circles: {
    techniqueRu:
      'Встаньте свободно, руки вдоль тела; выполняйте медленные круги плечами назад, затем вперёд, без боли и без рывков.',
    commonMistakeRu: 'Делать круги слишком быстро и поднимать плечи к ушам.',
    easierVariantRu: 'Уменьшите амплитуду кругов.',
    harderVariantRu: 'Увеличьте амплитуду, сохраняя контроль лопаток.',
    breathingRu: 'Вдох при расширении груди, выдох при расслаблении плеч.',
    stopConditionsRu: 'Остановитесь при острой боли или щелчке с болью в плече.',
  },
  world_greatest_stretch: {
    techniqueRu:
      'Из упора выведите одну ногу в выпад, опустите таз, поверните корпус к передней ноге и при необходимости вытяните руку вверх, затем смените сторону.',
    commonMistakeRu: 'Проваливать поясницу и ронять заднее колено без контроля.',
    easierVariantRu: 'Сократите глубину выпада и амплитуду поворота.',
    harderVariantRu: 'Увеличьте время фиксации в конечной позиции.',
    breathingRu: 'Дышите глубоко, удлиняя выдох в растяжении.',
    stopConditionsRu: 'Остановитесь при боли в колене, паху или пояснице.',
  },
  '90_90_hip_switch': {
    techniqueRu:
      'Сядьте в позицию 90/90 (оба колена согнуты ~90°); сохраняя корпус высоким, переведите голени через центр в зеркальную 90/90.',
    commonMistakeRu: 'Заваливать корпус назад и помогать руками чрезмерно.',
    easierVariantRu: 'Используйте руки для лёгкой поддержки сзади.',
    harderVariantRu: 'Выполняйте переходы без опоры руками.',
    breathingRu: 'Выдох на переходе, вдох в стабильной позе.',
    stopConditionsRu: 'Остановитесь при боли в колене или остром дискомфорте в бедре.',
  },
  thread_the_needle: {
    techniqueRu:
      'Встаньте на четвереньки; проведите одну руку под корпусом ладонью вверх, опуская плечо к полу, затем вернитесь и раскройте грудной отдел.',
    commonMistakeRu: 'Крутить только шеей вместо грудного отдела.',
    easierVariantRu: 'Уменьшите амплитуду прохода руки под корпусом.',
    harderVariantRu: 'Задержитесь 2–3 секунды в конечной ротации.',
    breathingRu: 'Выдох при ротации, вдох при возврате.',
    stopConditionsRu: 'Остановитесь при боли в шее, плече или пояснице.',
  },
  ankle_mobility_knee_over_toe: {
    techniqueRu:
      'В выпаде у стены направьте колено вперёд над пальцами стопы, пятка остаётся на полу; мягко увеличивайте амплитуду без боли.',
    commonMistakeRu: 'Отрывать пятку и заваливать колено внутрь.',
    easierVariantRu: 'Уменьшите вынос колена вперёд.',
    harderVariantRu: 'Задержите конечную позицию на 3–5 секунд.',
    breathingRu: 'Дышите спокойно, выдох в растяжении.',
    stopConditionsRu: 'Остановитесь при боли в ахилле, лодыжке или колене.',
  },
  couch_stretch: {
    techniqueRu:
      'Заднее колено у опоры/дивана, стопа вверх по опоре; передняя нога в выпаде, таз подан вперёд, корпус высокий без боли в пояснице.',
    commonMistakeRu: 'Сильно прогибать поясницу вместо наклона таза.',
    easierVariantRu: 'Отойдите тазом дальше от опоры, снизив интенсивность.',
    harderVariantRu: 'Подтяните таз ближе к опоре при нейтральной пояснице.',
    breathingRu: 'Длинный выдох в растяжении сгибателей бедра.',
    stopConditionsRu: 'Остановитесь при острой боли в колене или пояснице.',
  },
  neck_mobility_gentle: {
    techniqueRu:
      'Сидя или стоя с ровной осанкой, медленно выполняйте безопасные движения шеи: наклоны и повороты в комфортном диапазоне без рывков.',
    commonMistakeRu: 'Делать круговые рывки и уходить в боль.',
    easierVariantRu: 'Уменьшите амплитуду до едва заметного движения.',
    harderVariantRu: 'Удерживайте конечную позицию 2 секунды при полном контроле.',
    breathingRu: 'Дышите спокойно, не задерживая дыхание.',
    stopConditionsRu: 'Остановитесь при головокружении, онемении или острой боли.',
  },
  child_pose: {
    techniqueRu:
      'Сядьте на пятки, наклонитесь вперёд, руки протяните вперёд или вдоль тела; расслабьте грудной отдел и дышите в пол.',
    commonMistakeRu: 'Сильно давить плечами в пол через боль.',
    easierVariantRu: 'Поставьте подушку между бёдрами и голенями.',
    harderVariantRu: 'Удлините время удержания при комфорте.',
    breathingRu: 'Медленный вдох в рёбра, длинный выдох в расслабление.',
    stopConditionsRu: 'Остановитесь при боли в коленях или остром дискомфорте в плече.',
  },
  foam_roll_quads: {
    techniqueRu:
      'Лягте животом на ролик под бёдрами; медленно прокатывайте квадрицепсы, останавливаясь на напряжённых участках без резкой боли.',
    commonMistakeRu: 'Катиться слишком быстро и задерживать дыхание.',
    easierVariantRu: 'Снизьте давление, опираясь больше на руки.',
    harderVariantRu: 'Увеличьте время паузы на триггерных зонах.',
    breathingRu: 'Дышите ровно; на плотных участках удлиняйте выдох.',
    stopConditionsRu: 'Остановитесь при острой боли, онемении или синяковой боли.',
  },
  box_breathing: {
    techniqueRu:
      'Сидя удобно, выполните цикл: вдох 4 счёта, пауза 4, выдох 4, пауза 4; плечи расслаблены, живот мягко участвует.',
    commonMistakeRu: 'Набирать воздух только верхом груди и ускорять счёт.',
    easierVariantRu: 'Сократите фазы до 3 счётов.',
    harderVariantRu: 'Удлините фазы до 5–6 счётов при сохранении спокойствия.',
    breathingRu: 'Равномерные фазы без форсирования.',
    stopConditionsRu: 'Остановитесь при головокружении или тревожном дискомфорте.',
  },
  hip_adduction_machine: {
    techniqueRu:
      'Сядьте в тренажёр сведения, подушки снаружи бёдер; сведите ноги к центру под контролем и медленно верните.',
    commonMistakeRu: 'Рывком сводить ноги и помогать корпусом.',
    easierVariantRu: 'Уменьшите вес и амплитуду.',
    harderVariantRu: 'Пауза 1 секунда в сведённом положении.',
    breathingRu: 'Выдох при сведении, вдох при возврате.',
    stopConditionsRu: 'Остановитесь при боли в паху или колене.',
  },
  donkey_calf_raise: {
    techniqueRu:
      'В тренажёре или с опорой наклонитесь, колени мягкие; поднимитесь на носки максимальной амплитудой и опуститесь с контролем.',
    commonMistakeRu: 'Сгибать колени в такт и делать короткую амплитуду.',
    easierVariantRu: 'Выполняйте с собственным весом у опоры.',
    harderVariantRu: 'Добавьте паузу наверху на носках.',
    breathingRu: 'Выдох вверх, вдох вниз.',
    stopConditionsRu: 'Остановитесь при боли в ахилле или голеностопе.',
  },
  dead_bug_band: {
    techniqueRu:
      'Лёжа на спине, лента в руках над грудью; сохраняя поясницу прижатой, поочерёдно выпрямляйте противоположные руку и ногу.',
    commonMistakeRu: 'Отрывать поясницу от пола и задерживать дыхание.',
    easierVariantRu: 'Упростите до движения только ногами.',
    harderVariantRu: 'Замедлите фазу разгибания до 3 секунд.',
    breathingRu: 'Выдох при разгибании конечности, вдох при возврате.',
    stopConditionsRu: 'Остановитесь при боли в пояснице.',
  },
  russian_twist_bodyweight: {
    techniqueRu:
      'Сядьте, корпус отклонён назад, стопы на полу или слегка подняты; поворачивайте корпус из стороны в сторону без рывков.',
    commonMistakeRu: 'Крутить только руками при неподвижном корпусе.',
    easierVariantRu: 'Держите стопы на полу и уменьшите амплитуду.',
    harderVariantRu: 'Поднимите стопы и замедлите повороты.',
    breathingRu: 'Выдох на каждом повороте.',
    stopConditionsRu: 'Остановитесь при боли в пояснице или шее.',
  },
  hollow_body_hold: {
    techniqueRu:
      'Лёжа на спине, прижмите поясницу к полу; оторвите лопатки и ноги, руки вдоль ушей или вперёд, удерживайте форму «лодочки».',
    commonMistakeRu: 'Прогибать поясницу и задерживать дыхание.',
    easierVariantRu: 'Согните колени и удерживайте короче.',
    harderVariantRu: 'Выпрямите ноги ниже к полу без потери контакта поясницы.',
    breathingRu: 'Дышите коротко и ровно, сохраняя напряжение кора.',
    stopConditionsRu: 'Остановитесь при боли в пояснице или шее.',
  },
  band_good_morning: {
    techniqueRu:
      'Ленту на плечах/в руках с опорой под стопами; с мягкими коленями наклонитесь тазом назад до натяжения задней цепи и вернитесь.',
    commonMistakeRu: 'Округлять спину и сгибать только в пояснице.',
    easierVariantRu: 'Укоротите амплитуду наклона.',
    harderVariantRu: 'Замедлите негатив до 3 секунд.',
    breathingRu: 'Вдох вниз, выдох вверх.',
    stopConditionsRu: 'Остановитесь при боли в пояснице.',
  },
  scapular_retraction_hang: {
    techniqueRu:
      'Повисните на перекладине пассивным хватом; не сгибая локти, опустите и сведите лопатки, подняв корпус на миллиметры, затем отпустите в пассивный вис.',
    commonMistakeRu: 'Сгибать руки в локтях как в подтягивании.',
    easierVariantRu: 'Держите одну ногу на опоре для разгрузки.',
    harderVariantRu: 'Увеличьте паузу в активном висе.',
    breathingRu: 'Выдох при сведении лопаток, вдох в пассиве.',
    stopConditionsRu: 'Остановитесь при боли в плече или локте.',
  },
  suitcase_carry_kettlebell: {
    techniqueRu:
      'Возьмите гирю в одну руку сбоку; идите ровно, не заваливаясь в сторону нагрузки, плечи горизонтальны, корпус жёсткий.',
    commonMistakeRu: 'Наклоняться к гире и сутулиться.',
    easierVariantRu: 'Уменьшите вес и дистанцию.',
    harderVariantRu: 'Увеличьте вес или длину прохода.',
    breathingRu: 'Дышите ровно, сохраняя напряжение боковой стенки.',
    stopConditionsRu: 'Остановитесь при боли в пояснице или потере хвата.',
  },
  box_step_down: {
    techniqueRu:
      'Встаньте на тумбу; медленно шагайте одной ногой вниз, контролируя сгибание опорного колена, затем вернитесь на тумбу.',
    commonMistakeRu: 'Падать вниз без контроля и заваливать колено внутрь.',
    easierVariantRu: 'Используйте более низкую тумбу.',
    harderVariantRu: 'Замедлите спуск до 3–4 секунд.',
    breathingRu: 'Вдох вниз, выдох вверх.',
    stopConditionsRu: 'Остановитесь при боли в колене.',
  },
  glute_bridge_march_hold: {
    techniqueRu:
      'В мосте на двух ногах поднимите таз; удерживая таз высоким, поочерёдно отрывайте стопы от пола коротким «маршем».',
    commonMistakeRu: 'Опускать таз при каждом шаге и прогибать поясницу.',
    easierVariantRu: 'Удерживайте обычный ягодичный мост без марша.',
    harderVariantRu: 'Увеличьте паузу на одной ноге.',
    breathingRu: 'Дышите ровно, не теряя напряжение ягодиц.',
    stopConditionsRu: 'Остановитесь при боли в пояснице или крестце.',
  },
  machine_chest_fly: {
    techniqueRu:
      'Сядьте в пек-дек, лопатки к спинке; сведите рукояти перед грудью по дуге и контролируемо верните в растяжение.',
    commonMistakeRu: 'Сгибать локти как в жиме и отрывать лопатки.',
    easierVariantRu: 'Уменьшите вес и амплитуду разведения.',
    harderVariantRu: 'Пауза в сведённом положении.',
    breathingRu: 'Выдох при сведении, вдох при разведении.',
    stopConditionsRu: 'Остановитесь при боли в плече.',
  },
  hack_squat_machine: {
    techniqueRu:
      'Встаньте в гакк-тренажёр, спина к подушке, стопы на платформе; опуститесь в присед и выжмите платформу, не отрывая поясницу.',
    commonMistakeRu: 'Отрывать таз от подушки и сводить колени внутрь.',
    easierVariantRu: 'Уменьшите глубину и вес.',
    harderVariantRu: 'Пауза внизу 1 секунда.',
    breathingRu: 'Вдох вниз, выдох вверх.',
    stopConditionsRu: 'Остановитесь при боли в колене или пояснице.',
  },
  lateral_lunge: {
    techniqueRu:
      'Из стойки шагните в сторону, сгибайте рабочую ногу, таз назад, вторая нога прямая; оттолкнитесь и вернитесь в центр.',
    commonMistakeRu: 'Заваливать колено внутрь и округлять спину.',
    easierVariantRu: 'Укоротите шаг и глубину.',
    harderVariantRu: 'Замедлите опускание и добавьте паузу.',
    breathingRu: 'Вдох в сторону, выдох при возврате.',
    stopConditionsRu: 'Остановитесь при боли в колене или паху.',
  },
  shrug_dumbbell: {
    techniqueRu:
      'Стоя с гантелями по бокам, поднимите плечи строго вверх к ушам без вращения и медленно опустите.',
    commonMistakeRu: 'Крутить плечами и помогать руками сгибая локти.',
    easierVariantRu: 'Уменьшите вес.',
    harderVariantRu: 'Пауза 1–2 секунды наверху.',
    breathingRu: 'Выдох вверх, вдох вниз.',
    stopConditionsRu: 'Остановитесь при боли в шее или плече.',
  },
  front_raise_dumbbell: {
    techniqueRu:
      'Стоя, гантели перед бёдрами; поднимите руки перед собой до уровня плеч слегка согнутыми локтями и опустите под контролем.',
    commonMistakeRu: 'Раскачивать корпус и поднимать выше комфорта с рывком.',
    easierVariantRu: 'Поднимайте по одной руке с меньшим весом.',
    harderVariantRu: 'Замедлите опускание до 3 секунд.',
    breathingRu: 'Выдох вверх, вдох вниз.',
    stopConditionsRu: 'Остановитесь при боли в передней части плеча.',
  },
  cable_bicep_curl: {
    techniqueRu:
      'Встаньте у нижнего блока, локти у корпуса; сгибайте руки к плечам и медленно разгибайте, не раскачиваясь.',
    commonMistakeRu: 'Помогать корпусом и уводить локти вперёд.',
    easierVariantRu: 'Уменьшите вес.',
    harderVariantRu: 'Пауза вверху 1 секунда.',
    breathingRu: 'Выдох вверх, вдох вниз.',
    stopConditionsRu: 'Остановитесь при боли в локте.',
  },
  ez_bar_curl: {
    techniqueRu:
      'Возьмите EZ-гриф хватом по изгибам; сгибайте локти к плечам, удерживая локти у корпуса, и контролируемо опустите.',
    commonMistakeRu: 'Раскачиваться и разводить локти в стороны.',
    easierVariantRu: 'Уменьшите вес и амплитуду.',
    harderVariantRu: 'Медленный негатив 3 секунды.',
    breathingRu: 'Выдох вверх, вдох вниз.',
    stopConditionsRu: 'Остановитесь при боли в локте или запястье.',
  },
  bench_dip: {
    techniqueRu:
      'Оперевшись руками о скамью сзади, ноги вперед; согните локти и опустите таз, затем выжмите себя вверх, плечи стабильны.',
    commonMistakeRu: 'Опускаться слишком глубоко с провалом плеч вперёд.',
    easierVariantRu: 'Согните ноги и уменьшите глубину.',
    harderVariantRu: 'Выпрямите ноги дальше от скамьи.',
    breathingRu: 'Вдох вниз, выдох вверх.',
    stopConditionsRu: 'Остановитесь при боли в передней части плеча.',
  },
  upright_row_dumbbell: {
    techniqueRu:
      'Стоя, гантели перед бёдрами; тяните их вверх вдоль корпуса до уровня нижней части груди, локти выше кистей, без рывка.',
    commonMistakeRu: 'Поднимать выше плеч и зажимать шею.',
    easierVariantRu: 'Укоротите амплитуду до комфортной высоты.',
    harderVariantRu: 'Замедлите негатив.',
    breathingRu: 'Выдох вверх, вдох вниз.',
    stopConditionsRu: 'Остановитесь при боли или защемлении в плече.',
  },
  tibialis_raise: {
    techniqueRu:
      'Встаньте спиной/пятками к опоре или свободно; поднимайте носки стоп вверх, сохраняя пятки на полу, и медленно опустите.',
    commonMistakeRu: 'Помогать раскачкой корпуса и делать рывки.',
    easierVariantRu: 'Выполняйте сидя с меньшей амплитудой.',
    harderVariantRu: 'Пауза наверху 1–2 секунды.',
    breathingRu: 'Выдох вверх, вдох вниз.',
    stopConditionsRu: 'Остановитесь при боли в голени или голеностопе.',
  },
};

/** Fix typo-ish English in high_knees technique (keep RU clean). */
CONTENT.high_knees_easy.techniqueRu =
  'Бегите на месте, поднимая колени примерно к уровню бедра в контролируемом темпе, приземляясь мягко на переднюю часть стопы.';

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
  if (!req || req === 'NONE') {
    return [{ groupKind: 'ALL_OF', sortOrder: 0, items: [{ equipmentCode: 'NONE', sortOrder: 0 }] }];
  }
  if (req.includes('|OR_')) {
    const [left, rightRaw] = req.split('|OR_');
    const right = rightRaw;
    if (right.includes('+')) {
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

function muscles(primary, secondaryCsv, key) {
  const out = [{ muscleCode: primary, involvement: 'PRIMARY', sortOrder: 0 }];
  const secs = (secondaryCsv || '')
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean);
  const alias = {
    SHOULDERS: key.includes('front_raise') ? 'FRONT_DELTS' : 'SIDE_DELTS',
    LEGS: 'QUADS',
    CORE: 'ABS',
  };
  let i = 1;
  for (const s of secs) {
    const code = alias[s] ?? s;
    if (code === primary) continue;
    if (code === 'LEGS' || code === 'SHOULDERS' || code === 'CORE') continue;
    out.push({ muscleCode: code, involvement: 'SECONDARY', sortOrder: i++ });
  }
  return out;
}

function lit(v) {
  return JSON.stringify(v);
}

function emitEntry(row, overrides = {}) {
  const key = row.canonicalKey;
  const c = CONTENT[key];
  if (!c) throw new Error(`Missing CONTENT for ${key}`);
  const reps = (overrides.prescriptionMode ?? row.prescriptionMode) === 'DURATION';
  const equipmentGroups = overrides.equipmentGroups ?? parseEquipment(row.equipmentRequirement);
  const mus =
    overrides.muscles ?? muscles(row.primaryMuscle, row.secondaryMuscles, key);
  const places = (overrides.environment ?? row.environment).split('|').filter(Boolean);
  const trainingRole = overrides.trainingRole ?? row.trainingRole;
  const movementPattern = overrides.movementPattern ?? row.movementPattern;
  const progressionGroup = overrides.progressionGroup ?? row.progressionGroup;
  return `  {
    exerciseKey: ${lit(key)},
    nameRu: ${lit(overrides.nameRu ?? row.ruName)},
    nameEn: ${lit(overrides.nameEn ?? row.enAlias)},
    familySlug: ${lit(progressionGroup)},
    familyNameRu: ${lit(overrides.nameRu ?? row.ruName)},
    familyNameEn: ${lit(overrides.nameEn ?? row.enAlias)},
    primaryMovementPattern: ${lit(movementPattern)},
    trainingRole: ${lit(trainingRole)},
    difficulty: ${lit(row.difficulty)},
    progressionGroup: ${lit(progressionGroup)},
    generatorMovementPattern: ${lit(mapHubPattern(movementPattern))},
    repetitionMode: ${lit(overrides.prescriptionMode ?? row.prescriptionMode)},
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

function emitPolishEntry(key, fields) {
  return `  {
    exerciseKey: ${lit(key)},
    polishReason: ${lit(fields.polishReason)},
    nameRu: ${lit(fields.nameRu)},
    nameEn: ${lit(fields.nameEn)},
    primaryMovementPattern: ${lit(fields.primaryMovementPattern)},
    trainingRole: ${lit(fields.trainingRole)},
    progressionGroup: ${lit(fields.progressionGroup)},
    supportedPlaces: ${lit(fields.supportedPlaces)},
    muscles: ${lit(fields.muscles)},
    equipmentGroups: ${lit(fields.equipmentGroups)},
  }`;
}

function main() {
  const check = process.argv.includes('--check');
  const rows = parseCsv(fs.readFileSync(CSV, 'utf8'));
  const addMap = new Map(rows.filter((r) => r.status === 'ADD').map((r) => [r.canonicalKey, r]));
  for (const k of BATCH_B_KEYS) {
    if (!addMap.has(k)) throw new Error(`Batch B key not ADD in CSV: ${k}`);
    if (!CONTENT[k]) throw new Error(`Missing technique content: ${k}`);
  }
  if (new Set(BATCH_B_KEYS).size !== BATCH_B_KEYS.length) {
    throw new Error('Duplicate BATCH_B_KEYS');
  }

  /** Dedicated gym machines / cardio stations must not claim HOME. */
  const GYM_ONLY_KEYS = new Set([
    'row_erg_easy',
    'stair_climber_easy',
    'battle_rope_alternating',
    'sled_push_light',
    'hip_adduction_machine',
    'machine_chest_fly',
    'hack_squat_machine',
  ]);

  const entries = BATCH_B_KEYS.map((k) =>
    emitEntry(addMap.get(k), GYM_ONLY_KEYS.has(k) ? { environment: 'GYM' } : {}),
  );
  const held = BATCH_B_HELD.map(
    (h) => `  { exerciseKey: ${lit(h.key)}, reason: ${lit(h.reason)} }`,
  );

  const polish = [
    emitPolishEntry('bulgarian_split_squat', {
      polishReason:
        'RFE Bulgarian split squat requires elevated support (BENCH), not BODYWEIGHT-only with OPTIONAL bench',
      nameRu: 'Болгарский сплит-присед',
      nameEn: 'Bulgarian split squat',
      primaryMovementPattern: 'LUNGE',
      trainingRole: 'MAIN',
      progressionGroup: 'bulgarian',
      supportedPlaces: ['HOME', 'GYM'],
      muscles: [
        { muscleCode: 'QUADS', involvement: 'PRIMARY', sortOrder: 0 },
        { muscleCode: 'GLUTES', involvement: 'SECONDARY', sortOrder: 1 },
      ],
      equipmentGroups: [
        {
          groupKind: 'ALL_OF',
          sortOrder: 0,
          items: [
            { equipmentCode: 'BODYWEIGHT', sortOrder: 0 },
            { equipmentCode: 'BENCH', sortOrder: 1 },
          ],
        },
        {
          groupKind: 'OPTIONAL',
          sortOrder: 1,
          items: [{ equipmentCode: 'DUMBBELL', sortOrder: 0 }],
        },
      ],
    }),
    emitPolishEntry('chin_up', {
      polishReason: 'Add UPPER_BACK secondary — scapular retraction is mechanically involved',
      nameRu: 'Подтягивания обратным хватом',
      nameEn: 'Chin-up',
      primaryMovementPattern: 'VERTICAL_PULL',
      trainingRole: 'MAIN',
      progressionGroup: 'chin',
      supportedPlaces: ['HOME', 'GYM'],
      muscles: [
        { muscleCode: 'LATS', involvement: 'PRIMARY', sortOrder: 0 },
        { muscleCode: 'BICEPS', involvement: 'SECONDARY', sortOrder: 1 },
        { muscleCode: 'UPPER_BACK', involvement: 'SECONDARY', sortOrder: 2 },
      ],
      equipmentGroups: [
        {
          groupKind: 'ALL_OF',
          sortOrder: 0,
          items: [{ equipmentCode: 'PULL_UP_BAR', sortOrder: 0 }],
        },
      ],
    }),
    emitPolishEntry('dumbbell_fly', {
      polishReason: 'Add FRONT_DELTS secondary — shoulder flexion assists the fly arc',
      nameRu: 'Разведения гантелей лёжа',
      nameEn: 'Dumbbell fly',
      primaryMovementPattern: 'HORIZONTAL_PUSH',
      trainingRole: 'ISOLATION',
      progressionGroup: 'dumbbell',
      supportedPlaces: ['HOME', 'GYM'],
      muscles: [
        { muscleCode: 'CHEST', involvement: 'PRIMARY', sortOrder: 0 },
        { muscleCode: 'FRONT_DELTS', involvement: 'SECONDARY', sortOrder: 1 },
      ],
      equipmentGroups: [
        {
          groupKind: 'ALL_OF',
          sortOrder: 0,
          items: [
            { equipmentCode: 'DUMBBELL', sortOrder: 0 },
            { equipmentCode: 'BENCH', sortOrder: 1 },
          ],
        },
      ],
    }),
  ];

  const body = `/**
 * CATALOG-V3-01C-B — Batch B NEW content + Batch A pre-publish polish SoT.
 * Generated from WORKOUT-CATALOG-V3-SCOPE-01/04_TARGET_CATALOG_V3.csv (status=ADD).
 * Regenerator: node apps/api/scripts/generate-catalog-v3-01c-b-content.mjs
 * Do not invent UNKNOWN readiness / Energy / Timing / Media.
 */
import type { V3EquipmentGroupDraft, V3MuscleInvolvementDraft } from './catalog-v3-taxonomy';

export const CATALOG_V3_01C_B_VERSION = 'workout-catalog-v3-01c-b.1' as const;
export const CATALOG_V3_01C_B_CREATED_BY = 'system:catalog-v3-01c-b' as const;
export const CATALOG_V3_01C_B_ADVISORY_LOCK_KEY = 219_01_004;
export const CATALOG_V3_01C_B_EXPECTED_COUNT = ${BATCH_B_KEYS.length} as const;
export const CATALOG_V3_01C_B_POLISH_EXPECTED_COUNT = 3 as const;
export const CATALOG_V3_01C_B_DEPRECATE_EXPECTED_COUNT = 1 as const;

export const V3_01C_B_DIFFICULTIES = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED'] as const;
export type V301cBDifficulty = (typeof V3_01C_B_DIFFICULTIES)[number];

export type V301cBHeldEntry = {
  exerciseKey: string;
  reason: string;
};

export type V301cBContentEntry = {
  exerciseKey: string;
  nameRu: string;
  nameEn: string;
  familySlug: string;
  familyNameRu: string;
  familyNameEn: string;
  primaryMovementPattern: string;
  trainingRole: string;
  difficulty: V301cBDifficulty;
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

/** Successor-revision polish for ever-APPROVED Batch A rows (immutable taxonomy). */
export type V301cBPolishEntry = {
  exerciseKey: string;
  polishReason: string;
  nameRu: string;
  nameEn: string;
  primaryMovementPattern: string;
  trainingRole: string;
  progressionGroup: string;
  supportedPlaces: readonly string[];
  muscles: readonly V3MuscleInvolvementDraft[];
  equipmentGroups: readonly V3EquipmentGroupDraft[];
};

export type V301cBDeprecationEntry = {
  exerciseKey: string;
  reason: string;
  mergeIntoKey: string;
};

export const CATALOG_V3_01C_B_HELD: readonly V301cBHeldEntry[] = [
${held.join(',\n')}
];

export const CATALOG_V3_01C_B_DEPRECATIONS: readonly V301cBDeprecationEntry[] = [
  {
    exerciseKey: 'lat_pulldown_wide',
    reason:
      'NOT_JUSTIFIED_CANONICAL_IDENTITY: wide-grip machine pulldown is a grip micro-variant of published lat_pulldown (neutral-grip already separate as lat_pulldown_neutral_grip). HOME+LAT_PULLDOWN place/equipment inconsistency is closed by deprecation rather than inventing a duplicate identity.',
    mergeIntoKey: 'lat_pulldown',
  },
];

export const CATALOG_V3_01C_B_POLISH: readonly V301cBPolishEntry[] = [
${polish.join(',\n')}
];

export const CATALOG_V3_01C_B_CONTENT: readonly V301cBContentEntry[] = [
${entries.join(',\n')}
];
`;

  if (check) {
    const existing = fs.readFileSync(OUT, 'utf8');
    if (existing !== body) {
      console.error('CATALOG-V3-01C-B content SoT is stale; regenerate.');
      process.exit(1);
    }
    console.info('CATALOG-V3-01C-B content SoT check passed:', BATCH_B_KEYS.length);
    return;
  }
  fs.writeFileSync(OUT, body, 'utf8');
  console.info('Wrote', OUT, 'entries=', BATCH_B_KEYS.length);
}

main();
