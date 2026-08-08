import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const outputIndex = process.argv.indexOf('--output');
const outputPath = resolve(
  process.cwd(),
  outputIndex >= 0 ? process.argv[outputIndex + 1] : 'docs/STUDENT_HANDBOOK_RU.pdf',
);

const GLYPHS = Object.freeze({
  ' ': ['00000','00000','00000','00000','00000','00000','00000'],
  'А': ['01110','10001','10001','11111','10001','10001','10001'],
  'Б': ['11111','10000','10000','11110','10001','10001','11110'],
  'В': ['11110','10001','10001','11110','10001','10001','11110'],
  'Г': ['11111','10000','10000','10000','10000','10000','10000'],
  'Д': ['00110','01010','01010','10010','10010','11111','10001'],
  'Е': ['11111','10000','10000','11110','10000','10000','11111'],
  'Ё': ['01010','00000','11111','10000','11110','10000','11111'],
  'Ж': ['10101','10101','01110','00100','01110','10101','10101'],
  'З': ['11110','00001','00001','01110','00001','00001','11110'],
  'И': ['10001','10011','10101','10101','11001','10001','10001'],
  'Й': ['01010','00100','10011','10101','11001','10001','10001'],
  'К': ['10001','10010','10100','11000','10100','10010','10001'],
  'Л': ['00111','01001','01001','10001','10001','10001','10001'],
  'М': ['10001','11011','10101','10101','10001','10001','10001'],
  'Н': ['10001','10001','10001','11111','10001','10001','10001'],
  'О': ['01110','10001','10001','10001','10001','10001','01110'],
  'П': ['11111','10001','10001','10001','10001','10001','10001'],
  'Р': ['11110','10001','10001','11110','10000','10000','10000'],
  'С': ['01111','10000','10000','10000','10000','10000','01111'],
  'Т': ['11111','00100','00100','00100','00100','00100','00100'],
  'У': ['10001','10001','10001','01111','00001','00001','11110'],
  'Ф': ['00100','01110','10101','10101','01110','00100','00100'],
  'Х': ['10001','10001','01010','00100','01010','10001','10001'],
  'Ц': ['10001','10001','10001','10001','10001','11111','00001'],
  'Ч': ['10001','10001','10001','01111','00001','00001','00001'],
  'Ш': ['10101','10101','10101','10101','10101','10101','11111'],
  'Щ': ['10101','10101','10101','10101','10101','11111','00001'],
  'Ъ': ['11000','01000','01000','01110','01001','01001','01110'],
  'Ы': ['10001','10001','10001','11101','10011','10011','11101'],
  'Ь': ['10000','10000','10000','11110','10001','10001','11110'],
  'Э': ['11110','00001','00001','01111','00001','00001','11110'],
  'Ю': ['10110','11001','11001','11001','11001','11001','10110'],
  'Я': ['01111','10001','10001','01111','00101','01001','10001'],
  'A': ['01110','10001','10001','11111','10001','10001','10001'],
  'B': ['11110','10001','10001','11110','10001','10001','11110'],
  'C': ['01111','10000','10000','10000','10000','10000','01111'],
  'D': ['11110','10001','10001','10001','10001','10001','11110'],
  'E': ['11111','10000','10000','11110','10000','10000','11111'],
  'F': ['11111','10000','10000','11110','10000','10000','10000'],
  'G': ['01111','10000','10000','10111','10001','10001','01111'],
  'H': ['10001','10001','10001','11111','10001','10001','10001'],
  'I': ['11111','00100','00100','00100','00100','00100','11111'],
  'J': ['00111','00010','00010','00010','10010','10010','01100'],
  'K': ['10001','10010','10100','11000','10100','10010','10001'],
  'L': ['10000','10000','10000','10000','10000','10000','11111'],
  'M': ['10001','11011','10101','10101','10001','10001','10001'],
  'N': ['10001','11001','10101','10011','10001','10001','10001'],
  'O': ['01110','10001','10001','10001','10001','10001','01110'],
  'P': ['11110','10001','10001','11110','10000','10000','10000'],
  'Q': ['01110','10001','10001','10001','10101','10010','01101'],
  'R': ['11110','10001','10001','11110','10100','10010','10001'],
  'S': ['01111','10000','10000','01110','00001','00001','11110'],
  'T': ['11111','00100','00100','00100','00100','00100','00100'],
  'U': ['10001','10001','10001','10001','10001','10001','01110'],
  'V': ['10001','10001','10001','10001','10001','01010','00100'],
  'W': ['10001','10001','10001','10101','10101','11011','10001'],
  'X': ['10001','10001','01010','00100','01010','10001','10001'],
  'Y': ['10001','10001','01010','00100','00100','00100','00100'],
  'Z': ['11111','00001','00010','00100','01000','10000','11111'],
  '0': ['01110','10001','10011','10101','11001','10001','01110'],
  '1': ['00100','01100','00100','00100','00100','00100','01110'],
  '2': ['01110','10001','00001','00010','00100','01000','11111'],
  '3': ['11110','00001','00001','01110','00001','00001','11110'],
  '4': ['00010','00110','01010','10010','11111','00010','00010'],
  '5': ['11111','10000','10000','11110','00001','00001','11110'],
  '6': ['01110','10000','10000','11110','10001','10001','01110'],
  '7': ['11111','00001','00010','00100','01000','01000','01000'],
  '8': ['01110','10001','10001','01110','10001','10001','01110'],
  '9': ['01110','10001','10001','01111','00001','00001','01110'],
  '-': ['00000','00000','00000','11111','00000','00000','00000'],
  '+': ['00000','00100','00100','11111','00100','00100','00000'],
  ':': ['00000','00100','00100','00000','00100','00100','00000'],
  '.': ['00000','00000','00000','00000','00000','00110','00110'],
  ',': ['00000','00000','00000','00000','00110','00110','00100'],
  '/': ['00001','00010','00010','00100','01000','01000','10000'],
  '(': ['00010','00100','01000','01000','01000','00100','00010'],
  ')': ['01000','00100','00010','00010','00010','00100','01000'],
  '?': ['01110','10001','00001','00010','00100','00000','00100'],
  '!': ['00100','00100','00100','00100','00100','00000','00100'],
  '=': ['00000','11111','00000','11111','00000','00000','00000'],
  '×': ['00000','10001','01010','00100','01010','10001','00000'],
  '→': ['00000','00100','00010','11111','00010','00100','00000'],
});

const PAGES = [
  {
    title: 'CANYON CHARMS + SWARMFORGE',
    subtitle: 'УЧЕБНОЕ РУКОВОДСТВО ДЛЯ ШКОЛЬНОЙ КОМАНДЫ',
    paragraphs: [
      'КАК ПРЕВРАТИТЬ ИДЕЮ КАЗУАЛЬНОЙ ИГРЫ В ПРОВЕРЯЕМЫЙ ПРОЕКТ: СПЕЦИФИКАЦИЯ, ТЕСТЫ, ЧИСТОЕ ЯДРО, ГРАФИКА, QA И ПУБЛИКАЦИЯ.',
      'CANYON CHARMS - ОРИГИНАЛЬНАЯ MATCH-3 ИГРА. ВСЕ ВИЗУАЛЬНЫЕ ЭЛЕМЕНТЫ И ЗВУК СОЗДАЮТСЯ ПРОГРАММНО.',
    ],
    callout: 'ГЛАВНЫЙ ПРИНЦИП: ДОКАЗАТЕЛЬСТВА ПЕРЕД ОБЕЩАНИЯМИ.',
  },
  {
    title: '1. КОМАНДА SWARMFORGE',
    subtitle: 'ЧЕТЫРЕ РОЛИ - ОДИН ПРОВЕРЯЕМЫЙ РЕЗУЛЬТАТ',
    paragraphs: [
      'DIRECTOR УТОЧНЯЕТ ЦЕЛЬ, ДЕЛИТ РАБОТУ НА МАЛЕНЬКИЕ СРЕЗЫ, ПРОВЕРЯЕТ DIFF И РЕШАЕТ КОГДА МОЖНО MERGE.',
      'GAMEPLAY ОТВЕЧАЕТ ЗА SEED, ПОЛЕ, ХОДЫ, СОВПАДЕНИЯ, КАСКАДЫ, ОЧКИ И ПОБЕДУ. ОН НАЧИНАЕТ С ПАДАЮЩЕГО ТЕСТА.',
      'PRESENTATION ОТВЕЧАЕТ ЗА CANVAS, АНИМАЦИЮ, ЗВУК, TOUCH, KEYBOARD И DOM-МЕНЮ. ОНА НЕ ДУБЛИРУЕТ ПРАВИЛА.',
      'QA ПРОХОДИТ ИГРУ КАК ИГРОК, ПРОВЕРЯЕТ PHONE И DESKTOP, СБОРКУ, АРТЕФАКТЫ И ЧЕСТНО ФИКСИРУЕТ БЛОКЕРЫ.',
    ],
    flow: ['DIRECTOR', 'GAMEPLAY', 'PRESENTATION', 'QA', 'DIRECTOR'],
  },
  {
    title: '2. ЦИКЛ RED - GREEN - REVIEW',
    subtitle: 'МАЛЕНЬКИЙ ШАГ ЛЕГЧЕ ПРОВЕРИТЬ И БЕЗОПАСНЕЕ СЛИТЬ',
    paragraphs: [
      'СНАЧАЛА ФОРМУЛИРУЕМ НАБЛЮДАЕМЫЙ РЕЗУЛЬТАТ. ПРИМЕР: НЕВЕРНАЯ ПЕРЕСТАНОВКА ВОЗВРАЩАЕТСЯ И НЕ ТРАТИТ ХОД.',
      'ЗАТЕМ ПИШЕМ ТЕСТ И ОБЯЗАТЕЛЬНО ВИДИМ ПРАВИЛЬНОЕ ПАДЕНИЕ. ПОСЛЕ ЭТОГО ДОБАВЛЯЕМ МИНИМАЛЬНЫЙ КОД И СНОВА ЗАПУСКАЕМ ПРОВЕРКУ.',
      'КОГДА ТЕСТ ЗЕЛЁНЫЙ, УЛУЧШАЕМ ИМЕНА И СТРУКТУРУ, НЕ МЕНЯЯ ПОВЕДЕНИЕ. QA ПОВТОРЯЕТ СЦЕНАРИЙ В БРАУЗЕРЕ.',
    ],
    flow: ['ПРИМЕР', 'RED', 'GREEN', 'REVIEW', 'COMMIT'],
  },
  {
    title: '3. ЧИСТОЕ ИГРОВОЕ ЯДРО',
    subtitle: 'ПРАВИЛА НЕ ЗНАЮТ О CANVAS, DOM, ЗВУКЕ И SDK',
    paragraphs: [
      'ФУНКЦИЯ ATTEMPTSWAP ПОЛУЧАЕТ ОБЫЧНОЕ СОСТОЯНИЕ И ДВА ИНДЕКСА. ОНА ВОЗВРАЩАЕТ НОВОЕ СОСТОЯНИЕ И СЕМАНТИЧЕСКИЕ ФАЗЫ.',
      'РЕНДЕРЕР МОЖНО ЗАМЕНИТЬ НА PHASER. ТЕСТЫ ПРАВИЛ ОСТАНУТСЯ ПРЕЖНИМИ. ЭТО И ЕСТЬ СИЛА ХОРОШЕЙ ГРАНИЦЫ.',
    ],
    code: ['INPUT → ATTEMPTSWAP(STATE, A, B)', 'OUTPUT → STATE + SWAP/CLEAR/DROP/REFILL/SETTLE'],
  },
  {
    title: '4. ПОЛЕ И ДЕТЕРМИНИРОВАННОСТЬ',
    subtitle: '8 × 8 КЛЕТОК И ВОСПРОИЗВОДИМЫЙ SEED',
    paragraphs: [
      'ИНДЕКС КЛЕТКИ РАВЕН ROW × 8 + COLUMN. ГЕНЕРАТОР НЕ СТАВИТ ТРЕТИЙ ОДИНАКОВЫЙ ТАЛИСМАН ПОСЛЕ ДВУХ СЛЕВА ИЛИ СВЕРХУ.',
      'ПОСЛЕ ЗАПОЛНЕНИЯ ПРОГРАММА ДОКАЗЫВАЕТ ЧТО ЕСТЬ ХОТЯ БЫ ОДИН ДОПУСТИМЫЙ ХОД. ЕСЛИ ЕГО НЕТ, ПОЛЕ СОЗДАЁТСЯ ЗАНОВО.',
      'ОДИНАКОВЫЙ SEED И ОДИНАКОВЫЕ ХОДЫ ДАЮТ ОДИНАКОВУЮ ПАРТИЮ. ЭТО ПОМОГАЕТ ВОСПРОИЗВОДИТЬ ОШИБКИ И СРАВНИВАТЬ РЕЗУЛЬТАТЫ.',
    ],
    code: ['INDEX = ROW × 8 + COLUMN', 'SAME SEED + SAME MOVES = SAME GAME'],
  },
  {
    title: '5. КАСКАДЫ И SPECIALS',
    subtitle: 'СОВПАДЕНИЕ → ОЧИСТКА → ПАДЕНИЕ → ЗАПОЛНЕНИЕ',
    paragraphs: [
      'СТРОКИ И СТОЛБЦЫ СКАНИРУЮТСЯ ОТДЕЛЬНО. ПЕРЕСЕКАЮЩИЕСЯ ГРУППЫ ОБЪЕДИНЯЮТСЯ В T ИЛИ L.',
      'ЧЕТЫРЕ ТАЛИСМАНА СОЗДАЮТ НАПРАВЛЕННЫЙ ФЕЙЕРВЕРК. ПЯТЬ, T ИЛИ L СОЗДАЮТ ДИНАМИТ. SPECIAL МОЖЕТ АКТИВИРОВАТЬ ДРУГОЙ SPECIAL.',
      'ПОСЛЕ ПАДЕНИЯ ПОИСК ПОВТОРЯЕТСЯ. ГЛУБИНА КАСКАДА УВЕЛИЧИВАЕТ НАГРАДУ И СИЛУ ВИЗУАЛЬНОЙ ОБРАТНОЙ СВЯЗИ.',
    ],
    flow: ['MATCH', 'CLEAR', 'DROP', 'REFILL', 'COMBO'],
  },
  {
    title: '6. ГРАФИКА И АНИМАЦИЯ',
    subtitle: 'ПРОЦЕДУРНЫЙ WESTERN БЕЗ ВНЕШНИХ АССЕТОВ',
    paragraphs: [
      'НЕБО, СОЛНЦЕ, КАНЬОН, ДЕРЕВО, ЛАТУНЬ И КАМНИ РИСУЮТСЯ ГРАДИЕНТАМИ И ВЕКТОРНЫМИ ПУТЯМИ CANVAS.',
      'ФОРМА ДОПОЛНЯЕТ ЦВЕТ: ЗВЕЗДА, ПОДКОВА, ЦВЕТОК, РОМБ, СОЛНЦЕ И РОЗЕТКА ОСТАЮТСЯ РАЗЛИЧИМЫМИ.',
      'СИЛЬНОЕ ДВИЖЕНИЕ ОСТАЁТСЯ ДЛЯ MATCH, COMBO, ОШИБКИ И ПОБЕДЫ. REDUCED MOTION УБИРАЕТ ПАРАЛЛАКС, ПЛОТНЫЕ ЧАСТИЦЫ И СИЛЬНЫЙ SHAKE.',
    ],
    callout: 'CANVAS РИСУЕТ МИР. DOM ПОКАЗЫВАЕТ ТЕКСТ, МЕНЮ И ДОСТУПНЫЕ КНОПКИ.',
  },
  {
    title: '7. УПРАВЛЕНИЕ И ДОСТУПНОСТЬ',
    subtitle: 'MOUSE + TOUCH + KEYBOARD + SCREEN READER',
    paragraphs: [
      'ИГРОК МОЖЕТ НАЖАТЬ ДВА СОСЕДНИХ ТАЛИСМАНА ИЛИ СДЕЛАТЬ SWIPE. СТРЕЛКИ ДВИГАЮТ ФОКУС, ENTER ВЫБИРАЕТ, ESC СТАВИТ ПАУЗУ.',
      'ARIA LIVE СООБЩАЕТ О ВЫБОРЕ, ХОДЕ, COMBO И РЕЗУЛЬТАТЕ. CANVAS ИМЕЕТ ДИНАМИЧЕСКОЕ ТЕКСТОВОЕ ОПИСАНИЕ.',
      'ИНТЕРФЕЙС НЕ ДОЛЖЕН ПЕРЕКРЫВАТЬ ПОЛЕ. НА PHONE РАЗМЕР КЛЕТКИ ОСТАЁТСЯ ОКОЛО 42 CSS PIXELS ИЛИ БОЛЬШЕ.',
    ],
    code: ['ARROWS → FOCUS', 'ENTER/SPACE → SELECT', 'ESC → PAUSE', 'M → SOUND'],
  },
  {
    title: '8. QA И ДОКАЗАТЕЛЬСТВА',
    subtitle: 'СВЕЖИЙ ЗАПУСК ВАЖНЕЕ УВЕРЕННОСТИ',
    paragraphs: [
      'UNIT TEST ПРОВЕРЯЕТ ПРАВИЛО. BROWSER SMOKE ПРОВЕРЯЕТ ТО ЧТО ВИДИТ ИГРОК. SCREENSHOT ПОКАЗЫВАЕТ ПРОБЛЕМЫ КОТОРЫЕ DOM-ASSERT НЕ ЗАМЕТИТ.',
      'ПЕРЕД MERGE НУЖНЫ: ТЕСТЫ, STATIC CHECK, BUILD, ZIP, DESKTOP, PHONE И ПРОВЕРКА ТОЧНОГО COMMIT SHA.',
      'ЕСЛИ НЕТ SANDBOX, GAMEID, LEGAL APPROVAL И PUBLISHER ACCEPTANCE - ЭТО ЧЕСТНЫЕ ВНЕШНИЕ БЛОКЕРЫ, А НЕ ПОВОД СОЗДАТЬ ФАЛЬШИВОЕ ДОКАЗАТЕЛЬСТВО.',
    ],
    callout: 'NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE.',
  },
  {
    title: '9. CI/CD И GITHUB PAGES',
    subtitle: 'ЧИСТАЯ МАШИНА ПОВТОРЯЕТ РЕЛИЗНЫЙ ПРОЦЕСС',
    paragraphs: [
      'WORKFLOW ПОЛУЧАЕТ COMMIT, УСТАНАВЛИВАЕТ NODE, ЗАПУСКАЕТ ТЕСТЫ И CHECK, СОБИРАЕТ STATIC DIST И ГЕНЕРИРУЕТ ЭТОТ PDF.',
      'PAGES ПОЛУЧАЕТ ТОЛЬКО ПРОВЕРЕННЫЙ DIST. DEPLOYMENT ВОЗВРАЩАЕТ РЕАЛЬНЫЙ PAGE URL, КОТОРЫЙ МОЖНО ПРОВЕРИТЬ CURL И БРАУЗЕРОМ.',
    ],
    flow: ['COMMIT', 'TEST', 'BUILD', 'PDF', 'DEPLOY'],
  },
  {
    title: '10. PUBLISHER BOUNDARY',
    subtitle: 'ИГРА РАБОТАЕТ ДАЖЕ КОГДА SDK НЕТ ИЛИ ОН ОШИБСЯ',
    paragraphs: [
      'ОДИН ADAPTER ПЕРЕДАЁТ СОБЫТИЯ LOADED, STARTED, PAUSED, COMPLETED, SCORE И ANALYTICS. ОЧЕРЕДЬ ОГРАНИЧЕНА И СОХРАНЯЕТ ПОРЯДОК.',
      'НАСТОЯЩИЙ ARKADIUM SDK ПОДКЛЮЧАЕТСЯ ТОЛЬКО ПОСЛЕ ПОЛУЧЕНИЯ ТОЧНОЙ ВЕРСИИ, GAMEID И ДОСТУПА К SANDBOX.',
      'CREDENTIALS, PRIVATE PAYLOADS И PRODUCTION USER DATA НИКОГДА НЕ ПОПАДАЮТ В GIT.',
    ],
    code: ['GAME CORE → PLATFORM CONTRACT → REAL SDK', 'MISSING SDK → STANDALONE PLAY'],
  },
  {
    title: '11. ПРАКТИКА ДЛЯ КЛАССА',
    subtitle: 'МАЛЕНЬКИЕ ЗАДАНИЯ С ЧЁТКОЙ ПРОВЕРКОЙ',
    paragraphs: [
      'НАЧАЛЬНЫЙ УРОВЕНЬ: ИЗМЕНИТЕ ФОН, ДОБАВЬТЕ ЗВУК COMBO, НАПИШИТЕ ТЕСТ ДЛЯ ДИАГОНАЛЬНОГО ХОДА.',
      'СРЕДНИЙ УРОВЕНЬ: ДОБАВЬТЕ ВТОРОЙ УРОВЕНЬ, КНОПКУ HINT И REPLAY ПАРТИИ ПО SEED.',
      'КОМАНДНЫЙ УРОВЕНЬ: GAMEPLAY ПИШЕТ RED/GREEN СРЕЗ, PRESENTATION ПОКАЗЫВАЕТ СОБЫТИЕ, QA ДОБАВЛЯЕТ СЦЕНАРИЙ И SCREENSHOT, DIRECTOR ПРОВЕРЯЕТ DIFF И MERGE.',
    ],
    callout: 'ГОТОВО = КОД + ТЕСТ + БРАУЗЕР + АРТЕФАКТ + ЧЕСТНЫЕ БЛОКЕРЫ.',
  },
];

function rgb(hex) {
  const clean = hex.replace('#', '');
  return [0, 2, 4].map((offset) => Number.parseInt(clean.slice(offset, offset + 2), 16) / 255);
}

function fillColor(hex) {
  const [r, g, b] = rgb(hex);
  return `${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} rg`;
}

function rect(x, y, width, height, color) {
  return `${fillColor(color)}\n${x.toFixed(2)} ${y.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re f\n`;
}

function glyphPattern(character) {
  const upper = character.toUpperCase();
  return GLYPHS[upper] ?? GLYPHS['?'];
}

function textWidth(text, scale) {
  return [...text].reduce((sum, character) => sum + (character === ' ' ? 4 : 6) * scale, 0);
}

function drawText(text, x, topY, scale, color, options = {}) {
  const commands = [];
  const align = options.align ?? 'left';
  let cursorX = x;
  if (align === 'center') cursorX -= textWidth(text, scale) / 2;
  if (align === 'right') cursorX -= textWidth(text, scale);
  commands.push(fillColor(color));
  for (const character of text.toUpperCase()) {
    if (character === ' ') {
      cursorX += 4 * scale;
      continue;
    }
    const pattern = glyphPattern(character);
    for (let row = 0; row < 7; row += 1) {
      for (let column = 0; column < 5; column += 1) {
        if (pattern[row][column] === '1') {
          const y = topY - (row + 1) * scale;
          commands.push(`${(cursorX + column * scale).toFixed(2)} ${y.toFixed(2)} ${scale.toFixed(2)} ${scale.toFixed(2)} re f`);
        }
      }
    }
    cursorX += 6 * scale;
  }
  return `${commands.join('\n')}\n`;
}

function wrap(text, maxCharacters) {
  const words = text.toUpperCase().split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length > maxCharacters && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function drawParagraph(text, x, topY, width, scale = 1.15, color = '#EAD8BE') {
  const maxCharacters = Math.max(12, Math.floor(width / (scale * 5.2)));
  const lines = wrap(text, maxCharacters);
  const lineHeight = scale * 10.2;
  let commands = '';
  lines.forEach((line, index) => {
    commands += drawText(line, x, topY - index * lineHeight, scale, color);
  });
  return { commands, height: lines.length * lineHeight };
}

function drawFlow(labels, y) {
  const margin = 42;
  const gap = 10;
  const available = PAGE_WIDTH - margin * 2;
  const boxWidth = (available - gap * (labels.length - 1)) / labels.length;
  let commands = '';
  labels.forEach((label, index) => {
    const x = margin + index * (boxWidth + gap);
    commands += rect(x, y, boxWidth, 44, index % 2 === 0 ? '#6D3B2D' : '#176A69');
    commands += drawText(label, x + boxWidth / 2, y + 27, Math.min(1.0, boxWidth / Math.max(1, textWidth(label, 1))), '#FFF1C9', { align: 'center' });
    if (index < labels.length - 1) {
      commands += rect(x + boxWidth + 2, y + 20, gap - 4, 4, '#F3C66F');
    }
  });
  return commands;
}

function buildPage(page, pageNumber) {
  let commands = '';
  commands += rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT, '#160D16');
  commands += rect(0, PAGE_HEIGHT - 210, PAGE_WIDTH, 210, pageNumber % 2 === 0 ? '#5B2D38' : '#4C2B52');
  commands += rect(0, 0, PAGE_WIDTH, 48, '#0B070B');
  commands += rect(34, 34, PAGE_WIDTH - 68, PAGE_HEIGHT - 68, '#211018');
  commands += rect(40, 40, PAGE_WIDTH - 80, PAGE_HEIGHT - 80, '#2B1620');
  commands += rect(40, PAGE_HEIGHT - 176, PAGE_WIDTH - 80, 136, '#6E382A');
  commands += rect(40, PAGE_HEIGHT - 176, 12, 136, '#58D8C8');
  commands += rect(40, PAGE_HEIGHT - 54, PAGE_WIDTH - 80, 14, '#D58C43');

  commands += drawText(page.title, 64, PAGE_HEIGHT - 78, pageNumber === 1 ? 2.65 : 2.15, '#FFF0BD');
  commands += drawText(page.subtitle, 64, PAGE_HEIGHT - 126, 1.05, '#74E2D2');

  let y = PAGE_HEIGHT - 218;
  for (const paragraph of page.paragraphs ?? []) {
    const rendered = drawParagraph(paragraph, 62, y, PAGE_WIDTH - 124, 1.15, '#EAD8BE');
    commands += rendered.commands;
    y -= rendered.height + 18;
  }

  if (page.flow) {
    commands += drawFlow(page.flow, Math.max(90, y - 54));
  }

  if (page.code) {
    const boxY = Math.max(88, y - page.code.length * 30 - 24);
    commands += rect(58, boxY, PAGE_WIDTH - 116, page.code.length * 30 + 30, '#101920');
    page.code.forEach((line, index) => {
      commands += drawText(line, 76, boxY + page.code.length * 30 - index * 30 + 7, 1.05, '#8BF0DF');
    });
  }

  if (page.callout) {
    const rendered = drawParagraph(page.callout, 76, 122, PAGE_WIDTH - 152, 1.22, '#25130E');
    const height = Math.max(58, rendered.height + 26);
    commands += rect(58, 92, PAGE_WIDTH - 116, height, '#F1C46E');
    commands += rendered.commands.replace(/76\.00 122\.00/g, `76.00 ${(92 + height - 18).toFixed(2)}`);
  }

  commands += drawText('CANYON CHARMS / SWARMFORGE', 54, 25, 0.82, '#CBAE89');
  commands += drawText(String(pageNumber).padStart(2, '0'), PAGE_WIDTH - 54, 25, 0.9, '#78DDCE', { align: 'right' });
  return commands;
}

function makePdf(pageStreams) {
  const objects = [];
  const add = (value) => {
    objects.push(value);
    return objects.length;
  };
  const catalogId = add('');
  const pagesId = add('');
  const pageIds = [];
  for (const stream of pageStreams) {
    const length = Buffer.byteLength(stream, 'ascii');
    const contentId = add(`<< /Length ${length} >>\nstream\n${stream}endstream`);
    const pageId = add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << >> /Contents ${contentId} 0 R >>`);
    pageIds.push(pageId);
  }
  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] >>`;

  let pdf = '%PDF-1.4\n%1234\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, 'ascii'));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, 'ascii');
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let index = 1; index <= objects.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, 'ascii');
}

const streams = PAGES.map((page, index) => buildPage(page, index + 1));
const pdf = makePdf(streams);
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, pdf);
console.log(`Generated ${outputPath} (${pdf.length} bytes, ${PAGES.length} pages)`);
