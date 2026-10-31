import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Zuma Rally — رالي ثلاثي الأبعاد بطقس متغيّر" },
      { name: "description", content: "قد سيارتك في 100 مرحلة رالي بين الصحراء والغابات والثلوج والجبال والسواحل، مع طقس وليل ونهار وملّاح يقرأ المنعطفات." },
      { property: "og:title", content: "Zuma Rally — رالي ثلاثي الأبعاد" },
      { property: "og:description", content: "100 مرحلة رالي بطقس ديناميكي وكاميرات متعددة وملّاح وكراج لتخصيص السيارات." },
    ],
  }),
  component: Game,
});

function Game() {
  useEffect(() => {
    import("../zuma/main-rally").then((m) => m.boot()).catch((error) => {
      console.error(error);
      const root = document.getElementById("ui");
      if (root) root.innerHTML = '<div class="fatal">تعذّر تشغيل اللعبة. أعد تحميل الصفحة للمحاولة مرة أخرى.</div>';
    });
  }, []);
  return (
    <>
      <canvas id="game" aria-label="مضمار رالي ثلاثي الأبعاد" />
      <div id="ui" />
    </>
  );
}
