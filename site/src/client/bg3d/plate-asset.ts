/**
 * Пути к фото-пластине машины (круг 35, задание №62).
 *
 * Вынесены в отдельный модуль, чтобы не тянуть разметку в движок: пути — это данные
 * сборки, а не логика кадра. Файлы собирает `tools/bg3d/make-car-plate.mjs`
 * (вход — docs/brand/voyah/refs/r31/side-black.webp, см. отчёт r35-bg-car).
 *
 * Обе ширины кратны содержанию (пластина не растягивается): 1600 для десктопа,
 * 800 для узкого экрана — на 390 px CSS × dpr 2 это 780 px, то есть почти 1:1.
 */
export const PLATE_SRC = '/img/bg3d/car-1600.webp';
export const PLATE_SRCSET = ['/img/bg3d/car-800.webp', PLATE_SRC] as const;
