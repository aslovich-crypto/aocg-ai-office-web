# AOCG AI Офис — фронтенд

Фронтенд платформы AOCG AI Офис: B2B SaaS для российского малого и среднего бизнеса. Управление первичными финансовыми документами и управленческим учётом. Мобильно-ориентированный интерфейс по образцу банковских приложений.

## Стек
- React + Vite
- lucide-react (иконки), recharts (графики), jsqr (QR)
- Inter Variable (self-hosted)
- Railway (хостинг, auto-deploy из main)

## Запуск локально
```bash
npm run dev
```
Открывается на `http://localhost:5173` с hot-reload.

## Сборка
```bash
npm run build
```

## Структура
```
src/App.jsx        весь UI, компоненты, роутинг (state-based)
index.html         Inter, viewport-fit=cover
vite.config.js     allowedHosts
```

## Дизайн-система
- Бренд: вишнёвый `#A4161A`
- Cool Neutrals, шрифт Inter
- Финансовые числа: tabular-nums
- Полные правила — в `CLAUDE.md` и проектной документации (дизайн-система)

## Переменные окружения
Список — в `.env.example`. Реальные значения в Railway → Variables, в репозиторий не коммитятся.

## Документация
- `docs/development-workflow.md` — цикл разработки
- `docs/prompting-guide.md` — постановка задач агенту
- `CLAUDE.md` — постоянные правила для AI-агента

## Деплой
Push в `main` → Railway пересобирает и деплоит автоматически за 1–2 минуты.
