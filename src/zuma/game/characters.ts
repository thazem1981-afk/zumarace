/** Driver characters, the co-driver and named rival crews. Pure data, no rendering. */

export type DriverId = 'salem' | 'layla' | 'karim'
export type Driver = Readonly<{
  id: DriverId
  name: string
  origin: string
  bio: string
  perk: string
  /** Small multipliers applied on top of the car. */
  acceleration: number
  steering: number
  wetGrip: number
  turboRecharge: number
  suit: string
}>

export const DRIVERS: readonly Driver[] = Object.freeze([
  { id: 'salem', name: 'سالم الحربي', origin: 'بطل رالي الصحراء', bio: 'خبير الكثبان، يعرف كيف يخرج من المنعطف بأقصى عزم.', perk: 'تسارع +٦٪', acceleration: 1.06, steering: 1, wetGrip: 1, turboRecharge: 1, suit: '#e5822f' },
  { id: 'layla', name: 'ليلى الحسن', origin: 'متخصصة طرق الجبال', bio: 'دقيقة في المنعطفات الضيقة وهادئة تحت الضغط.', perk: 'توجيه +٨٪', acceleration: 1, steering: 1.08, wetGrip: 1, turboRecharge: 1, suit: '#1f6f73' },
  { id: 'karim', name: 'كريم ناصر', origin: 'نجم الطين والثلج', bio: 'يقود بجرأة على الطرق الزلقة ويعيد شحن التيربو بسرعة.', perk: 'تماسك في المطر والثلج +١٢٪ · شحن تيربو +١٠٪', acceleration: 1, steering: 1, wetGrip: 1.12, turboRecharge: 1.1, suit: '#c8372d' },
])

export const CO_DRIVER = Object.freeze({ name: 'مازن العلي', role: 'الملّاح · قارئ الملاحظات' })

export const RIVAL_DRIVERS: readonly string[] = Object.freeze([
  'فهد القحطاني', 'يوسف بن علي', 'سارة المنصور', 'عمر الشامي', 'خالد العتيبي', 'ريم الزهراني',
])

export function driverById(id: string | undefined): Driver {
  return DRIVERS.find(d => d.id === id) ?? DRIVERS[0]
}
