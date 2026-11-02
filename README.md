# Zuma Rally — زوما رالي

لعبة سباقات رالي ثلاثية الأبعاد بالعربية، تُبنى بـ Three.js داخل TanStack Start، وتعمل أيضاً كتطبيق أندرويد (WebView) من نفس الكود.

**النسخة الحية**: https://zumarace.lovable.app

## المميزات

- **100 مرحلة** حملة بتدرّج صعوبة ومكافآت عملات.
- **7 بيئات سباق**: صحراء، غابة، وادٍ صخري، ثلوج، ساحل، جبال، و**مدينة ليلية** (أسفلت بأرصفة نيون، مراحلها تُقام ليلاً أو عند الغروب، مع أبراج بنوافذ مضيئة وأعمدة إنارة متوهجة).
- **10 سيارات** بأسماء وقدرات مميزة — أحدثها **كوبيه كهربائية GT-E** بقدرة «شحن كبحي متجدد» (شحن تيربو أسرع وتسارع كهربائي فوري).
- **طقس ووقت ديناميكي**: مطر وضباب وثلوج وعواصف رملية وبرق، وسماء تتحرك من الفجر إلى النجوم، وطرق مبللة تنعكس عليها الإضاءة.
- **ملّاح (Co-Driver)** يقرأ المنعطفات بصوت و إشارات، وكاميرات متعددة قابلة للتبديل.
- **واقعية بصرية**: انعكاسات إضاءة بيئية (IBL) على طلاء السيارات اللامع والزجاج والمعدن، كشافات ليلية حقيقية، ظلال ناعمة، ونغمات سينمائية (ACES).
- **جراج كامل**: شراء سيارات وترقيات محرك وإطارات ووحدات تيربو وتخصيص الطلاء والجنوط والكسوة، وسائقون قابلين للاختيار.
- شاشة بداية تعرض إحصائيات الحملة والمرحلة القادمة وظروفها وطاقمك وسيارتك.

## Development

This project was built with [Lovable](https://lovable.dev). Continue developing it in the [Lovable editor](https://lovable.dev/projects/659ea5e8-8810-4f54-9ca8-865326ac9c97) — pushes to `main` on GitHub sync back into Lovable.

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
npm test        # vitest — game rules in src/zuma/game/rally-rules.test.ts
```
