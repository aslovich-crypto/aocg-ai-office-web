// Сторож ограничений камеры живого сканера: разрешение, объектив, фонарик.
//
// ⚠️ ЗАЧЕМ. Замер 17–18.09.2026 пробой public/proba-kamery.html: без явных
// width/height ОБА движка — Chromium на Samsung S24+ и WebKit на iPhone —
// отдают сканеру 640×480 при камере 4000×3000, и картинка плывёт при
// исправном автофокусе. На Samsung вдобавок по facingMode:"environment"
// Chrome отдаёт «camera 2, facing back» без непрерывного автофокуса
// (focusMode:["manual"], резкость 528–748), хотя «camera 0» фокусируется
// (3015–3638 на том же чеке, том же расстоянии). Обе правки — числа в объекте
// ограничений и ветка переключения объектива — снимаются следующим
// редизайном «для чистоты» в одну строку: ровно так 17.05.2026 (497338a)
// ушёл aspectRatio — без замера и без слова в коммите.
//
// ЧТО СТЕРЕЖЁТ — три свойства src/pages/ScanReceiptModal.jsx, на каждое
// своя мутация (scripts/camera-mutations.mjs):
//   ① каждое ограничение, уходящее в html5-qrcode как videoConstraints,
//     просит width/height `ideal` не ниже 1280×720 — и сами числа, и то,
//     что они приложены к КАЖДОМУ запуску: и по facingMode, и по deviceId;
//   ② ветка переключения объектива на месте: перечисление камер
//     (enumerateDevices), решение по focusMode/"continuous" дорожки и запуск
//     по deviceId:{exact}. Имя функции выбора НЕ проверяется — переименование
//     законно, исчезновение ветки — нет;
//   ③ фонарик берётся из capabilities текущей дорожки
//     (getRunningTrackCapabilities → ….torch), а не из константы: после
//     переключения объектива набор возможностей другой.
//
// Комментарии вырезаются до проверки: в них законно цитировать снятое,
// и сторож не должен зеленеть от слов в комментарии при снятом коде.
//
// ЧЕГО НЕ ВИДИТ: ① что телефон РЕАЛЬНО отдал — ограничение лишь просьба,
// ответ мерится пробой на устройстве (proba-kamery.html, вариант Б);
// ② обезвреженную, но не удалённую ветку — ранний return перед
// переключением сторож по тексту не отличит. Это тоже ловит только проба.
//
// КОДЫ ВЫХОДА: 0 — все три свойства на месте; 1 — свойство снято или
// ослаблено; 2 — ПРОВЕРКА НЕ ВЫПОЛНЕНА (файла нет либо ни одного запуска
// камеры не найдено — структура изменилась, сторож надо перечитать).
// «Не проверял» не смешивается с «чисто».
//
// ЗАПУСК: node scripts/check-camera-constraints.mjs [--verbose]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const КОРЕНЬ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ПОДРОБНО = process.argv.includes("--verbose");
const ФАЙЛ = "src/pages/ScanReceiptModal.jsx";
const МИН_ШИРИНА = 1280;
const МИН_ВЫСОТА = 720;

console.log("\nОГРАНИЧЕНИЯ КАМЕРЫ СКАНЕРА");

const отказ = (текст) => {
  console.log(`  ⚠️ ПРОВЕРКА НЕ ВЫПОЛНЕНА: ${текст}`);
  process.exit(2);
};

const полный = path.join(КОРЕНЬ, ФАЙЛ);
// ⚠️ Сначала — что файл ЕСТЬ: проверка несуществующего молча даёт «чисто».
if (!fs.existsSync(полный)) отказ(`нет файла ${ФАЙЛ}`);
const исходник = fs.readFileSync(полный, "utf8");

// Комментарии вон: блочные целиком; строчные — те, что начинаются строкой
// или стоят после кода через пробел («код; // …»). «https://…» внутри
// строки остаётся: там перед // нет пробела.
const код = исходник
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .map((с) => с.replace(/^\s*\/\/.*$/, "").replace(/\s+\/\/\s.*$/, ""))
  .join("\n");

const беды = [];

// ─── ① Разрешение ─────────────────────────────────────────────────
// Ограничения уходят в библиотеку только через ключ videoConstraints;
// без него html5-qrcode строит их сама — из одного facingMode, без размера.
if (!/\bvideoConstraints\s*[,:}]/.test(код)) {
  console.log("  ✗ videoConstraints не передаётся в html5-qrcode");
  беды.push("videoConstraints");
} else if (ПОДРОБНО) console.log("  ✓ videoConstraints передаётся");

// Объекты разрешения: const X = { width: { ideal: N }, height: { ideal: M } }
const разрешения = new Map();
for (const м of код.matchAll(
  /const\s+(\w+)\s*=\s*\{\s*width:\s*\{\s*ideal:\s*(\d+)\s*\},\s*height:\s*\{\s*ideal:\s*(\d+)\s*\}\s*\}/g,
))
  разрешения.set(м[1], { w: Number(м[2]), h: Number(м[3]) });

// Первый аргумент .start(...) библиотека при videoConstraints не читает —
// он остаётся ради сигнатуры и ограничением не является. Вырезаем ДО
// поиска, иначе сторож потребует разрешение от заглушки.
const безЗаглушки = код.replace(/\.start\(\s*\{[^{}]*\}\s*,/g, ".start(");

// Литералы ограничений: объект с facingMode либо deviceId:{exact}.
const литералы = [
  ...безЗаглушки.matchAll(
    /\{[^{}]*?(?:facingMode:|deviceId:\s*\{[^{}]*\})[^{}]*\}/g,
  ),
].map((м) => м[0].replace(/\s+/g, " ").trim());
if (!литералы.length)
  отказ("ни одного запуска камеры с facingMode/deviceId не найдено");

const годен = ({ w, h }) => w >= МИН_ШИРИНА && h >= МИН_ВЫСОТА;
function разрешениеЛитерала(л) {
  const inline = (l) => {
    const w = /width:\s*\{\s*ideal:\s*(\d+)/.exec(l);
    const h = /height:\s*\{\s*ideal:\s*(\d+)/.exec(l);
    return w && h ? { w: Number(w[1]), h: Number(h[1]) } : null;
  };
  const своё = inline(л);
  if (своё) return своё;
  for (const м of л.matchAll(/\.\.\.(\w+)/g))
    if (разрешения.has(м[1])) return разрешения.get(м[1]);
  return null;
}

let сРазрешением = 0;
let поFacing = 0;
let поDevice = 0;
for (const л of литералы) {
  if (/facingMode:/.test(л)) поFacing++;
  if (/deviceId:/.test(л)) поDevice++;
  const р = разрешениеЛитерала(л);
  const ок = !!р && годен(р);
  if (ок) сРазрешением++;
  if (!ок || ПОДРОБНО)
    console.log(
      `  ${ок ? "✓" : "✗"} ${л}` +
        (р
          ? ` → ${р.w}×${р.h}${ок ? "" : ` — ниже ${МИН_ШИРИНА}×${МИН_ВЫСОТА}`}`
          : " — без width/height ideal"),
    );
  if (!ок) беды.push(л);
}
console.log(
  `  ${сРазрешением === литералы.length ? "✓" : "✗"} запусков камеры ${
    литералы.length
  }` +
    ` (facingMode ${поFacing}, deviceId ${поDevice}), с разрешением ≥ ` +
    `${МИН_ШИРИНА}×${МИН_ВЫСОТА}: ${сРазрешением}`,
);

// ─── ② Переключение объектива ────────────────────────────────────
const перечисление = /\benumerateDevices\s*\(/.test(код);
const решение = /\bfocusMode\b/.test(код) && /"continuous"/.test(код);
const запускПоId = поDevice > 0;
const ветка = перечисление && решение && запускПоId;
console.log(
  `  ${ветка ? "✓" : "✗"} переключение объектива: enumerateDevices ${
    перечисление ? "есть" : "НЕТ"
  }` +
    ` · решение по focusMode/"continuous" ${решение ? "есть" : "НЕТ"}` +
    ` · запуск по deviceId ${запускПоId ? "есть" : "НЕТ"}`,
);
if (!ветка) беды.push("переключение объектива");

// ─── ③ Фонарик ──────────────────────────────────────────────────
const изДорожки = /\bgetRunningTrackCapabilities\b/.test(код);
const вызовы = [...код.matchAll(/setTorchSupported\(([^)]*)\)/g)].map((м) =>
  м[1].trim(),
);
const изCaps = вызовы.filter((а) => /\.torch\b/.test(а));
const константойВкл = вызовы.filter((а) => а === "true");
const фонарь = изДорожки && изCaps.length > 0 && константойВкл.length === 0;
console.log(
  `  ${фонарь ? "✓" : "✗"} фонарик: вызовов setTorchSupported ${
    вызовы.length
  }` +
    `, из capabilities дорожки ${изCaps.length}` +
    (константойВкл.length ? `, КОНСТАНТОЙ true ${константойВкл.length}` : "") +
    (изДорожки ? "" : ", getRunningTrackCapabilities НЕТ"),
);
if (ПОДРОБНО)
  for (const а of вызовы) console.log(`      setTorchSupported(${а})`);
if (!фонарь) беды.push("фонарик");

if (беды.length) {
  console.log(
    `\n  ✗ ОГРАНИЧЕНИЯ КАМЕРЫ ОСЛАБЛЕНЫ: ${беды.join(" · ")}\n` +
      "    Без width/height ideal телефон отдаёт 640×480 и картинка плывёт; без\n" +
      "    переключения объектива Samsung снимает камерой без автофокуса; фонарик\n" +
      "    не из capabilities — врёт после смены объектива. Замер и довод —\n" +
      "    в комментариях у startCamera и в шапке этого сторожа.",
  );
  process.exit(1);
}
// Итоговая строка обязательна и в зелёном исходе: по ней набор мутаций
// отличает вердикт от падения — упавший Node тоже выходит с кодом 1.
console.log("\n  ✓ ОГРАНИЧЕНИЯ КАМЕРЫ НА МЕСТЕ");
