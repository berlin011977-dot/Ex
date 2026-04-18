const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const { TextDecoder } = require("util");

const dotenv = require("dotenv");
const express = require("express");
const mammoth = require("mammoth");
const multer = require("multer");
const pdfParse = require("pdf-parse");

dotenv.config();

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 },
});

const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const DATA_ROOT = process.env.DATA_DIR || path.join(ROOT_DIR, "data");
const DATA_FILE = path.join(DATA_ROOT, "exams.json");
const RESULTS_FILE = path.join(DATA_ROOT, "results.json");

const PORT = Number.parseInt(process.env.PORT || "3000", 10);
const OWNER_PASSWORD = process.env.OWNER_PASSWORD || "ChangeMeNow123!";
const AI_API_KEY = process.env.ANTHROPIC_API_KEY || "";
const AI_MODEL = process.env.ANTHROPIC_MODEL || "";

const QUESTION_TYPES = {
  MULTIPLE_CHOICE: "multiple_choice",
  TRUE_FALSE: "true_false",
  SHORT_ANSWER: "short_answer",
};

const QUESTION_START_RE =
  /^(?:(?:سؤال|السؤال|question|q)\s*[0-9\u0660-\u0669]+\s*[:.)-]?|[0-9\u0660-\u0669]{1,3}\s*[.):-])\s+/iu;
const OPTION_LINE_RE =
  /^\s*(?<marker>[*✓✔☑]?)\s*(?:[\[(]\s*(?<bracketLabel>A|B|C|D|E|F|[1-6]|أ|ب|ج|د|هـ|ه|و)\s*[\])]|(?<plainLabel>A|B|C|D|E|F|[1-6]|أ|ب|ج|د|هـ|ه|و)\s*[.)\-:])\s*(?<text>.+)$/iu;
const ANSWER_LINE_RE =
  /^(?:correct\s*answer|answer|expected\s*answer|الإجابة(?:\s*الصحيحة)?|الجواب(?:\s*الصحيح)?)\s*[:\-]\s*(?<value>.+)$/iu;
const EXPLANATION_LINE_RE = /^(?:explanation|الشرح|التفسير|سبب\s*الإجابة)\s*[:\-]\s*/iu;
const ANSWER_SECTION_HEADER_RE =
  /^(?:answer\s*key|answers|correct\s*answers|model\s*answer|مفتاح\s*(?:الإجابة|الإجابات)|الإجابات(?:\s*الصحيحة)?|نموذج\s*(?:الإجابة|الإجابات))[:\-]?\s*$/iu;
const ANSWER_ENTRY_RE =
  /(?:^|[\s,;|])(?:q(?:uestion)?|سؤال|س)?\s*([0-9\u0660-\u0669]{1,3})\s*[\].)\-:]*\s*(?:=|:|-)?\s*(.+?)(?=(?:[\s,;|]+(?:q(?:uestion)?|سؤال|س)?\s*[0-9\u0660-\u0669]{1,3}\s*[\].)\-:]*\s*(?:=|:|-)?\s*)|$)/giu;
const SECTION_HEADER_RE = /^(?:section|part|chapter|القسم|الجزء|الفصل)\b/iu;
const TRUE_FALSE_HINT_RE = /(?:صح\s*أم\s*خطأ|صح\s*\/\s*خطأ|true\s*\/\s*false|true or false)/iu;

app.disable("x-powered-by");
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(PUBLIC_DIR, { extensions: ["html"] }));

function safeCompare(left, right) {
  const a = Buffer.from(String(left || ""), "utf8");
  const b = Buffer.from(String(right || ""), "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function toWesternDigits(value) {
  return String(value || "").replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)));
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\r/g, "")
    .replace(/\u0000/g, "")
    .replace(/[ï»¿]/g, "")
    .replace(/\t/g, " ")
    .replace(/[ \u00a0]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function sanitizeString(value, fallback = "") {
  const cleaned = normalizeText(value);
  return cleaned || fallback;
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

function scoreDecodedText(text) {
  const normalized = String(text || "");
  const readable = (normalized.match(/[A-Za-z\u0600-\u06FF0-9]/g) || []).length;
  const replacement = (normalized.match(/\uFFFD/g) || []).length;
  const strange = (normalized.match(/[^\sA-Za-z\u0600-\u06FF0-9.,;:!?()[\]{}"'_+\-/%@#*&]/g) || []).length;
  return readable - replacement * 12 - strange * 2;
}

function decodeTextBuffer(buffer) {
  const encodings = ["utf-8", "utf-16le", "windows-1256", "latin1"];
  let bestText = "";
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const encoding of encodings) {
    try {
      const decoder = new TextDecoder(encoding, { fatal: false });
      const decoded = decoder.decode(buffer);
      const score = scoreDecodedText(decoded);
      if (score > bestScore) {
        bestText = decoded;
        bestScore = score;
      }
    } catch {
      // Ignore decoder failures and continue.
    }
  }

  return bestText || buffer.toString("utf8");
}

function normalizeOptionLabel(label) {
  return toWesternDigits(String(label || ""))
    .trim()
    .toUpperCase()
    .replace("هـ", "ه");
}

function stripQuestionPrefix(line) {
  return line
    .replace(
      /^(?:(?:سؤال|السؤال|question|q)\s*[0-9\u0660-\u0669]+\s*[:.)-]?|[0-9\u0660-\u0669]{1,3}\s*[.):-])\s*/iu,
      "",
    )
    .trim();
}

function looksLikeQuestionStart(line) {
  const cleaned = sanitizeString(line);
  if (!cleaned) {
    return false;
  }

  if (/^(?:سؤال|السؤال|question|q)\s*[0-9\u0660-\u0669]+\s*[:.)-]?\s+/iu.test(cleaned)) {
    return true;
  }

  const numbered = cleaned.match(/^([0-9\u0660-\u0669]{1,3})\s*[.):-]\s+(.+)$/u);
  if (!numbered) {
    return false;
  }

  const body = numbered[2].trim();
  return body.split(/\s+/u).length >= 3 || /[؟?]/u.test(body);
}

function isArabicLike(value) {
  return /[\u0600-\u06FF]/.test(String(value || ""));
}

function normalizeForComparison(value) {
  return toWesternDigits(String(value || ""))
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isTrueFalseToken(value) {
  const normalized = normalizeForComparison(value);
  return [
    "true",
    "false",
    "t",
    "f",
    "صح",
    "خطا",
    "خطأ",
    "صحيح",
    "غلط",
    "wrong",
    "yes",
    "no",
  ].includes(normalized);
}

function trueFalseIndexFromValue(value) {
  const normalized = normalizeForComparison(value);

  if (["true", "t", "صح", "صحيح", "yes"].includes(normalized)) {
    return 0;
  }

  if (["false", "f", "خطا", "خطأ", "غلط", "wrong", "no"].includes(normalized)) {
    return 1;
  }

  return -1;
}

function getTrueFalseOptions(contextValue) {
  return isArabicLike(contextValue) ? ["صح", "خطأ"] : ["True", "False"];
}

function splitQuestionBlocks(text) {
  const lines = normalizeText(text)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const intro = [];
  const blocks = [];
  let current = [];

  for (const line of lines) {
    if (looksLikeQuestionStart(line)) {
      if (current.length) {
        blocks.push(current.join("\n"));
      }
      current = [line];
    } else if (current.length) {
      current.push(line);
    } else {
      intro.push(line);
    }
  }

  if (current.length) {
    blocks.push(current.join("\n"));
  }

  return { intro, blocks };
}

function parseAnswerEntries(line) {
  const entries = [];
  let match;

  ANSWER_ENTRY_RE.lastIndex = 0;
  while ((match = ANSWER_ENTRY_RE.exec(line)) !== null) {
    const questionNumber = Number.parseInt(toWesternDigits(match[1]), 10);
    const rawAnswer = sanitizeString(match[2]);
    if (!Number.isNaN(questionNumber) && rawAnswer) {
      entries.push({ questionNumber, rawAnswer });
    }
  }

  return entries;
}

function isBulkAnswerLine(line) {
  if (!line) {
    return false;
  }

  if (ANSWER_SECTION_HEADER_RE.test(line)) {
    return true;
  }

  const entries = parseAnswerEntries(line);
  return entries.length >= 2;
}

function extractAnswerKeyMap(text) {
  const lines = normalizeText(text)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const map = new Map();
  let insideAnswerSection = false;

  for (const line of lines) {
    if (ANSWER_SECTION_HEADER_RE.test(line)) {
      insideAnswerSection = true;
      continue;
    }

    if (!insideAnswerSection) {
      continue;
    }

    const entries = parseAnswerEntries(line);
    entries.forEach((entry) => {
      map.set(entry.questionNumber, entry.rawAnswer);
    });
  }

  return map;
}

function inferExamTitle(text, fileName) {
  const { intro } = splitQuestionBlocks(text);
  const firstIntro = intro.find((line) => !QUESTION_START_RE.test(line));
  if (firstIntro && firstIntro.length <= 140) {
    return firstIntro;
  }

  return path.basename(fileName, path.extname(fileName)).replace(/[_-]+/g, " ").trim() || "امتحان جديد";
}

function extractInlineOptions(block) {
  const options = [];
  const matcher =
    /(?:^|\s)(?<marker>[*✓✔☑]?)\s*(?:[\[(]\s*(?<bracketLabel>A|B|C|D|E|F|[1-6]|أ|ب|ج|د|هـ|ه|و)\s*[\])]|(?<plainLabel>A|B|C|D|E|F|[1-6]|أ|ب|ج|د|هـ|ه|و)\s*[.)\-:])\s*(?<text>.*?)(?=(?:\s[*✓✔☑]?\s*(?:[\[(]\s*(?:A|B|C|D|E|F|[1-6]|أ|ب|ج|د|هـ|ه|و)\s*[\])]|(?:A|B|C|D|E|F|[1-6]|أ|ب|ج|د|هـ|ه|و)\s*[.)\-:]))|$)/giu;
  let match;

  while ((match = matcher.exec(block)) !== null) {
    const text = sanitizeString(match.groups?.text || "");
    if (!text) {
      continue;
    }

    options.push({
      label: normalizeOptionLabel(match.groups?.bracketLabel || match.groups?.plainLabel),
      text,
      isMarkedCorrect: Boolean(match.groups?.marker),
    });
  }

  return options;
}

function cleanOptionText(value) {
  return sanitizeString(value)
    .replace(/\s+(?:[*✓✔☑])$/, "")
    .replace(ANSWER_LINE_RE, "")
    .trim();
}

function buildDefaultExplanation(correctAnswerValue, questionType) {
  if (questionType === QUESTION_TYPES.SHORT_ANSWER) {
    if (!correctAnswerValue) {
      return "هذا السؤال الكتابي يحتاج مراجعة يدوية بعد الإرسال.";
    }
    return `الإجابة المتوقعة هي "${correctAnswerValue}".`;
  }

  if (!correctAnswerValue) {
    return "تم تحديد هذه الإجابة بحسب المفتاح المستخرج من الملف.";
  }

  return `الإجابة الصحيحة هي "${correctAnswerValue}" بحسب النص المستخرج من الملف.`;
}

function normalizeQuestionType(value) {
  return Object.values(QUESTION_TYPES).includes(value)
    ? value
    : QUESTION_TYPES.MULTIPLE_CHOICE;
}

function normalizeQuestionOptions(type, questionText, options) {
  if (type === QUESTION_TYPES.SHORT_ANSWER) {
    return [];
  }

  const normalized = Array.isArray(options)
    ? options.map((option) => sanitizeString(option)).filter(Boolean).slice(0, 6)
    : [];

  if (type === QUESTION_TYPES.TRUE_FALSE) {
    return (normalized.length >= 2 ? normalized.slice(0, 2) : getTrueFalseOptions(questionText)).map((option) =>
      sanitizeString(option),
    );
  }

  return normalized;
}

function resolveStoredCorrectAnswerIndex({ type, options, correctAnswerIndex, correctAnswerText }) {
  if (type === QUESTION_TYPES.SHORT_ANSWER) {
    return null;
  }

  if (type === QUESTION_TYPES.TRUE_FALSE) {
    const fromText = trueFalseIndexFromValue(correctAnswerText);
    if (fromText >= 0) {
      return fromText;
    }
  }

  const numericIndex = Number.isInteger(correctAnswerIndex)
    ? correctAnswerIndex
    : Number.parseInt(correctAnswerIndex, 10);

  if (Number.isInteger(numericIndex) && numericIndex >= 0 && numericIndex < options.length) {
    return numericIndex;
  }

  const normalizedAnswer = normalizeForComparison(correctAnswerText);
  if (normalizedAnswer) {
    const byText = options.findIndex((option) => normalizeForComparison(option) === normalizedAnswer);
    if (byText >= 0) {
      return byText;
    }
  }

  return options.length ? 0 : null;
}

function normalizeQuestionRecord(question, index) {
  const type = normalizeQuestionType(question?.type);
  const questionText = sanitizeString(question?.questionText, `سؤال ${index + 1}`);
  const options = normalizeQuestionOptions(type, questionText, question?.options);

  if (type !== QUESTION_TYPES.SHORT_ANSWER && options.length < 2) {
    return null;
  }

  const initialCorrectAnswerText = sanitizeString(question?.correctAnswerText);
  const correctAnswerIndex = resolveStoredCorrectAnswerIndex({
    type,
    options,
    correctAnswerIndex: question?.correctAnswerIndex,
    correctAnswerText: initialCorrectAnswerText,
  });
  const correctAnswerText =
    type === QUESTION_TYPES.SHORT_ANSWER
      ? initialCorrectAnswerText
      : initialCorrectAnswerText || options[correctAnswerIndex || 0] || "";

  return {
    id: index + 1,
    type,
    questionText,
    options,
    correctAnswerIndex,
    correctAnswerText,
    placeholder:
      type === QUESTION_TYPES.SHORT_ANSWER
        ? sanitizeString(question?.placeholder, "اكتب إجابتك هنا")
        : "",
    explanation:
      sanitizeString(question?.explanation) ||
      buildDefaultExplanation(correctAnswerText, type),
  };
}

function looksLikeTrueFalseQuestion(questionText, options, rawAnswer) {
  if (TRUE_FALSE_HINT_RE.test(questionText || "")) {
    return true;
  }

  if (rawAnswer && isTrueFalseToken(rawAnswer)) {
    return true;
  }

  if (Array.isArray(options) && options.length === 2) {
    const normalizedOptions = options.map((option) => normalizeForComparison(option.text || option));
    const set = new Set(normalizedOptions);
    const english = set.has("true") && set.has("false");
    const arabic = (set.has("صح") || set.has("صحيح")) && (set.has("خطا") || set.has("خطأ"));
    return english || arabic;
  }

  return false;
}

function resolveCorrectAnswerIndex(questionType, options, rawAnswer) {
  if (!rawAnswer) {
    return -1;
  }

  if (questionType === QUESTION_TYPES.TRUE_FALSE) {
    return trueFalseIndexFromValue(rawAnswer);
  }

  const normalizedLabel = normalizeOptionLabel(rawAnswer);
  const byLabel = options.findIndex((option) => normalizeOptionLabel(option.label) === normalizedLabel);
  if (byLabel >= 0) {
    return byLabel;
  }

  const numericValue = Number.parseInt(normalizedLabel, 10);
  if (!Number.isNaN(numericValue) && numericValue >= 1 && numericValue <= options.length) {
    return numericValue - 1;
  }

  const normalizedAnswer = normalizeForComparison(rawAnswer);
  const byText = options.findIndex((option) => normalizeForComparison(option.text) === normalizedAnswer);
  if (byText >= 0) {
    return byText;
  }

  return -1;
}

function buildShortAnswerQuestion({
  index,
  questionText,
  answerText,
  explanationText,
}) {
  return {
    id: index + 1,
    type: QUESTION_TYPES.SHORT_ANSWER,
    questionText,
    options: [],
    correctAnswerIndex: null,
    correctAnswerText: answerText || "",
    placeholder: "اكتب إجابتك هنا",
    explanation:
      explanationText || buildDefaultExplanation(answerText, QUESTION_TYPES.SHORT_ANSWER),
  };
}

function parseQuestionBlock(block, index, answerKeyMap) {
  const lines = normalizeText(block)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const questionLines = [];
  const explanationLines = [];
  const options = [];
  let optionsStarted = false;
  let inlineAnswerText = "";
  let typeHint = "";

  for (const line of lines) {
    if (ANSWER_SECTION_HEADER_RE.test(line) || isBulkAnswerLine(line)) {
      break;
    }

    if (SECTION_HEADER_RE.test(line) && !questionLines.length) {
      typeHint = line;
      continue;
    }

    if (!optionsStarted && looksLikeQuestionStart(line)) {
      questionLines.push(line);
      if (TRUE_FALSE_HINT_RE.test(line)) {
        typeHint = QUESTION_TYPES.TRUE_FALSE;
      }
      continue;
    }

    const answerMatch = line.match(ANSWER_LINE_RE);
    if (answerMatch?.groups?.value) {
      inlineAnswerText = sanitizeString(answerMatch.groups.value);
      continue;
    }

    if (EXPLANATION_LINE_RE.test(line)) {
      explanationLines.push(line.replace(EXPLANATION_LINE_RE, "").trim());
      continue;
    }

    const optionMatch = line.match(OPTION_LINE_RE);
    if (optionMatch?.groups?.text) {
      optionsStarted = true;
      const label = normalizeOptionLabel(
        optionMatch.groups.bracketLabel || optionMatch.groups.plainLabel,
      );
      const text = cleanOptionText(optionMatch.groups.text);
      options.push({
        label,
        text,
        isMarkedCorrect: Boolean(optionMatch.groups.marker),
      });
      continue;
    }

    if (!optionsStarted) {
      questionLines.push(line);
      if (TRUE_FALSE_HINT_RE.test(line)) {
        typeHint = QUESTION_TYPES.TRUE_FALSE;
      }
      continue;
    }

    if (options.length) {
      options[options.length - 1].text = sanitizeString(`${options[options.length - 1].text} ${line}`);
    } else {
      explanationLines.push(line);
    }
  }

  const rawQuestionText = stripQuestionPrefix(questionLines.join(" ").trim()) || `سؤال ${index + 1}`;
  const answerFromKey = answerKeyMap.get(index + 1) || "";
  const combinedAnswerText = inlineAnswerText || answerFromKey;
  const explanationText = sanitizeString(explanationLines.join(" "));

  let normalizedOptions = options
    .map((option) => ({
      ...option,
      text: cleanOptionText(option.text),
    }))
    .filter((option) => option.text);

  if (normalizedOptions.length < 2) {
    normalizedOptions = extractInlineOptions(block)
      .map((option) => ({
        ...option,
        text: cleanOptionText(option.text),
      }))
      .filter((option) => option.text);
  }

  const isTrueFalse =
    typeHint === QUESTION_TYPES.TRUE_FALSE ||
    looksLikeTrueFalseQuestion(rawQuestionText, normalizedOptions, combinedAnswerText);

  if (normalizedOptions.length >= 2) {
    const questionType = isTrueFalse ? QUESTION_TYPES.TRUE_FALSE : QUESTION_TYPES.MULTIPLE_CHOICE;
    let renderOptions = normalizedOptions;

    if (questionType === QUESTION_TYPES.TRUE_FALSE && renderOptions.length !== 2) {
      renderOptions = getTrueFalseOptions(rawQuestionText).map((option, optionIndex) => ({
        label: String(optionIndex + 1),
        text: option,
        isMarkedCorrect: false,
      }));
    }

    let correctAnswerIndex = renderOptions.findIndex((option) => option.isMarkedCorrect);
    if (correctAnswerIndex < 0) {
      correctAnswerIndex = resolveCorrectAnswerIndex(questionType, renderOptions, combinedAnswerText);
    }
    if (correctAnswerIndex < 0) {
      correctAnswerIndex = 0;
    }

    const correctAnswerText = renderOptions[correctAnswerIndex]?.text || "";

    return {
      id: index + 1,
      type: questionType,
      questionText: rawQuestionText,
      options: renderOptions.map((option) => option.text).slice(0, 6),
      correctAnswerIndex: Math.min(correctAnswerIndex, renderOptions.length - 1),
      correctAnswerText,
      placeholder: "",
      explanation:
        explanationText || buildDefaultExplanation(correctAnswerText, questionType),
    };
  }

  if (isTrueFalse) {
    const trueFalseOptions = getTrueFalseOptions(rawQuestionText);
    let correctAnswerIndex = trueFalseIndexFromValue(combinedAnswerText);
    if (correctAnswerIndex < 0) {
      correctAnswerIndex = 0;
    }

    return {
      id: index + 1,
      type: QUESTION_TYPES.TRUE_FALSE,
      questionText: rawQuestionText,
      options: trueFalseOptions,
      correctAnswerIndex,
      correctAnswerText: trueFalseOptions[correctAnswerIndex],
      placeholder: "",
      explanation:
        explanationText ||
        buildDefaultExplanation(trueFalseOptions[correctAnswerIndex], QUESTION_TYPES.TRUE_FALSE),
    };
  }

  return buildShortAnswerQuestion({
    index,
    questionText: rawQuestionText,
    answerText: combinedAnswerText,
    explanationText,
  });
}

function parseExamLocally({ text, fileName, duration, extraInstructions }) {
  const normalized = normalizeText(text);
  const answerKeyMap = extractAnswerKeyMap(normalized);
  const { blocks } = splitQuestionBlocks(normalized);
  const questions = blocks
    .map((block, index) => parseQuestionBlock(block, index, answerKeyMap))
    .filter(Boolean)
    .slice(0, 200);

  if (!questions.length) {
    throw new Error(
      "تعذر استخراج أسئلة واضحة من الملف. جرّب ملف TXT أو DOCX منظم، أو ألصق النص يدوياً ثم عاين النتيجة قبل النشر.",
    );
  }

  return {
    examTitle: inferExamTitle(normalized, fileName),
    duration,
    instructions: sanitizeString(extraInstructions),
    questions,
  };
}

function extractJsonBlock(text) {
  const cleaned = String(text || "")
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace < 0 || lastBrace <= firstBrace) {
    throw new Error("لم يتم العثور على JSON صالح في رد الذكاء الاصطناعي.");
  }

  return cleaned.slice(firstBrace, lastBrace + 1);
}

function sanitizeExamPayload(payload, duration, extraInstructions) {
  const examTitle = sanitizeString(payload?.examTitle, "امتحان جديد");
  const questions = Array.isArray(payload?.questions)
    ? payload.questions
        .map((question, index) => normalizeQuestionRecord(question, index))
        .filter(Boolean)
    : [];

  if (!questions.length) {
    throw new Error("البيانات المعالجة لا تحتوي على أسئلة قابلة للنشر.");
  }

  return {
    examTitle,
    duration,
    instructions: sanitizeString(extraInstructions),
    questions,
  };
}

async function parseWithAnthropic({ text, fileName, duration, extraInstructions }) {
  const prompt = `
You are an exam parsing assistant.

Parse the provided exam text and output ONLY valid JSON with this exact shape:
{
  "examTitle": "title",
  "questions": [
    {
      "type": "multiple_choice | true_false | short_answer",
      "questionText": "question",
      "options": ["option 1", "option 2"],
      "correctAnswerIndex": 0,
      "correctAnswerText": "expected writing answer if needed",
      "explanation": "brief explanation"
    }
  ]
}

Rules:
- Preserve the original language exactly.
- Ignore headers, footers, page numbers, and repeated metadata.
- Support mixed question types: multiple-choice, true/false, and short-answer writing questions.
- For short-answer questions, fill "correctAnswerText" when the source includes an expected answer.
- Do not add markdown fences.
- Do not include any text outside the JSON object.

File name: ${fileName}
Extra instructions: ${extraInstructions || "None"}

Exam text:
${text.slice(0, 18000)}
  `.trim();

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": AI_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: AI_MODEL,
      max_tokens: 4000,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Anthropic request failed: ${response.status} ${errorBody}`);
  }

  const data = await response.json();
  const combined = Array.isArray(data.content)
    ? data.content.map((block) => block.text || "").join("\n")
    : "";
  const parsed = JSON.parse(extractJsonBlock(combined));
  return sanitizeExamPayload(parsed, duration, extraInstructions);
}

async function extractTextFromFile(file) {
  const extension = path.extname(file.originalname || "").toLowerCase();

  if (extension === ".txt") {
    return decodeTextBuffer(file.buffer);
  }

  if (extension === ".pdf") {
    const pdf = await pdfParse(file.buffer);
    return pdf.text || "";
  }

  if (extension === ".docx") {
    const result = await mammoth.extractRawText({ buffer: file.buffer });
    return result.value || "";
  }

  throw new Error("الملف المدعوم حالياً هو TXT أو PDF أو DOCX فقط.");
}

function normalizeQuestionForStorage(question, index) {
  return normalizeQuestionRecord(question, index);
}

function normalizeExamForStorage(input) {
  const duration = clampNumber(input?.duration, 5, 300, 60);
  const examTitle = sanitizeString(input?.examTitle, "امتحان جديد");
  const instructions = sanitizeString(input?.instructions);
  const questions = Array.isArray(input?.questions)
    ? input.questions.map((question, index) => normalizeQuestionForStorage(question, index)).filter(Boolean)
    : [];

  if (!questions.length) {
    throw new Error("الامتحان يحتاج إلى أسئلة واضحة قبل النشر.");
  }

  return {
    examTitle,
    duration,
    instructions,
    questions,
  };
}

function publicExamSummary(exam) {
  return {
    id: exam.id,
    examTitle: exam.examTitle,
    duration: exam.duration,
    questionCount: exam.questions.length,
    publishedAt: exam.publishedAt,
    instructions: exam.instructions || "",
    questionTypes: exam.questions.reduce((accumulator, question) => {
      accumulator[question.type] = (accumulator[question.type] || 0) + 1;
      return accumulator;
    }, {}),
  };
}

function studentExamPayload(exam) {
  return {
    id: exam.id,
    examTitle: exam.examTitle,
    duration: exam.duration,
    instructions: exam.instructions || "",
    publishedAt: exam.publishedAt,
    questions: exam.questions.map((question) => ({
      id: question.id,
      type: question.type,
      questionText: question.questionText,
      options: question.options,
      placeholder: question.placeholder || "",
    })),
  };
}

function ownerExamPayload(exam) {
  return {
    id: exam.id,
    examTitle: exam.examTitle,
    duration: exam.duration,
    instructions: exam.instructions || "",
    publishedAt: exam.publishedAt,
    questions: exam.questions.map((question) => ({
      id: question.id,
      type: question.type,
      questionText: question.questionText,
      options: question.options,
      correctAnswerIndex: question.correctAnswerIndex,
      correctAnswerText: question.correctAnswerText || "",
      placeholder: question.placeholder || "",
      explanation: question.explanation || "",
    })),
  };
}

function splitAcceptableAnswers(correctAnswerText) {
  const raw = sanitizeString(correctAnswerText);
  if (!raw) {
    return [];
  }

  const parts = raw
    .split(/\s*(?:\||;|؛|\/|\\)\s*/g)
    .map((item) => sanitizeString(item))
    .filter(Boolean);

  return parts.length ? parts : [raw];
}

function isTextAnswerCorrect(userAnswer, correctAnswerText) {
  const normalizedUser = normalizeForComparison(userAnswer);
  if (!normalizedUser) {
    return false;
  }

  const acceptableAnswers = splitAcceptableAnswers(correctAnswerText);
  return acceptableAnswers.some((candidate) => {
    const normalizedCandidate = normalizeForComparison(candidate);
    if (!normalizedCandidate) {
      return false;
    }

    if (normalizedUser === normalizedCandidate) {
      return true;
    }

    if (normalizedCandidate.split(" ").length <= 3) {
      return (
        normalizedUser.includes(normalizedCandidate) ||
        normalizedCandidate.includes(normalizedUser)
      );
    }

    return false;
  });
}

function isAnswerProvided(question, answerValue) {
  if (question.type === QUESTION_TYPES.SHORT_ANSWER) {
    return Boolean(sanitizeString(answerValue));
  }

  const parsed = Number.isInteger(answerValue) ? answerValue : Number.parseInt(answerValue, 10);
  return Number.isInteger(parsed);
}

function gradeQuestion(question, rawAnswer) {
  if (question.type === QUESTION_TYPES.SHORT_ANSWER) {
    const userAnswerText = sanitizeString(rawAnswer);
    const answered = Boolean(userAnswerText);
    const canAutoGrade = Boolean(sanitizeString(question.correctAnswerText));
    const isCorrect = canAutoGrade ? answered && isTextAnswerCorrect(userAnswerText, question.correctAnswerText) : null;

    return {
      answered,
      canAutoGrade,
      isCorrect,
      userAnswerIndex: null,
      userAnswerText,
    };
  }

  const userAnswerIndex = Number.isInteger(rawAnswer) ? rawAnswer : Number.parseInt(rawAnswer, 10);
  const answered = Number.isInteger(userAnswerIndex);
  const isCorrect = answered && userAnswerIndex === question.correctAnswerIndex;

  return {
    answered,
    canAutoGrade: true,
    isCorrect,
    userAnswerIndex: answered ? userAnswerIndex : null,
    userAnswerText: "",
  };
}

async function ensureDataFile() {
  await fs.mkdir(DATA_ROOT, { recursive: true });
  try {
    await fs.access(DATA_FILE);
  } catch {
    await fs.writeFile(DATA_FILE, "[]", "utf8");
  }

  try {
    await fs.access(RESULTS_FILE);
  } catch {
    await fs.writeFile(RESULTS_FILE, "[]", "utf8");
  }
}

async function readExams() {
  await ensureDataFile();
  const raw = await fs.readFile(DATA_FILE, "utf8");

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeExams(exams) {
  await ensureDataFile();
  await fs.writeFile(DATA_FILE, JSON.stringify(Array.isArray(exams) ? exams : [], null, 2), "utf8");
}

async function readResults() {
  await ensureDataFile();
  const raw = await fs.readFile(RESULTS_FILE, "utf8");

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeResults(results) {
  await ensureDataFile();
  await fs.writeFile(RESULTS_FILE, JSON.stringify(Array.isArray(results) ? results : [], null, 2), "utf8");
}

function publicResultSummary(result) {
  return {
    id: result.id,
    examId: result.examId,
    examTitle: result.examTitle,
    studentName: result.studentName,
    totalQuestions: result.totalQuestions,
    gradableTotal: result.gradableTotal,
    correct: result.correct,
    wrong: result.wrong,
    skipped: result.skipped,
    pendingManualReview: result.pendingManualReview,
    scorePercent: result.scorePercent,
    submittedAt: result.submittedAt,
    submittedAtIso: result.submittedAtIso,
    review: Array.isArray(result.review) ? result.review : [],
  };
}

function getOwnerPasswordFromRequest(req) {
  const headerPassword = req.get("x-owner-password");
  const bodyPassword = req.body?.password;
  return sanitizeString(headerPassword || bodyPassword);
}

function isOwnerRequest(req) {
  const suppliedPassword = getOwnerPasswordFromRequest(req);
  return Boolean(suppliedPassword) && safeCompare(suppliedPassword, OWNER_PASSWORD);
}

function requireOwner(req, res, next) {
  if (!isOwnerRequest(req)) {
    return res.status(401).json({ error: "صلاحية المالك مطلوبة لتنفيذ هذا الإجراء." });
  }

  return next();
}

app.get("/api/config", (req, res) => {
  return res.json({
    hasAiProcessing: Boolean(AI_API_KEY && AI_MODEL),
    supportedFormats: ["TXT", "PDF", "DOCX"],
    supportedQuestionTypes: ["multiple_choice", "true_false", "short_answer"],
    maxUploadSizeMb: 12,
  });
});

app.post("/api/auth/owner", (req, res) => {
  if (!isOwnerRequest(req)) {
    return res.status(401).json({ error: "كلمة المرور غير صحيحة." });
  }

  return res.json({
    ok: true,
    message: "تم فتح لوحة المالك بنجاح.",
  });
});

app.get("/api/exams", async (req, res, next) => {
  try {
    const exams = await readExams();
    const ordered = [...exams].sort((left, right) => {
      const first = Date.parse(right.publishedAtIso || "") || 0;
      const second = Date.parse(left.publishedAtIso || "") || 0;
      return first - second;
    });
    return res.json({ exams: ordered.map(publicExamSummary) });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/exams/:id", async (req, res, next) => {
  try {
    const exams = await readExams();
    const exam = exams.find((item) => item.id === req.params.id);

    if (!exam) {
      return res.status(404).json({ error: "الامتحان غير موجود." });
    }

    if (req.query.mode === "owner") {
      if (!isOwnerRequest(req)) {
        return res.status(401).json({ error: "صلاحية المالك مطلوبة لعرض الإجابات." });
      }
      return res.json({ exam: ownerExamPayload(exam) });
    }

    return res.json({ exam: studentExamPayload(exam) });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/results", requireOwner, async (req, res, next) => {
  try {
    const results = await readResults();
    const ordered = [...results].sort((left, right) => {
      const first = Date.parse(right.submittedAtIso || "") || 0;
      const second = Date.parse(left.submittedAtIso || "") || 0;
      return first - second;
    });

    return res.json({ results: ordered.map(publicResultSummary) });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/process-exam", requireOwner, upload.single("examFile"), async (req, res, next) => {
  try {
    const duration = clampNumber(req.body.duration, 5, 300, 60);
    const extraInstructions = sanitizeString(req.body.extraInstructions);
    const manualText = sanitizeString(req.body.manualText);

    let text = manualText;
    let fileName = "manual-input.txt";

    if (req.file) {
      text = await extractTextFromFile(req.file);
      fileName = req.file.originalname;
    }

    if (!sanitizeString(text)) {
      return res
        .status(400)
        .json({ error: "ارفع ملفاً أو ألصق نص الامتحان يدوياً قبل بدء المعالجة." });
    }

    let parsed;
    let usedAi = false;

    if (AI_API_KEY && AI_MODEL) {
      try {
        parsed = await parseWithAnthropic({
          text,
          fileName,
          duration,
          extraInstructions,
        });
        usedAi = true;
      } catch (error) {
        console.error("AI parsing failed, switching to local parser:", error);
      }
    }

    if (!parsed) {
      parsed = parseExamLocally({
        text,
        fileName,
        duration,
        extraInstructions,
      });
    }

    return res.json({
      parsed,
      usedAi,
      message: usedAi
        ? `تم تحليل الملف بالذكاء الاصطناعي واستخراج ${parsed.questions.length} سؤال.`
        : `تم تحليل الملف بالمحلل المحسن واستخراج ${parsed.questions.length} سؤال.`,
    });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/exams", requireOwner, async (req, res, next) => {
  try {
    const normalized = normalizeExamForStorage(req.body);
    const now = new Date();
    const exams = await readExams();
    const newExam = {
      id: crypto.randomUUID(),
      ...normalized,
      publishedAt: new Intl.DateTimeFormat("ar-EG", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(now),
      publishedAtIso: now.toISOString(),
    };

    exams.push(newExam);
    await writeExams(exams);

    return res.status(201).json({
      exam: publicExamSummary(newExam),
      message: "تم نشر الامتحان بنجاح.",
    });
  } catch (error) {
    return next(error);
  }
});

app.put("/api/exams/:id", requireOwner, async (req, res, next) => {
  try {
    const normalized = normalizeExamForStorage(req.body);
    const exams = await readExams();
    const examIndex = exams.findIndex((item) => item.id === req.params.id);

    if (examIndex < 0) {
      return res.status(404).json({ error: "الامتحان غير موجود." });
    }

    const previous = exams[examIndex];
    const now = new Date();
    const updatedExam = {
      ...previous,
      ...normalized,
      id: previous.id,
      publishedAt: previous.publishedAt,
      publishedAtIso: previous.publishedAtIso,
      updatedAt: new Intl.DateTimeFormat("ar-EG", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(now),
      updatedAtIso: now.toISOString(),
    };

    exams[examIndex] = updatedExam;
    await writeExams(exams);

    return res.json({
      exam: publicExamSummary(updatedExam),
      message: "تم حفظ تعديلات الامتحان.",
    });
  } catch (error) {
    return next(error);
  }
});

app.delete("/api/exams/:id", requireOwner, async (req, res, next) => {
  try {
    const exams = await readExams();
    const filtered = exams.filter((item) => item.id !== req.params.id);

    if (filtered.length === exams.length) {
      return res.status(404).json({ error: "الامتحان المطلوب حذفه غير موجود." });
    }

    const results = await readResults();
    const filteredResults = results.filter((item) => item.examId !== req.params.id);

    await writeExams(filtered);
    await writeResults(filteredResults);
    return res.json({ ok: true, message: "تم حذف الامتحان." });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/exams/:id/submit", async (req, res, next) => {
  try {
    const exams = await readExams();
    const exam = exams.find((item) => item.id === req.params.id);

    if (!exam) {
      return res.status(404).json({ error: "الامتحان غير موجود." });
    }

    const answers = typeof req.body.answers === "object" && req.body.answers ? req.body.answers : {};
    const studentName = sanitizeString(req.body.studentName);

    if (!studentName) {
      return res.status(400).json({ error: "اكتب اسم الطالب قبل بدء الامتحان." });
    }

    let correct = 0;
    let wrong = 0;
    let skipped = 0;
    let pendingManualReview = 0;
    let gradableTotal = 0;

    const review = exam.questions.map((question, index) => {
      const rawAnswer = answers[String(index)] ?? answers[index];
      const graded = gradeQuestion(question, rawAnswer);

      if (!graded.answered) {
        skipped += 1;
      } else if (!graded.canAutoGrade) {
        pendingManualReview += 1;
      } else {
        gradableTotal += 1;
        if (graded.isCorrect) {
          correct += 1;
        } else {
          wrong += 1;
        }
      }

      if (!graded.answered && graded.canAutoGrade) {
        gradableTotal += 1;
      }

      return {
        id: question.id,
        type: question.type,
        questionText: question.questionText,
        options: question.options,
        userAnswerIndex: graded.userAnswerIndex,
        userAnswerText: graded.userAnswerText,
        correctAnswerIndex: question.correctAnswerIndex,
        correctAnswerText: question.correctAnswerText || "",
        explanation: question.explanation || "",
        isCorrect: graded.isCorrect,
        pendingManualReview: !graded.canAutoGrade && graded.answered,
      };
    });

    const scorePercent = gradableTotal ? Math.round((correct / gradableTotal) * 100) : null;
    const now = new Date();
    const resultRecord = {
      id: crypto.randomUUID(),
      examId: exam.id,
      examTitle: exam.examTitle,
      studentName,
      totalQuestions: exam.questions.length,
      gradableTotal,
      correct,
      wrong,
      skipped,
      pendingManualReview,
      scorePercent,
      submittedAt: new Intl.DateTimeFormat("ar-EG", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(now),
      submittedAtIso: now.toISOString(),
      review,
    };

    const results = await readResults();
    results.push(resultRecord);
    await writeResults(results);

    return res.json({
      result: publicResultSummary(resultRecord),
    });
  } catch (error) {
    return next(error);
  }
});

app.get("*", (req, res) => {
  return res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.use((error, req, res, next) => {
  console.error(error);

  if (error?.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: "حجم الملف أكبر من الحد المسموح وهو 12 ميغابايت." });
  }

  if (res.headersSent) {
    return next(error);
  }

  return res.status(500).json({
    error: error?.message || "حدث خطأ غير متوقع داخل الخادم.",
  });
});

ensureDataFile()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Exam platform is running on http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Failed to start server:", error);
    process.exit(1);
  });
