const crypto = require("crypto");
const { execFile } = require("child_process");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { TextDecoder, promisify } = require("util");

const dotenv = require("dotenv");
const express = require("express");
const iconv = require("iconv-lite");
const { createClient } = require("@libsql/client");
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
const PLATFORM_FILE = path.join(DATA_ROOT, "platform.json");
const SUMMARY_FILES_DIR = path.join(DATA_ROOT, "summary-files");
const USERS_FILE = path.join(DATA_ROOT, "users.json");
const TEMP_DIR = path.join(DATA_ROOT, "temp");
const execFileAsync = promisify(execFile);

const PORT = Number.parseInt(process.env.PORT || "3000", 10);
const OWNER_PASSWORD = process.env.OWNER_PASSWORD || "ChangeMeNow123!";
const AI_API_KEY = process.env.ANTHROPIC_API_KEY || "";
const AI_MODEL = process.env.ANTHROPIC_MODEL || "";
const TURSO_DATABASE_URL = process.env.TURSO_DATABASE_URL || "";
const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN || "";
const tursoClient = TURSO_DATABASE_URL
  ? createClient({
      url: TURSO_DATABASE_URL,
      authToken: TURSO_AUTH_TOKEN || undefined,
    })
  : null;

const QUESTION_TYPES = {
  MULTIPLE_CHOICE: "multiple_choice",
  TRUE_FALSE: "true_false",
  SHORT_ANSWER: "short_answer",
};
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const TRANSLATION_ENDPOINT = "https://api.mymemory.translated.net/get";
const translationCache = new Map();
const MAX_VISITOR_RECORDS = 400;
const MAX_USER_SESSIONS = 8;
const MAX_USER_DOWNLOADS = 120;
const MAX_USER_RESULTS = 120;
const DEVICE_ID_HEADER = "x-device-id";
const STUDENT_TOKEN_HEADER = "x-student-token";

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

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "how",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "their",
  "this",
  "to",
  "was",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "with",
  "about",
  "into",
  "than",
  "عن",
  "على",
  "الى",
  "إلى",
  "في",
  "من",
  "ما",
  "ماذا",
  "متى",
  "كيف",
  "لماذا",
  "هل",
  "هو",
  "هي",
  "هم",
  "كما",
  "كان",
  "كانت",
  "يكون",
  "تكون",
  "هذا",
  "هذه",
  "ذلك",
  "تلك",
  "هناك",
  "أي",
  "اى",
  "او",
  "أو",
  "ثم",
  "بعد",
  "قبل",
  "بين",
  "ضمن",
  "حول",
  "إذا",
  "اذا",
  "كل",
  "بعض",
  "مع",
  "بدون",
  "حيث",
  "اي",
  "التي",
  "الذي",
  "الذين",
  "اللاتي",
  "اللواتي",
  "فيه",
  "فيها",
  "عند",
  "لدى",
  "قد",
  "تم",
  "تمت",
  "انه",
  "إنه",
  "انها",
  "إنها",
  "سؤال",
  "السؤال",
  "اختر",
  "اكتب",
  "اذكر",
  "وضح",
  "علل",
  "صح",
  "خطأ",
  "true",
  "false",
]);

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

function formatArabicDate(value = new Date()) {
  return new Intl.DateTimeFormat("ar-EG", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

function normalizeEmail(value) {
  return sanitizeString(value).toLowerCase();
}

function isValidEmail(value) {
  return EMAIL_RE.test(normalizeEmail(value));
}

function normalizeDeviceId(value) {
  return sanitizeString(value).slice(0, 140);
}

function normalizeIp(value) {
  return sanitizeString(value)
    .replace(/^::ffff:/iu, "")
    .replace(/\s+/g, "");
}

function getRequestIp(req) {
  const forwarded = sanitizeString(req.get("cf-connecting-ip") || req.get("x-forwarded-for"))
    .split(",")[0]
    .trim();
  return normalizeIp(forwarded || req.ip || req.socket?.remoteAddress || "");
}

function createDefaultPlatformState() {
  return {
    subjects: [],
    bans: [],
    visitors: [],
  };
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

function countMojibakeMarkers(value) {
  return (String(value || "").match(/(?:Ã.|Â.|â.|Ø.|Ù.)/gu) || []).length;
}

function scoreDisplayCandidate(text) {
  return scoreDecodedText(text) - countMojibakeMarkers(text) * 10;
}

function repairDisplayText(value) {
  const input = sanitizeString(value);
  if (!input) {
    return "";
  }

  const candidates = new Set([input]);
  for (const sourceEncoding of ["latin1", "win1252", "windows-1256"]) {
    try {
      const bytes = iconv.encode(input, sourceEncoding);
      candidates.add(decodeTextBuffer(bytes));
      candidates.add(iconv.decode(bytes, "utf8"));
      candidates.add(iconv.decode(bytes, "windows-1256"));
    } catch {
      // Ignore encoding failures and keep the original text.
    }
  }

  let best = input;
  let bestScore = scoreDisplayCandidate(input);
  for (const candidate of candidates) {
    const cleaned = sanitizeString(candidate);
    if (!cleaned) {
      continue;
    }

    const score = scoreDisplayCandidate(cleaned);
    if (score > bestScore) {
      best = cleaned;
      bestScore = score;
    }
  }

  return best;
}

function normalizeUploadedFileName(fileOrName) {
  const original = typeof fileOrName === "string" ? fileOrName : fileOrName?.originalname;
  return repairDisplayText(original);
}

function stripFileExtension(value) {
  const fileName = sanitizeString(value);
  if (!fileName) {
    return "";
  }

  const extension = path.extname(fileName);
  return sanitizeString(path.basename(fileName, extension));
}

function looksLikeMojibake(value) {
  return countMojibakeMarkers(value) >= 2;
}

function inferSummaryTitle({ title, text, fileName }, fallbackTitle = "ملخص جديد") {
  const requestedTitle = stripFileExtension(repairDisplayText(title));
  const normalizedFileTitle = stripFileExtension(normalizeUploadedFileName(fileName));
  const titleMatchesFileName =
    requestedTitle &&
    normalizedFileTitle &&
    normalizeForComparison(requestedTitle) === normalizeForComparison(normalizedFileTitle);

  if (requestedTitle && !looksLikeMojibake(requestedTitle) && !titleMatchesFileName) {
    return requestedTitle;
  }

  const firstLine = normalizeText(text)
    .split("\n")
    .map((line) => repairDisplayText(line))
    .find((line) => line && line.length >= 4 && line.length <= 120);

  if (firstLine) {
    return trimText(firstLine, 90);
  }

  if (normalizedFileTitle && !looksLikeMojibake(normalizedFileTitle)) {
    return normalizedFileTitle;
  }

  return fallbackTitle;
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

function normalizeStringArray(values, limit = 12) {
  if (!Array.isArray(values)) {
    return [];
  }

  const unique = new Set();
  for (const value of values) {
    const cleaned = sanitizeString(value);
    if (cleaned) {
      unique.add(cleaned);
    }

    if (unique.size >= limit) {
      break;
    }
  }

  return Array.from(unique);
}

function tokenizeSignificant(value) {
  return normalizeForComparison(value)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token));
}

function uniqueTokens(value) {
  return Array.from(new Set(Array.isArray(value) ? value : tokenizeSignificant(value)));
}

function trimText(value, maxLength = 320) {
  const cleaned = sanitizeString(value);
  if (!cleaned || cleaned.length <= maxLength) {
    return cleaned;
  }

  return `${cleaned.slice(0, maxLength - 1).trim()}…`;
}

function splitMaterialSegments(text) {
  return normalizeText(text)
    .split(/\n{2,}|(?<=[.!?؟])\s+/u)
    .map((segment) => sanitizeString(segment))
    .filter((segment) => segment.length >= 25);
}

function scoreMaterialSegment(questionTokens, segment) {
  if (!questionTokens.length) {
    return 0;
  }

  const segmentText = normalizeForComparison(segment);
  const segmentTokens = uniqueTokens(segment);
  const overlap = questionTokens.filter((token) => segmentTokens.includes(token));
  if (!overlap.length) {
    return 0;
  }

  let score = overlap.length * 4;
  if (segment.length <= 280) {
    score += 1;
  }

  if (questionTokens.some((token) => segmentText.includes(token))) {
    score += 1;
  }

  return score;
}

function selectRelevantMaterialSegments(questionText, materialText, limit = 2) {
  const questionTokens = uniqueTokens(stripQuestionPrefix(questionText)).slice(0, 10);
  if (!questionTokens.length) {
    return [];
  }

  return splitMaterialSegments(materialText)
    .map((segment) => ({
      segment,
      score: scoreMaterialSegment(questionTokens, segment),
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.segment.length - right.segment.length)
    .slice(0, limit)
    .map((item) => item.segment);
}

function extractMaterialKeywords(questionText, segments, limit = 6) {
  if (!segments.length) {
    return [];
  }

  const questionTokens = new Set(uniqueTokens(stripQuestionPrefix(questionText)));
  const counts = new Map();

  for (const segment of segments) {
    for (const token of uniqueTokens(segment)) {
      if (questionTokens.has(token) || token.length < 3) {
        continue;
      }

      counts.set(token, (counts.get(token) || 0) + 1);
    }
  }

  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1] || right[0].length - left[0].length)
    .slice(0, limit)
    .map(([token]) => token);
}

function summarizeMaterialReference(segments, maxLength = 320) {
  if (!segments.length) {
    return "";
  }

  let combined = "";
  for (const segment of segments) {
    const nextValue = combined ? `${combined} ${segment}` : segment;
    if (nextValue.length > maxLength) {
      break;
    }
    combined = nextValue;
  }

  return trimText(combined || segments[0], maxLength);
}

function buildShortAnswerExplanation(question) {
  const correctAnswerText = sanitizeString(question?.correctAnswerText);
  const gradingKeywords = normalizeStringArray(question?.gradingKeywords);
  const referenceText = sanitizeString(question?.referenceText);

  if (correctAnswerText) {
    return `الإجابة المتوقعة هي "${correctAnswerText}".`;
  }

  if (gradingKeywords.length) {
    return `يتم تصحيح هذا السؤال اعتماداً على كلمات مفتاحية من المادة: ${gradingKeywords.join("، ")}.`;
  }

  if (referenceText) {
    return "يتم تصحيح هذا السؤال اعتماداً على المرجع المرفوع مع المادة.";
  }

  return "هذا السؤال الكتابي يحتاج مراجعة يدوية بعد الإرسال.";
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
    return buildShortAnswerExplanation({ correctAnswerText: correctAnswerValue });
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

function inferQuestionPoints(questionText, explicitValue) {
  const parsedExplicit = clampNumber(explicitValue, 1, 100, 0);
  if (parsedExplicit > 0) {
    return parsedExplicit;
  }

  const text = sanitizeString(questionText);
  if (!text) {
    return 1;
  }

  const markMatch = text.match(/(?:\(|\[)?\s*([0-9\u0660-\u0669]{1,2})\s*(?:marks?|mark|درجة|درجات)\s*(?:\)|\])?/iu);
  if (!markMatch) {
    return 1;
  }

  return clampNumber(toWesternDigits(markMatch[1]), 1, 100, 1);
}

function buildBigrams(value) {
  const normalized = normalizeForComparison(value).replace(/\s+/g, "");
  if (normalized.length < 2) {
    return normalized ? [normalized] : [];
  }

  const grams = [];
  for (let index = 0; index < normalized.length - 1; index += 1) {
    grams.push(normalized.slice(index, index + 2));
  }
  return grams;
}

function diceCoefficient(left, right) {
  const leftBigrams = buildBigrams(left);
  const rightBigrams = buildBigrams(right);
  if (!leftBigrams.length || !rightBigrams.length) {
    return 0;
  }

  const rightCounts = new Map();
  rightBigrams.forEach((item) => {
    rightCounts.set(item, (rightCounts.get(item) || 0) + 1);
  });

  let overlap = 0;
  leftBigrams.forEach((item) => {
    const count = rightCounts.get(item) || 0;
    if (count > 0) {
      overlap += 1;
      rightCounts.set(item, count - 1);
    }
  });

  return (2 * overlap) / (leftBigrams.length + rightBigrams.length);
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
  const gradingKeywords =
    type === QUESTION_TYPES.SHORT_ANSWER ? normalizeStringArray(question?.gradingKeywords, 8) : [];
  const referenceText =
    type === QUESTION_TYPES.SHORT_ANSWER ? trimText(question?.referenceText, 420) : "";
  const sourceLabel = type === QUESTION_TYPES.SHORT_ANSWER ? sanitizeString(question?.sourceLabel) : "";
  const points = inferQuestionPoints(questionText, question?.points);

  return {
    id: index + 1,
    type,
    questionText,
    points,
    options,
    correctAnswerIndex,
    correctAnswerText,
    gradingKeywords,
    referenceText,
    sourceLabel,
    placeholder:
      type === QUESTION_TYPES.SHORT_ANSWER
        ? sanitizeString(question?.placeholder, "اكتب إجابتك هنا")
        : "",
    explanation:
      sanitizeString(question?.explanation) ||
      (type === QUESTION_TYPES.SHORT_ANSWER
        ? buildShortAnswerExplanation({
            correctAnswerText,
            gradingKeywords,
            referenceText,
          })
        : buildDefaultExplanation(correctAnswerText, type)),
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

function enhanceShortAnswerQuestionFromMaterial(question, materialContext) {
  if (question.type !== QUESTION_TYPES.SHORT_ANSWER || !materialContext?.text) {
    return question;
  }

  const segments = selectRelevantMaterialSegments(question.questionText, materialContext.text, 2);
  const gradingKeywords = normalizeStringArray(
    question.gradingKeywords?.length
      ? question.gradingKeywords
      : extractMaterialKeywords(question.questionText, segments, 6),
    8,
  );
  const referenceText = sanitizeString(question.referenceText) || summarizeMaterialReference(segments, 420);
  const sourceLabel = sanitizeString(question.sourceLabel) || materialContext.sources.join(" + ");

  return {
    ...question,
    gradingKeywords,
    referenceText,
    sourceLabel,
    explanation:
      sanitizeString(question.explanation) ||
      buildShortAnswerExplanation({
        correctAnswerText: question.correctAnswerText,
        gradingKeywords,
        referenceText,
      }),
  };
}

function applyMaterialAutograding(parsedExam, materialContext) {
  const sources = normalizeStringArray(materialContext?.sources || [], 6);
  if (!sources.length && !sanitizeString(materialContext?.text)) {
    return {
      ...parsedExam,
      materialSources: [],
    };
  }

  return {
    ...parsedExam,
    materialSources: sources,
    questions: parsedExam.questions.map((question) =>
      enhanceShortAnswerQuestionFromMaterial(question, {
        text: materialContext?.text || "",
        sources,
      }),
    ),
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
  const extension = path.extname(normalizeUploadedFileName(file)).toLowerCase();

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

function escapeHtmlMarkup(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function findHeadlessBrowserPath() {
  const fsSync = require("fs");
  const candidates = [
    process.env.PDF_BROWSER_PATH,
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "/usr/bin/microsoft-edge",
    "/usr/bin/microsoft-edge-stable",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].filter(Boolean);

  return candidates.find((candidate) => {
    try {
      return fsSync.existsSync(candidate);
    } catch {
      return false;
    }
  }) || "";
}

async function renderTextPdfBuffer(title, text) {
  const browserPath = findHeadlessBrowserPath();
  if (!browserPath) {
    throw new Error("تعذر إيجاد متصفح يدعم إنشاء PDF على هذا الخادم.");
  }

  await ensureDataFile();
  const taskId = crypto.randomUUID();
  const htmlPath = path.join(TEMP_DIR, `${taskId}.html`);
  const pdfPath = path.join(TEMP_DIR, `${taskId}.pdf`);
  const direction = isArabicLike(`${title || ""} ${text || ""}`) ? "rtl" : "ltr";
  const html = `<!DOCTYPE html>
<html lang="${direction === "rtl" ? "ar" : "en"}" dir="${direction}">
<head>
  <meta charset="utf-8">
  <title>${escapeHtmlMarkup(title || "Summary")}</title>
  <style>
    body {
      margin: 34px;
      font-family: "Segoe UI", Tahoma, Arial, sans-serif;
      direction: ${direction};
      text-align: ${direction === "rtl" ? "right" : "left"};
      color: #111827;
    }
    h1 {
      margin: 0 0 18px;
      font-size: 24px;
      font-weight: 700;
    }
    .content {
      white-space: pre-wrap;
      line-height: 1.85;
      font-size: 14px;
      word-break: break-word;
    }
  </style>
</head>
<body>
  <h1>${escapeHtmlMarkup(title || "Summary")}</h1>
  <div class="content">${escapeHtmlMarkup(text || "")}</div>
</body>
</html>`;

  await fs.writeFile(htmlPath, html, "utf8");

  try {
    const fileUrl = `file:///${htmlPath.replace(/\\/g, "/")}`;
    await execFileAsync(
      browserPath,
      [
        "--headless=new",
        "--disable-gpu",
        "--no-first-run",
        "--allow-file-access-from-files",
        `--print-to-pdf=${pdfPath}`,
        fileUrl,
      ],
      {
        windowsHide: true,
        timeout: 45000,
        maxBuffer: 10 * 1024 * 1024,
      },
    );
    return await fs.readFile(pdfPath);
  } finally {
    await Promise.allSettled([fs.unlink(htmlPath), fs.unlink(pdfPath)]);
  }
}

function normalizeSummaryFileMeta(summary) {
  const fileName = normalizeUploadedFileName(summary?.fileName || summary?.sourceName);
  const storageName = sanitizeString(summary?.fileStorageName);
  const mimeType = sanitizeString(summary?.fileMimeType || summary?.mimeType);
  const fileSize = clampNumber(summary?.fileSize, 0, 25 * 1024 * 1024, 0);

  return {
    fileName,
    fileStorageName: storageName,
    fileMimeType: mimeType,
    fileSize,
    hasFile: Boolean(fileName && storageName),
  };
}

function buildSummaryDownloadUrl(summaryId) {
  return `/api/summaries/${encodeURIComponent(summaryId)}/download`;
}

async function saveSummaryFileToDisk(file) {
  await ensureDataFile();
  const originalName = normalizeUploadedFileName(file) || "summary-file";
  const extension = path.extname(originalName || "").toLowerCase() || path.extname(file.originalname || "").toLowerCase();
  if (extension === ".pdf") {
    const storageName = `${crypto.randomUUID()}.pdf`;
    await fs.writeFile(path.join(SUMMARY_FILES_DIR, storageName), file.buffer);
    return {
      fileName: `${stripFileExtension(originalName) || "summary-file"}.pdf`,
      fileStorageName: storageName,
      fileMimeType: "application/pdf",
      fileSize: Number(file.size || file.buffer?.length || 0),
    };
  }

  const extractedText = sanitizeString(await extractTextFromFile(file)) || sanitizeString(decodeTextBuffer(file.buffer));
  const pdfBuffer = await renderTextPdfBuffer(stripFileExtension(originalName) || "summary-file", extractedText);
  const storageName = `${crypto.randomUUID()}.pdf`;
  await fs.writeFile(path.join(SUMMARY_FILES_DIR, storageName), pdfBuffer);
  return {
    fileName: `${stripFileExtension(originalName) || "summary-file"}.pdf`,
    fileStorageName: storageName,
    fileMimeType: "application/pdf",
    fileSize: Number(pdfBuffer.length || 0),
  };
}

async function deleteStoredSummaryFile(summary) {
  const storageName = sanitizeString(summary?.fileStorageName);
  if (!storageName) {
    return;
  }

  try {
    await fs.unlink(path.join(SUMMARY_FILES_DIR, storageName));
  } catch {
    // Ignore missing or already deleted files.
  }
}

async function deleteStoredSummaryFilesFromSection(section) {
  const summaries = Array.isArray(section?.summaries) ? section.summaries : [];
  await Promise.all(summaries.map((summary) => deleteStoredSummaryFile(summary)));
}

async function deleteStoredSummaryFilesFromSubject(subject) {
  const sections = Array.isArray(subject?.sections) ? subject.sections : [];
  await Promise.all(sections.map((section) => deleteStoredSummaryFilesFromSection(section)));
}

function normalizeQuestionForStorage(question, index) {
  return normalizeQuestionRecord(question, index);
}

function normalizeExamForStorage(input) {
  const duration = clampNumber(input?.duration, 5, 300, 60);
  const examTitle = sanitizeString(input?.examTitle, "امتحان جديد");
  const instructions = sanitizeString(input?.instructions);
  const materialSources = normalizeStringArray(input?.materialSources, 6);
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
    materialSources,
    questions,
  };
}

function publicExamSummary(exam) {
  const totalPoints = (Array.isArray(exam.questions) ? exam.questions : []).reduce(
    (total, question) => total + inferQuestionPoints(question?.questionText, question?.points),
    0,
  );
  return {
    id: exam.id,
    examTitle: exam.examTitle,
    duration: exam.duration,
    questionCount: exam.questions.length,
    totalPoints,
    publishedAt: exam.publishedAt,
    instructions: exam.instructions || "",
    materialSourceCount: Array.isArray(exam.materialSources) ? exam.materialSources.length : 0,
    shortAnswerAutoGradeCount: exam.questions.filter(
      (question) =>
        question.type === QUESTION_TYPES.SHORT_ANSWER &&
        (sanitizeString(question.correctAnswerText) ||
          sanitizeString(question.referenceText) ||
          normalizeStringArray(question.gradingKeywords).length),
    ).length,
    questionTypes: exam.questions.reduce((accumulator, question) => {
      accumulator[question.type] = (accumulator[question.type] || 0) + 1;
      return accumulator;
    }, {}),
  };
}

function studentExamPayload(exam) {
  const totalPoints = (Array.isArray(exam.questions) ? exam.questions : []).reduce(
    (total, question) => total + inferQuestionPoints(question?.questionText, question?.points),
    0,
  );
  return {
    id: exam.id,
    examTitle: exam.examTitle,
    duration: exam.duration,
    totalPoints,
    instructions: exam.instructions || "",
    publishedAt: exam.publishedAt,
    questions: exam.questions.map((question) => ({
      id: question.id,
      type: question.type,
      questionText: question.questionText,
      points: inferQuestionPoints(question?.questionText, question?.points),
      options: question.options,
      placeholder: question.placeholder || "",
    })),
  };
}

function ownerExamPayload(exam) {
  const totalPoints = (Array.isArray(exam.questions) ? exam.questions : []).reduce(
    (total, question) => total + inferQuestionPoints(question?.questionText, question?.points),
    0,
  );
  return {
    id: exam.id,
    examTitle: exam.examTitle,
    duration: exam.duration,
    totalPoints,
    instructions: exam.instructions || "",
    publishedAt: exam.publishedAt,
    materialSources: normalizeStringArray(exam.materialSources, 6),
    questions: exam.questions.map((question) => ({
      id: question.id,
      type: question.type,
      questionText: question.questionText,
      points: inferQuestionPoints(question?.questionText, question?.points),
      options: question.options,
      correctAnswerIndex: question.correctAnswerIndex,
      correctAnswerText: question.correctAnswerText || "",
      placeholder: question.placeholder || "",
      gradingKeywords: normalizeStringArray(question.gradingKeywords, 8),
      referenceText: question.referenceText || "",
      sourceLabel: question.sourceLabel || "",
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

function matchKeywordPhrases(userAnswerText, gradingKeywords) {
  const normalizedUser = normalizeForComparison(userAnswerText);
  if (!normalizedUser) {
    return [];
  }

  return normalizeStringArray(gradingKeywords, 8).filter((keyword) => {
    const normalizedKeyword = normalizeForComparison(keyword);
    if (!normalizedKeyword) {
      return false;
    }

    return (
      normalizedUser === normalizedKeyword ||
      normalizedUser.includes(normalizedKeyword) ||
      (normalizedKeyword.split(" ").length === 1 && tokenizeSignificant(userAnswerText).includes(normalizedKeyword))
    );
  });
}

function bestExpectedAnswerSimilarity(userAnswerText, correctAnswerText) {
  return splitAcceptableAnswers(correctAnswerText).reduce((bestScore, candidate) => {
    return Math.max(bestScore, diceCoefficient(userAnswerText, candidate));
  }, 0);
}

function scoreKeywordCoverage(userAnswerText, gradingKeywords) {
  const normalizedKeywords = normalizeStringArray(gradingKeywords, 8);
  if (!normalizedKeywords.length) {
    return {
      matchedKeywords: [],
      ratio: 0,
    };
  }

  const matchedKeywords = matchKeywordPhrases(userAnswerText, normalizedKeywords);
  return {
    matchedKeywords,
    ratio: matchedKeywords.length / normalizedKeywords.length,
  };
}

function scoreReferenceCoverage(userAnswerText, referenceText, expectedAnswer) {
  const referenceTokens = uniqueTokens(`${expectedAnswer} ${referenceText}`).slice(0, 14);
  if (!referenceTokens.length) {
    return {
      matchedReferenceTokens: [],
      ratio: 0,
    };
  }

  const userTokens = uniqueTokens(userAnswerText);
  const matchedReferenceTokens = referenceTokens.filter((token) => userTokens.includes(token));
  return {
    matchedReferenceTokens,
    ratio: matchedReferenceTokens.length / referenceTokens.length,
  };
}

function buildShortAnswerFeedback({ evaluation, matchedKeywords, matchedReferenceTokens }) {
  if (evaluation === "correct") {
    return "إجابتك صحيحة.";
  }

  if (evaluation === "close") {
    return matchedKeywords.length || matchedReferenceTokens.length
      ? "إجابتك قريبة من الصحيحة وتم منحك درجة جزئية."
      : "إجابتك قريبة من الصحيحة، لكنها تحتاج تفاصيل أكثر.";
  }

  return "إجابتك غير مطابقة بشكل كافٍ للإجابة المتوقعة.";
}

function autoGradeShortAnswer(question, userAnswerText) {
  const expectedAnswer = sanitizeString(question.correctAnswerText);
  const gradingKeywords = normalizeStringArray(question.gradingKeywords, 8);
  const referenceText = sanitizeString(question.referenceText);
  const answered = Boolean(userAnswerText);
  const canAutoGrade = Boolean(expectedAnswer || gradingKeywords.length || referenceText);

  if (!answered) {
    return {
      answered: false,
      canAutoGrade,
      isCorrect: canAutoGrade ? false : null,
      evaluation: "unanswered",
      scoreRatio: 0,
      userAnswerIndex: null,
      userAnswerText: "",
      autoGradeBasis: canAutoGrade ? "reference" : "",
      matchedKeywords: [],
      matchedReferenceTokens: [],
      feedback: "لم تتم الإجابة على هذا السؤال.",
    };
  }

  if (expectedAnswer && isTextAnswerCorrect(userAnswerText, expectedAnswer)) {
    return {
      answered: true,
      canAutoGrade: true,
      isCorrect: true,
      evaluation: "correct",
      scoreRatio: 1,
      userAnswerIndex: null,
      userAnswerText,
      autoGradeBasis: "expected_answer",
      matchedKeywords: matchKeywordPhrases(userAnswerText, gradingKeywords),
      matchedReferenceTokens: [],
      feedback: "إجابتك صحيحة.",
    };
  }

  if (!canAutoGrade) {
    return {
      answered: true,
      canAutoGrade: false,
      isCorrect: null,
      evaluation: "pending",
      scoreRatio: 0,
      userAnswerIndex: null,
      userAnswerText,
      autoGradeBasis: "",
      matchedKeywords: [],
      matchedReferenceTokens: [],
      feedback: "هذا السؤال يحتاج مراجعة من المالك.",
    };
  }

  const expectedSimilarity = expectedAnswer ? bestExpectedAnswerSimilarity(userAnswerText, expectedAnswer) : 0;
  const keywordCoverage = scoreKeywordCoverage(userAnswerText, gradingKeywords);
  const referenceCoverage = scoreReferenceCoverage(userAnswerText, referenceText, expectedAnswer);
  const combinedScore =
    Math.min(
      1,
      expectedSimilarity * 0.55 +
        keywordCoverage.ratio * 0.25 +
        referenceCoverage.ratio * 0.2 +
        (expectedSimilarity >= 0.78 ? 0.12 : 0),
    );
  const evaluation =
    combinedScore >= 0.85
      ? "correct"
      : combinedScore >= 0.45 || keywordCoverage.matchedKeywords.length >= 1 || referenceCoverage.ratio >= 0.28
        ? "close"
        : "wrong";
  const scoreRatio =
    evaluation === "correct"
      ? 1
      : evaluation === "close"
        ? Math.max(0.5, Math.min(0.84, combinedScore || 0.5))
        : 0;
  const isCorrect = evaluation === "correct";

  return {
    answered: true,
    canAutoGrade: true,
    isCorrect,
    evaluation,
    scoreRatio,
    userAnswerIndex: null,
    userAnswerText,
    autoGradeBasis: expectedAnswer ? "expected_answer" : "reference",
    matchedKeywords: keywordCoverage.matchedKeywords,
    matchedReferenceTokens: referenceCoverage.matchedReferenceTokens,
    feedback: buildShortAnswerFeedback({
      evaluation,
      matchedKeywords: keywordCoverage.matchedKeywords,
      matchedReferenceTokens: referenceCoverage.matchedReferenceTokens,
    }),
  };
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
    return autoGradeShortAnswer(question, userAnswerText);
  }

  const userAnswerIndex = Number.isInteger(rawAnswer) ? rawAnswer : Number.parseInt(rawAnswer, 10);
  const answered = Number.isInteger(userAnswerIndex);
  const isCorrect = answered && userAnswerIndex === question.correctAnswerIndex;

  return {
    answered,
    canAutoGrade: true,
    isCorrect,
    evaluation: !answered ? "unanswered" : isCorrect ? "correct" : "wrong",
    scoreRatio: isCorrect ? 1 : 0,
    userAnswerIndex: answered ? userAnswerIndex : null,
    userAnswerText: "",
    autoGradeBasis: "",
    matchedKeywords: [],
    matchedReferenceTokens: [],
    feedback: !answered ? "لم تتم الإجابة على هذا السؤال." : isCorrect ? "إجابتك صحيحة." : "إجابتك خاطئة.",
  };
}

async function ensureDataFile() {
  if (tursoClient) {
    await tursoClient.execute(`
      CREATE TABLE IF NOT EXISTS kv_store (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

    const documents = [
      { key: "exams", value: "[]" },
      { key: "results", value: "[]" },
      { key: "users", value: "[]" },
      { key: "platform", value: JSON.stringify(createDefaultPlatformState(), null, 2) },
    ];

    for (const document of documents) {
      await tursoClient.execute({
        sql: `
          INSERT INTO kv_store (key, value, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT(key) DO NOTHING
        `,
        args: [document.key, document.value, new Date().toISOString()],
      });
    }

    return;
  }

  await fs.mkdir(DATA_ROOT, { recursive: true });
  await fs.mkdir(SUMMARY_FILES_DIR, { recursive: true });
  await fs.mkdir(TEMP_DIR, { recursive: true });
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

  try {
    await fs.access(PLATFORM_FILE);
  } catch {
    await fs.writeFile(PLATFORM_FILE, JSON.stringify(createDefaultPlatformState(), null, 2), "utf8");
  }

  try {
    await fs.access(USERS_FILE);
  } catch {
    await fs.writeFile(USERS_FILE, "[]", "utf8");
  }
}

async function readExams() {
  await ensureDataFile();
  if (tursoClient) {
    try {
      const response = await tursoClient.execute({
        sql: "SELECT value FROM kv_store WHERE key = ?",
        args: ["exams"],
      });
      const raw = response.rows?.[0]?.value || "[]";
      const parsed = JSON.parse(String(raw || "[]"));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

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
  if (tursoClient) {
    await tursoClient.execute({
      sql: `
        INSERT INTO kv_store (key, value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `,
      args: ["exams", JSON.stringify(Array.isArray(exams) ? exams : [], null, 2), new Date().toISOString()],
    });
    return;
  }

  await fs.writeFile(DATA_FILE, JSON.stringify(Array.isArray(exams) ? exams : [], null, 2), "utf8");
}

async function readResults() {
  await ensureDataFile();
  if (tursoClient) {
    try {
      const response = await tursoClient.execute({
        sql: "SELECT value FROM kv_store WHERE key = ?",
        args: ["results"],
      });
      const raw = response.rows?.[0]?.value || "[]";
      const parsed = JSON.parse(String(raw || "[]"));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

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
  if (tursoClient) {
    await tursoClient.execute({
      sql: `
        INSERT INTO kv_store (key, value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `,
      args: ["results", JSON.stringify(Array.isArray(results) ? results : [], null, 2), new Date().toISOString()],
    });
    return;
  }

  await fs.writeFile(RESULTS_FILE, JSON.stringify(Array.isArray(results) ? results : [], null, 2), "utf8");
}

function hashPasswordSecret(password, salt = crypto.randomBytes(16).toString("hex")) {
  const secret = String(password || "");
  const hash = crypto.scryptSync(secret, salt, 64).toString("hex");
  return { salt, hash };
}

function verifyPasswordSecret(password, salt, expectedHash) {
  if (!salt || !expectedHash) {
    return false;
  }

  const candidate = crypto.scryptSync(String(password || ""), String(salt), 64).toString("hex");
  return safeCompare(candidate, expectedHash);
}

function normalizeUserSessionRecord(session) {
  const token = sanitizeString(session?.token);
  if (!token) {
    return null;
  }

  return {
    token,
    deviceId: normalizeDeviceId(session?.deviceId),
    createdAt: sanitizeString(session?.createdAt) || formatArabicDate(),
    createdAtIso: sanitizeString(session?.createdAtIso) || new Date().toISOString(),
    lastUsedAt: sanitizeString(session?.lastUsedAt) || sanitizeString(session?.createdAt) || formatArabicDate(),
    lastUsedAtIso: sanitizeString(session?.lastUsedAtIso) || sanitizeString(session?.createdAtIso) || new Date().toISOString(),
  };
}

function normalizeDownloadRecord(download) {
  const summaryId = sanitizeString(download?.summaryId);
  if (!summaryId) {
    return null;
  }

  return {
    id: sanitizeString(download?.id) || crypto.randomUUID(),
    summaryId,
    subjectName: repairDisplayText(download?.subjectName),
    sectionName: repairDisplayText(download?.sectionName),
    summaryTitle: repairDisplayText(download?.summaryTitle),
    fileName: repairDisplayText(download?.fileName),
    downloadedAt: sanitizeString(download?.downloadedAt) || formatArabicDate(),
    downloadedAtIso: sanitizeString(download?.downloadedAtIso) || new Date().toISOString(),
  };
}

function normalizeUserRecord(user) {
  const email = normalizeEmail(user?.email);
  if (!isValidEmail(email)) {
    return null;
  }

  return {
    id: sanitizeString(user?.id) || crypto.randomUUID(),
    name: trimText(repairDisplayText(user?.name), 120) || "طالب",
    email,
    passwordSalt: sanitizeString(user?.passwordSalt),
    passwordHash: sanitizeString(user?.passwordHash),
    avatarLabel: trimText(repairDisplayText(user?.avatarLabel), 12),
    createdAt: sanitizeString(user?.createdAt) || formatArabicDate(),
    createdAtIso: sanitizeString(user?.createdAtIso) || new Date().toISOString(),
    lastLoginAt: sanitizeString(user?.lastLoginAt),
    lastLoginAtIso: sanitizeString(user?.lastLoginAtIso),
    sessions: (Array.isArray(user?.sessions) ? user.sessions : [])
      .map((session) => normalizeUserSessionRecord(session))
      .filter(Boolean)
      .slice(0, MAX_USER_SESSIONS),
    downloads: (Array.isArray(user?.downloads) ? user.downloads : [])
      .map((download) => normalizeDownloadRecord(download))
      .filter(Boolean)
      .slice(0, MAX_USER_DOWNLOADS),
    resultIds: normalizeStringArray(user?.resultIds, MAX_USER_RESULTS),
  };
}

async function readUsers() {
  await ensureDataFile();
  if (tursoClient) {
    try {
      const response = await tursoClient.execute({
        sql: "SELECT value FROM kv_store WHERE key = ?",
        args: ["users"],
      });
      const raw = response.rows?.[0]?.value || "[]";
      const parsed = JSON.parse(String(raw || "[]"));
      return Array.isArray(parsed) ? parsed.map((user) => normalizeUserRecord(user)).filter(Boolean) : [];
    } catch {
      return [];
    }
  }

  const raw = await fs.readFile(USERS_FILE, "utf8");
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((user) => normalizeUserRecord(user)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

async function writeUsers(users) {
  const normalized = (Array.isArray(users) ? users : []).map((user) => normalizeUserRecord(user)).filter(Boolean);
  await ensureDataFile();
  if (tursoClient) {
    await tursoClient.execute({
      sql: `
        INSERT INTO kv_store (key, value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `,
      args: ["users", JSON.stringify(normalized, null, 2), new Date().toISOString()],
    });
    return;
  }

  await fs.writeFile(USERS_FILE, JSON.stringify(normalized, null, 2), "utf8");
}

function getStudentTokenFromRequest(req) {
  return sanitizeString(req.get(STUDENT_TOKEN_HEADER) || req.body?.studentToken || req.query?.studentToken);
}

function getDeviceIdFromRequest(req) {
  return normalizeDeviceId(req.get(DEVICE_ID_HEADER) || req.body?.deviceId || req.query?.deviceId);
}

function getUserBySessionToken(users, token) {
  const normalizedToken = sanitizeString(token);
  if (!normalizedToken) {
    return null;
  }

  return (Array.isArray(users) ? users : []).find((user) =>
    (Array.isArray(user.sessions) ? user.sessions : []).some((session) => session.token === normalizedToken),
  ) || null;
}

function createStudentSession(deviceId = "") {
  const now = new Date();
  return normalizeUserSessionRecord({
    token: crypto.randomUUID(),
    deviceId,
    createdAt: formatArabicDate(now),
    createdAtIso: now.toISOString(),
    lastUsedAt: formatArabicDate(now),
    lastUsedAtIso: now.toISOString(),
  });
}

async function touchStudentSession(users, userId, token, deviceId = "") {
  const user = users.find((item) => item.id === userId);
  if (!user) {
    return null;
  }

  const now = new Date();
  user.sessions = (Array.isArray(user.sessions) ? user.sessions : [])
    .map((session) => {
      if (session.token !== token) {
        return session;
      }

      return normalizeUserSessionRecord({
        ...session,
        deviceId: deviceId || session.deviceId,
        lastUsedAt: formatArabicDate(now),
        lastUsedAtIso: now.toISOString(),
      });
    })
    .filter(Boolean)
    .slice(0, MAX_USER_SESSIONS);
  user.lastLoginAt = formatArabicDate(now);
  user.lastLoginAtIso = now.toISOString();
  await writeUsers(users);
  return normalizeUserRecord(user);
}

function buildStudentPublicProfile(user, results = []) {
  const normalizedUser = normalizeUserRecord(user);
  if (!normalizedUser) {
    return null;
  }

  const recentResults = (Array.isArray(results) ? results : [])
    .filter((result) => result.userId === normalizedUser.id || normalizeEmail(result.studentEmail) === normalizedUser.email)
    .sort((left, right) => (Date.parse(right.submittedAtIso || "") || 0) - (Date.parse(left.submittedAtIso || "") || 0))
    .slice(0, MAX_USER_RESULTS)
    .map((result) => ({
      id: result.id,
      examId: result.examId,
      examTitle: result.examTitle,
      scorePercent: result.scorePercent,
      earnedPoints: Number(result.earnedPoints || 0),
      totalPoints: Number(result.totalPoints || 0),
      submittedAt: result.submittedAt || "",
    }));

  return {
    id: normalizedUser.id,
    name: normalizedUser.name,
    email: normalizedUser.email,
    createdAt: normalizedUser.createdAt,
    lastLoginAt: normalizedUser.lastLoginAt || "",
    downloads: [...normalizedUser.downloads].sort(
      (left, right) => (Date.parse(right.downloadedAtIso || "") || 0) - (Date.parse(left.downloadedAtIso || "") || 0),
    ),
    results: recentResults,
  };
}

function addDownloadToUserRecord(users, userId, payload) {
  const user = (Array.isArray(users) ? users : []).find((item) => item.id === userId);
  if (!user) {
    return null;
  }

  const normalizedDownload = normalizeDownloadRecord(payload);
  if (!normalizedDownload) {
    return null;
  }

  user.downloads = [normalizedDownload, ...(Array.isArray(user.downloads) ? user.downloads : [])]
    .map((item) => normalizeDownloadRecord(item))
    .filter(Boolean)
    .slice(0, MAX_USER_DOWNLOADS);

  return normalizeUserRecord(user);
}

function addResultToUserRecord(users, userId, resultId) {
  const user = (Array.isArray(users) ? users : []).find((item) => item.id === userId);
  if (!user) {
    return null;
  }

  user.resultIds = [sanitizeString(resultId), ...(Array.isArray(user.resultIds) ? user.resultIds : [])]
    .filter(Boolean)
    .slice(0, MAX_USER_RESULTS);

  return normalizeUserRecord(user);
}

function normalizeSummaryRecord(summary, fallbackTitle = "ملخص جديد") {
  const text = trimText(summary?.text, 20000);
  const fileMeta = normalizeSummaryFileMeta(summary);
  const title = inferSummaryTitle(
    {
      title: summary?.title,
      text,
      fileName: fileMeta.fileName,
    },
    fallbackTitle,
  );
  if (!text && !fileMeta.hasFile) {
    return null;
  }

  return {
    id: sanitizeString(summary?.id) || crypto.randomUUID(),
    title,
    text,
    sourceName: "",
    fileName: fileMeta.fileName,
    fileStorageName: fileMeta.fileStorageName,
    fileMimeType: fileMeta.fileMimeType,
    fileSize: fileMeta.fileSize,
    uploadedAt: sanitizeString(summary?.uploadedAt) || formatArabicDate(),
    uploadedAtIso: sanitizeString(summary?.uploadedAtIso) || new Date().toISOString(),
    updatedAt: sanitizeString(summary?.updatedAt) || sanitizeString(summary?.uploadedAt) || formatArabicDate(),
    updatedAtIso: sanitizeString(summary?.updatedAtIso) || sanitizeString(summary?.uploadedAtIso) || new Date().toISOString(),
  };
}

function normalizeSectionRecord(section, fallbackName = "قسم جديد") {
  const summaries = Array.isArray(section?.summaries)
    ? section.summaries.map((item, index) => normalizeSummaryRecord(item, `ملخص ${index + 1}`)).filter(Boolean)
    : [];

  return {
    id: sanitizeString(section?.id) || crypto.randomUUID(),
    name: repairDisplayText(section?.name) || fallbackName,
    summaries,
  };
}

function normalizeSubjectRecord(subject, fallbackName = "مادة جديدة") {
  const sections = Array.isArray(subject?.sections)
    ? subject.sections.map((item, index) => normalizeSectionRecord(item, `قسم ${index + 1}`)).filter(Boolean)
    : [];

  return {
    id: sanitizeString(subject?.id) || crypto.randomUUID(),
    name: repairDisplayText(subject?.name) || fallbackName,
    description: repairDisplayText(subject?.description),
    sections,
  };
}

function normalizeBanRecord(ban) {
  const type = ban?.type === "ip" ? "ip" : ban?.type === "device" ? "device" : "email";
  const value =
    type === "ip"
      ? normalizeIp(ban?.value)
      : type === "device"
        ? normalizeDeviceId(ban?.value)
        : normalizeEmail(ban?.value);
  if (!value) {
    return null;
  }

  if (type === "email" && !isValidEmail(value)) {
    return null;
  }

  return {
    id: sanitizeString(ban?.id) || crypto.randomUUID(),
    type,
    value,
    reason: sanitizeString(ban?.reason),
    createdAt: sanitizeString(ban?.createdAt) || formatArabicDate(),
    createdAtIso: sanitizeString(ban?.createdAtIso) || new Date().toISOString(),
  };
}

function viewportWidthFromString(value) {
  const match = sanitizeString(value).match(/^(\d{2,5})\s*[x×]/u);
  return match ? clampNumber(match[1], 0, 10000, 0) : 0;
}

function detectBrowserName(userAgent) {
  const ua = String(userAgent || "");
  if (/edg\//i.test(ua)) {
    return "Edge";
  }
  if (/samsungbrowser\//i.test(ua)) {
    return "Samsung Internet";
  }
  if (/opr\//i.test(ua) || /opera/i.test(ua)) {
    return "Opera";
  }
  if (/firefox\//i.test(ua) || /fxios\//i.test(ua)) {
    return "Firefox";
  }
  if (/chrome\//i.test(ua) || /crios\//i.test(ua)) {
    return "Chrome";
  }
  if (/safari\//i.test(ua) && !/chrome|crios|chromium|android/i.test(ua)) {
    return "Safari";
  }
  if (/trident|msie/i.test(ua)) {
    return "Internet Explorer";
  }
  return "";
}

function detectOperatingSystem(userAgent, platform = "") {
  const sample = `${userAgent || ""} ${platform || ""}`;
  if (/windows/i.test(sample)) {
    return "Windows";
  }
  if (/android/i.test(sample)) {
    return "Android";
  }
  if (/iphone|ipad|ipod|ios/i.test(sample)) {
    return "iOS";
  }
  if (/macintosh|mac os x|macos/i.test(sample)) {
    return "macOS";
  }
  if (/cros|chrome os/i.test(sample)) {
    return "ChromeOS";
  }
  if (/linux/i.test(sample)) {
    return "Linux";
  }
  return "";
}

function detectDeviceType(userAgent, viewport = "", touchPoints = 0) {
  const ua = String(userAgent || "");
  const width = viewportWidthFromString(viewport);

  if (/ipad|tablet|sm-t|tab/i.test(ua) || (/android/i.test(ua) && !/mobile/i.test(ua))) {
    return "tablet";
  }
  if (/mobi|iphone|ipod|android/i.test(ua)) {
    return "mobile";
  }
  if (width && width <= 820 && Number(touchPoints || 0) > 0) {
    return "mobile";
  }
  return "desktop";
}

function buildVisitorSummary(visitor) {
  return [visitor.deviceType, visitor.operatingSystem, visitor.browser, visitor.deviceModel]
    .map((value) => sanitizeString(value))
    .filter(Boolean)
    .join(" • ");
}

function normalizeVisitorRecord(visitor) {
  const now = new Date();
  const userAgent = trimText(visitor?.userAgent, 640);
  const platform = trimText(visitor?.platform, 80);
  const studentEmail = normalizeEmail(visitor?.studentEmail);
  const parsedDeviceMemory = Number.parseFloat(visitor?.deviceMemory);

  return {
    id: sanitizeString(visitor?.id) || crypto.randomUUID(),
    sessionId: trimText(visitor?.sessionId, 140),
    deviceId: normalizeDeviceId(visitor?.deviceId),
    accountId: sanitizeString(visitor?.accountId),
    studentName: trimText(visitor?.studentName, 120),
    studentEmail: isValidEmail(studentEmail) ? studentEmail : "",
    ipAddress: normalizeIp(visitor?.ipAddress),
    country: sanitizeString(visitor?.country).toUpperCase(),
    browser: sanitizeString(visitor?.browser) || detectBrowserName(userAgent),
    operatingSystem: sanitizeString(visitor?.operatingSystem) || detectOperatingSystem(userAgent, platform),
    deviceType: sanitizeString(visitor?.deviceType) || detectDeviceType(userAgent, visitor?.viewport, visitor?.touchPoints),
    deviceModel: trimText(visitor?.deviceModel, 80),
    platform,
    language: sanitizeString(visitor?.language),
    languages: normalizeStringArray(visitor?.languages, 6),
    timeZone: sanitizeString(visitor?.timeZone),
    screen: sanitizeString(visitor?.screen),
    viewport: sanitizeString(visitor?.viewport),
    hardwareConcurrency: clampNumber(visitor?.hardwareConcurrency, 0, 128, 0),
    deviceMemory: Number.isFinite(parsedDeviceMemory) ? Math.max(0, Math.min(128, parsedDeviceMemory)) : 0,
    touchPoints: clampNumber(visitor?.touchPoints, 0, 20, 0),
    userAgent,
    pageUrl: trimText(visitor?.pageUrl, 180),
    referrer: trimText(visitor?.referrer, 180),
    reason: sanitizeString(visitor?.reason),
    visitCount: clampNumber(visitor?.visitCount, 0, 999999, 0),
    firstSeen: sanitizeString(visitor?.firstSeen) || formatArabicDate(now),
    firstSeenIso: sanitizeString(visitor?.firstSeenIso) || now.toISOString(),
    lastSeen: sanitizeString(visitor?.lastSeen) || sanitizeString(visitor?.firstSeen) || formatArabicDate(now),
    lastSeenIso: sanitizeString(visitor?.lastSeenIso) || sanitizeString(visitor?.firstSeenIso) || now.toISOString(),
  };
}

function mergeVisitorRecord(existing, incoming) {
  const now = new Date();
  const previous = existing ? normalizeVisitorRecord(existing) : null;
  const current = normalizeVisitorRecord(incoming);
  const visitIncrement = current.reason === "page_open" ? 1 : 0;

  return normalizeVisitorRecord({
    ...previous,
    ...current,
    id: previous?.id || current.id,
    sessionId: current.sessionId || previous?.sessionId || "",
    deviceId: current.deviceId || previous?.deviceId || "",
    accountId: current.accountId || previous?.accountId || "",
    studentName: current.studentName || previous?.studentName || "",
    studentEmail: current.studentEmail || previous?.studentEmail || "",
    ipAddress: current.ipAddress || previous?.ipAddress || "",
    country: current.country || previous?.country || "",
    browser: current.browser || previous?.browser || "",
    operatingSystem: current.operatingSystem || previous?.operatingSystem || "",
    deviceType: current.deviceType || previous?.deviceType || "",
    deviceModel: current.deviceModel || previous?.deviceModel || "",
    platform: current.platform || previous?.platform || "",
    language: current.language || previous?.language || "",
    languages:
      Array.isArray(current.languages) && current.languages.length
        ? current.languages
        : Array.isArray(previous?.languages)
          ? previous.languages
          : [],
    timeZone: current.timeZone || previous?.timeZone || "",
    screen: current.screen || previous?.screen || "",
    viewport: current.viewport || previous?.viewport || "",
    hardwareConcurrency: current.hardwareConcurrency || previous?.hardwareConcurrency || 0,
    deviceMemory: current.deviceMemory || previous?.deviceMemory || 0,
    touchPoints: current.touchPoints || previous?.touchPoints || 0,
    userAgent: current.userAgent || previous?.userAgent || "",
    pageUrl: current.pageUrl || previous?.pageUrl || "",
    referrer: current.referrer || previous?.referrer || "",
    reason: current.reason || previous?.reason || "",
    visitCount: clampNumber(Number(previous?.visitCount || 0) + visitIncrement, 0, 999999, visitIncrement),
    firstSeen: previous?.firstSeen || current.firstSeen || formatArabicDate(now),
    firstSeenIso: previous?.firstSeenIso || current.firstSeenIso || now.toISOString(),
    lastSeen: formatArabicDate(now),
    lastSeenIso: now.toISOString(),
  });
}

function upsertVisitorRecord(platformState, visitorInput) {
  const incoming = normalizeVisitorRecord(visitorInput);
  const visitors = Array.isArray(platformState?.visitors) ? platformState.visitors : [];
  const incomingUserAgent = normalizeForComparison(incoming.userAgent);

  const existingIndex = visitors.findIndex((visitor) => {
    if (incoming.sessionId && visitor.sessionId === incoming.sessionId) {
      return true;
    }

    if (incoming.deviceId && normalizeDeviceId(visitor.deviceId) === incoming.deviceId) {
      return true;
    }

    if (incoming.studentEmail && visitor.studentEmail && normalizeEmail(visitor.studentEmail) === incoming.studentEmail) {
      return incoming.ipAddress ? normalizeIp(visitor.ipAddress) === incoming.ipAddress : true;
    }

    return Boolean(
      incoming.ipAddress &&
        normalizeIp(visitor.ipAddress) === incoming.ipAddress &&
        incomingUserAgent &&
        normalizeForComparison(visitor.userAgent) === incomingUserAgent,
    );
  });

  const merged = mergeVisitorRecord(existingIndex >= 0 ? visitors[existingIndex] : null, incoming);

  if (existingIndex >= 0) {
    visitors[existingIndex] = merged;
  } else {
    visitors.unshift(merged);
  }

  visitors.sort((left, right) => {
    const first = Date.parse(right.lastSeenIso || "") || 0;
    const second = Date.parse(left.lastSeenIso || "") || 0;
    return first - second;
  });

  platformState.visitors = visitors.slice(0, MAX_VISITOR_RECORDS);
  return merged;
}

function normalizePlatformState(input) {
  const base = input && typeof input === "object" ? input : createDefaultPlatformState();
  return {
    subjects: Array.isArray(base.subjects)
      ? base.subjects.map((item, index) => normalizeSubjectRecord(item, `مادة ${index + 1}`)).filter(Boolean)
      : [],
    bans: Array.isArray(base.bans) ? base.bans.map((item) => normalizeBanRecord(item)).filter(Boolean) : [],
    visitors: Array.isArray(base.visitors) ? base.visitors.map((item) => normalizeVisitorRecord(item)).filter(Boolean) : [],
  };
}

async function readPlatformState() {
  await ensureDataFile();
  if (tursoClient) {
    try {
      const response = await tursoClient.execute({
        sql: "SELECT value FROM kv_store WHERE key = ?",
        args: ["platform"],
      });
      const raw = response.rows?.[0]?.value || "{}";
      return normalizePlatformState(JSON.parse(String(raw || "{}")));
    } catch {
      return createDefaultPlatformState();
    }
  }

  const raw = await fs.readFile(PLATFORM_FILE, "utf8");
  try {
    return normalizePlatformState(JSON.parse(raw));
  } catch {
    return createDefaultPlatformState();
  }
}

async function writePlatformState(platformState) {
  const normalized = normalizePlatformState(platformState);
  await ensureDataFile();
  if (tursoClient) {
    await tursoClient.execute({
      sql: `
        INSERT INTO kv_store (key, value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `,
      args: ["platform", JSON.stringify(normalized, null, 2), new Date().toISOString()],
    });
    return;
  }

  await fs.writeFile(PLATFORM_FILE, JSON.stringify(normalized, null, 2), "utf8");
}

function publicSubjectsPayload(subjects, options = {}) {
  const includeText = options?.includeText === true;
  return (Array.isArray(subjects) ? subjects : []).map((subject) => ({
    id: subject.id,
    name: subject.name,
    description: subject.description || "",
    sections: (Array.isArray(subject.sections) ? subject.sections : []).map((section) => ({
      id: section.id,
      name: section.name,
      summaries: (Array.isArray(section.summaries) ? section.summaries : []).map((summary) => ({
        id: summary.id,
        title: summary.title,
        text: includeText ? summary.text : "",
        sourceName: "",
        fileName: summary.fileName || "",
        fileSize: Number(summary.fileSize || 0),
        hasFile: Boolean(summary.fileStorageName && summary.fileName),
        downloadUrl: summary.fileStorageName && summary.fileName ? buildSummaryDownloadUrl(summary.id) : "",
        updatedAt: summary.updatedAt || summary.uploadedAt || "",
      })),
    })),
  }));
}

function publicBanPayload(bans) {
  return (Array.isArray(bans) ? bans : []).map((ban) => ({
    id: ban.id,
    type: ban.type,
    value: ban.value,
    reason: ban.reason || "",
    createdAt: ban.createdAt || "",
  }));
}

function publicVisitorPayload(visitors, bans = []) {
  const normalizedBans = Array.isArray(bans) ? bans : [];
  return (Array.isArray(visitors) ? visitors : [])
    .map((visitor) => {
      const studentEmail = normalizeEmail(visitor.studentEmail);
      const ipAddress = normalizeIp(visitor.ipAddress);
      const deviceId = normalizeDeviceId(visitor.deviceId);
      const bannedByEmail = Boolean(
        studentEmail &&
          normalizedBans.some((ban) => ban.type === "email" && normalizeEmail(ban.value) === studentEmail),
      );
      const bannedByIp = Boolean(
        ipAddress &&
          normalizedBans.some((ban) => ban.type === "ip" && normalizeIp(ban.value) === ipAddress),
      );
      const bannedByDevice = Boolean(
        deviceId &&
          normalizedBans.some((ban) => ban.type === "device" && normalizeDeviceId(ban.value) === deviceId),
      );

      return {
        id: visitor.id,
        sessionId: visitor.sessionId || "",
        deviceId,
        studentName: visitor.studentName || "",
        studentEmail,
        ipAddress,
        country: visitor.country || "",
        browser: visitor.browser || "",
        operatingSystem: visitor.operatingSystem || "",
        deviceType: visitor.deviceType || "",
        deviceModel: visitor.deviceModel || "",
        deviceSummary: buildVisitorSummary(visitor),
        platform: visitor.platform || "",
        language: visitor.language || "",
        languages: Array.isArray(visitor.languages) ? visitor.languages : [],
        timeZone: visitor.timeZone || "",
        screen: visitor.screen || "",
        viewport: visitor.viewport || "",
        hardwareConcurrency: Number(visitor.hardwareConcurrency || 0),
        deviceMemory: Number(visitor.deviceMemory || 0),
        touchPoints: Number(visitor.touchPoints || 0),
        userAgent: visitor.userAgent || "",
        pageUrl: visitor.pageUrl || "",
        referrer: visitor.referrer || "",
        reason: visitor.reason || "",
        visitCount: Number(visitor.visitCount || 0),
        firstSeen: visitor.firstSeen || "",
        firstSeenIso: visitor.firstSeenIso || "",
        lastSeen: visitor.lastSeen || "",
        lastSeenIso: visitor.lastSeenIso || "",
        bannedByEmail,
        bannedByIp,
        bannedByDevice,
      };
    })
    .sort((left, right) => {
      const first = Date.parse(right.lastSeenIso || "") || 0;
      const second = Date.parse(left.lastSeenIso || "") || 0;
      return first - second;
    });
}

function buildBlockedMessage(matchedBan) {
  const reasonSuffix = matchedBan?.reason ? ` السبب: ${matchedBan.reason}` : "";
  return `أنت محظور يا حلو، امشي شوف قرايتك براك ;)\n${reasonSuffix}`.trim();
}

function findMatchingBan(platformState, { email, ip, deviceId }) {
  const normalizedEmailValue = normalizeEmail(email);
  const normalizedIpValue = normalizeIp(ip);
  const normalizedDeviceId = normalizeDeviceId(deviceId);
  return (Array.isArray(platformState?.bans) ? platformState.bans : []).find((ban) => {
    if (ban.type === "email") {
      return normalizedEmailValue && normalizeEmail(ban.value) === normalizedEmailValue;
    }

    if (ban.type === "device") {
      return normalizedDeviceId && normalizeDeviceId(ban.value) === normalizedDeviceId;
    }

    return normalizedIpValue && normalizeIp(ban.value) === normalizedIpValue;
  }) || null;
}

async function ensureStudentAllowed(req, studentEmail = "", deviceId = "") {
  const platformState = await readPlatformState();
  const matchedBan = findMatchingBan(platformState, {
    email: studentEmail,
    ip: getRequestIp(req),
    deviceId: deviceId || getDeviceIdFromRequest(req),
  });

  if (!matchedBan) {
    return null;
  }
  const accessError = new Error(buildBlockedMessage(matchedBan));
  accessError.status = 403;
  accessError.ban = matchedBan;
  throw accessError;
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, "\"")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

async function resolveAuthenticatedStudent(req, { touchSession = false } = {}) {
  const token = getStudentTokenFromRequest(req);
  if (!token) {
    return null;
  }

  const users = await readUsers();
  const user = getUserBySessionToken(users, token);
  if (!user) {
    return null;
  }

  if (touchSession) {
    const updatedUser = await touchStudentSession(users, user.id, token, getDeviceIdFromRequest(req));
    return updatedUser ? { user: updatedUser, users, token } : null;
  }

  return { user, users, token };
}

async function requireStudent(req, res, next) {
  try {
    const auth = await resolveAuthenticatedStudent(req, { touchSession: true });
    if (!auth?.user) {
      return res.status(401).json({ error: "سجل دخولك أولاً للوصول إلى هذه الصفحة." });
    }

    await ensureStudentAllowed(req, auth.user.email, getDeviceIdFromRequest(req));
    req.studentAuth = auth;
    return next();
  } catch (error) {
    return next(error);
  }
}

function detectSourceLanguage(text) {
  return /[\u0600-\u06FF]/u.test(String(text || "")) ? "ar" : "en";
}

async function translateText(text, targetLang, sourceLang = "auto") {
  const cleanedText = sanitizeString(text);
  const normalizedTarget = sanitizeString(targetLang, "en").toLowerCase();
  const normalizedSourceInput = sanitizeString(sourceLang, "auto").toLowerCase();
  const normalizedSource = normalizedSourceInput === "auto" ? detectSourceLanguage(cleanedText) : normalizedSourceInput;
  if (!cleanedText) {
    return "";
  }

  const cacheKey = `${normalizedSource}:${normalizedTarget}:${cleanedText}`;
  if (translationCache.has(cacheKey)) {
    return translationCache.get(cacheKey);
  }

  const url = new URL(TRANSLATION_ENDPOINT);
  url.searchParams.set("q", cleanedText);
  url.searchParams.set("langpair", `${normalizedSource}|${normalizedTarget}`);

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error("تعذرت ترجمة النص حالياً.");
  }

  const payload = await response.json();
  const translated = decodeHtmlEntities(payload?.responseData?.translatedText || "");
  if (!translated) {
    throw new Error("تعذرت ترجمة النص حالياً.");
  }

  translationCache.set(cacheKey, translated);
  return translated;
}

function findSubjectIndex(subjects, subjectId) {
  return (Array.isArray(subjects) ? subjects : []).findIndex((subject) => subject.id === subjectId);
}

function findSectionLocation(subjects, sectionId) {
  for (let subjectIndex = 0; subjectIndex < subjects.length; subjectIndex += 1) {
    const sectionIndex = subjects[subjectIndex].sections.findIndex((section) => section.id === sectionId);
    if (sectionIndex >= 0) {
      return {
        subjectIndex,
        sectionIndex,
      };
    }
  }

  return null;
}

function findSummaryLocation(subjects, summaryId) {
  for (let subjectIndex = 0; subjectIndex < subjects.length; subjectIndex += 1) {
    const subject = subjects[subjectIndex];
    for (let sectionIndex = 0; sectionIndex < subject.sections.length; sectionIndex += 1) {
      const summaryIndex = subject.sections[sectionIndex].summaries.findIndex((summary) => summary.id === summaryId);
      if (summaryIndex >= 0) {
        return {
          subjectIndex,
          sectionIndex,
          summaryIndex,
        };
      }
    }
  }

  return null;
}

function publicResultSummary(result) {
  return {
    id: result.id,
    examId: result.examId,
    examTitle: result.examTitle,
    userId: result.userId || "",
    studentName: result.studentName,
    studentEmail: normalizeEmail(result.studentEmail),
    ipAddress: normalizeIp(result.ipAddress),
    totalQuestions: result.totalQuestions,
    gradableTotal: result.gradableTotal,
    correct: result.correct,
    close: result.close || 0,
    wrong: result.wrong,
    skipped: result.skipped,
    earnedPoints: Number(result.earnedPoints || 0),
    gradablePoints: Number(result.gradablePoints || 0),
    totalPoints: Number(result.totalPoints || 0),
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
    supportedMaterialFormats: ["TXT", "PDF", "DOCX"],
    supportedQuestionTypes: ["multiple_choice", "true_false", "short_answer"],
    supportsMaterialAutograding: true,
    supportsTranslation: true,
    storageMode: tursoClient ? "turso" : "local_files",
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

app.post("/api/access/status", async (req, res, next) => {
  try {
    const auth = await resolveAuthenticatedStudent(req, { touchSession: true });
    const studentEmail = auth?.user?.email || normalizeEmail(req.body?.email);
    const platformState = await readPlatformState();
    const matchedBan = findMatchingBan(platformState, {
      email: studentEmail,
      ip: getRequestIp(req),
      deviceId: getDeviceIdFromRequest(req),
    });

    if (matchedBan) {
      return res.status(403).json({
        blocked: true,
        message: buildBlockedMessage(matchedBan),
        ban: {
          type: matchedBan.type,
          reason: matchedBan.reason || "",
        },
      });
    }

    const results = auth?.user ? await readResults() : [];
    return res.json({
      blocked: false,
      authenticated: Boolean(auth?.user),
      student: auth?.user ? buildStudentPublicProfile(auth.user, results) : null,
    });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/auth/register", async (req, res, next) => {
  try {
    const name = trimText(repairDisplayText(req.body?.name), 120);
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || "");
    const deviceId = getDeviceIdFromRequest(req);

    if (!name) {
      return res.status(400).json({ error: "اكتب اسم الطالب أولاً." });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ error: "أدخل بريداً إلكترونياً صحيحاً." });
    }

    if (password.trim().length < 6) {
      return res.status(400).json({ error: "كلمة المرور يجب أن تكون 6 أحرف أو أكثر." });
    }

    await ensureStudentAllowed(req, email, deviceId);
    const users = await readUsers();
    if (users.some((user) => normalizeEmail(user.email) === email)) {
      return res.status(409).json({ error: "هذا البريد مسجل بالفعل. استخدم صفحة الدخول." });
    }

    const session = createStudentSession(deviceId);
    const passwordSecret = hashPasswordSecret(password);
    const now = new Date();
    const user = normalizeUserRecord({
      id: crypto.randomUUID(),
      name,
      email,
      passwordSalt: passwordSecret.salt,
      passwordHash: passwordSecret.hash,
      avatarLabel: name.slice(0, 2),
      createdAt: formatArabicDate(now),
      createdAtIso: now.toISOString(),
      lastLoginAt: formatArabicDate(now),
      lastLoginAtIso: now.toISOString(),
      sessions: [session],
      downloads: [],
      resultIds: [],
    });

    users.unshift(user);
    await writeUsers(users);

    return res.status(201).json({
      token: session.token,
      student: buildStudentPublicProfile(user, []),
      message: "تم إنشاء الحساب بنجاح.",
    });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/auth/login", async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || "");
    const deviceId = getDeviceIdFromRequest(req);

    if (!isValidEmail(email) || !password) {
      return res.status(400).json({ error: "أدخل البريد الإلكتروني وكلمة المرور." });
    }

    await ensureStudentAllowed(req, email, deviceId);
    const users = await readUsers();
    const user = users.find((item) => normalizeEmail(item.email) === email);
    if (!user || !verifyPasswordSecret(password, user.passwordSalt, user.passwordHash)) {
      return res.status(401).json({ error: "بيانات الدخول غير صحيحة." });
    }

    const session = createStudentSession(deviceId);
    user.sessions = [session, ...(Array.isArray(user.sessions) ? user.sessions : [])]
      .map((item) => normalizeUserSessionRecord(item))
      .filter(Boolean)
      .slice(0, MAX_USER_SESSIONS);
    user.lastLoginAt = formatArabicDate();
    user.lastLoginAtIso = new Date().toISOString();
    await writeUsers(users);
    const results = await readResults();

    return res.json({
      token: session.token,
      student: buildStudentPublicProfile(user, results),
      message: "تم تسجيل الدخول.",
    });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/auth/logout", async (req, res, next) => {
  try {
    const token = getStudentTokenFromRequest(req);
    if (!token) {
      return res.json({ ok: true });
    }

    const users = await readUsers();
    const user = getUserBySessionToken(users, token);
    if (!user) {
      return res.json({ ok: true });
    }

    user.sessions = (Array.isArray(user.sessions) ? user.sessions : []).filter((session) => session.token !== token);
    await writeUsers(users);
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/student/me", requireStudent, async (req, res, next) => {
  try {
    const results = await readResults();
    return res.json({
      student: buildStudentPublicProfile(req.studentAuth.user, results),
    });
  } catch (error) {
    return next(error);
  }
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

    const auth = await resolveAuthenticatedStudent(req, { touchSession: true });
    const studentEmail = auth?.user?.email || normalizeEmail(req.query.studentEmail);
    if (!isValidEmail(studentEmail)) {
      return res.status(400).json({ error: "سجل دخولك أولاً قبل بدء الامتحان." });
    }
    await ensureStudentAllowed(req, studentEmail, getDeviceIdFromRequest(req));

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

app.get("/api/materials", async (req, res, next) => {
  try {
    const platformState = await readPlatformState();
    return res.json({
      subjects: publicSubjectsPayload(platformState.subjects),
    });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/summaries/:summaryId/download", async (req, res, next) => {
  try {
    const auth = isOwnerRequest(req) ? null : await resolveAuthenticatedStudent(req, { touchSession: true });
    if (!isOwnerRequest(req) && !auth?.user) {
      return res.status(401).json({ error: "سجل دخولك أولاً لتنزيل الملخص." });
    }

    await ensureStudentAllowed(req, auth?.user?.email || "", getDeviceIdFromRequest(req));
    const platformState = await readPlatformState();
    const location = findSummaryLocation(platformState.subjects, req.params.summaryId);
    if (!location) {
      return res.status(404).json({ error: "Ø§Ù„Ù…Ù„Ø®Øµ ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯." });
    }

    const summary =
      platformState.subjects[location.subjectIndex].sections[location.sectionIndex].summaries[location.summaryIndex];
    if (!summary?.fileStorageName || !summary?.fileName) {
      return res.status(404).json({ error: "Ù„Ø§ ÙŠÙˆØ¬Ø¯ Ù…Ù„Ù Ù…Ø±ÙÙ‚ Ù„Ù‡Ø°Ø§ Ø§Ù„Ù…Ù„Ø®Øµ." });
    }

    if (auth?.user) {
      const users = Array.isArray(auth.users) ? auth.users : await readUsers();
      addDownloadToUserRecord(users, auth.user.id, {
        summaryId: summary.id,
        subjectName: platformState.subjects[location.subjectIndex]?.name || "",
        sectionName: platformState.subjects[location.subjectIndex]?.sections?.[location.sectionIndex]?.name || "",
        summaryTitle: summary.title || "",
        fileName: summary.fileName || "",
      });
      await writeUsers(users);
    }

    const filePath = path.join(SUMMARY_FILES_DIR, summary.fileStorageName);
    res.type(summary.fileMimeType || "application/octet-stream");
    return res.download(filePath, summary.fileName);
  } catch (error) {
    return next(error);
  }
});

app.get("/api/admin/platform", requireOwner, async (req, res, next) => {
  try {
    const platformState = await readPlatformState();
    return res.json({
      subjects: publicSubjectsPayload(platformState.subjects, { includeText: true }),
      bans: publicBanPayload(platformState.bans),
      visitors: publicVisitorPayload(platformState.visitors, platformState.bans),
    });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/visitors/session", async (req, res, next) => {
  try {
    const sessionId = trimText(req.body?.sessionId, 140);
    if (!sessionId) {
      return res.status(400).json({ error: "Visitor session id is required." });
    }

    const platformState = await readPlatformState();
    const auth = await resolveAuthenticatedStudent(req, { touchSession: true });
    const visitor = upsertVisitorRecord(platformState, {
      sessionId,
      deviceId: getDeviceIdFromRequest(req),
      accountId: auth?.user?.id || req.body?.accountId,
      studentName: auth?.user?.name || req.body?.studentName,
      studentEmail: auth?.user?.email || req.body?.studentEmail,
      ipAddress: getRequestIp(req),
      country: req.get("cf-ipcountry") || req.body?.country,
      browser: req.body?.browser,
      operatingSystem: req.body?.operatingSystem,
      deviceType: req.body?.deviceType,
      deviceModel: req.body?.deviceModel,
      platform: req.body?.platform,
      language: req.body?.language,
      languages: req.body?.languages,
      timeZone: req.body?.timeZone,
      screen: req.body?.screen,
      viewport: req.body?.viewport,
      hardwareConcurrency: req.body?.hardwareConcurrency,
      deviceMemory: req.body?.deviceMemory,
      touchPoints: req.body?.touchPoints,
      userAgent: req.get("user-agent") || req.body?.userAgent,
      pageUrl: req.body?.pageUrl || req.originalUrl,
      referrer: req.body?.referrer || req.get("referer"),
      reason: req.body?.reason,
    });

    await writePlatformState(platformState);
    return res.status(201).json({
      ok: true,
      visitor: publicVisitorPayload([visitor], platformState.bans)[0] || null,
    });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/admin/bans", requireOwner, async (req, res, next) => {
  try {
    const normalized = normalizeBanRecord(req.body);
    if (!normalized) {
      return res.status(400).json({ error: "أدخل بريداً إلكترونياً صحيحاً أو عنوان IP أو معرف جهاز صالحاً." });
    }

    const platformState = await readPlatformState();
    const alreadyExists = platformState.bans.some((ban) => ban.type === normalized.type && ban.value === normalized.value);
    if (alreadyExists) {
      return res.status(409).json({ error: "هذا الحظر موجود بالفعل." });
    }

    platformState.bans.unshift(normalized);
    await writePlatformState(platformState);
    return res.status(201).json({
      bans: publicBanPayload(platformState.bans),
      message: "تم حفظ الحظر بنجاح.",
    });
  } catch (error) {
    return next(error);
  }
});

app.delete("/api/admin/bans/:id", requireOwner, async (req, res, next) => {
  try {
    const platformState = await readPlatformState();
    const filtered = platformState.bans.filter((ban) => ban.id !== req.params.id);
    if (filtered.length === platformState.bans.length) {
      return res.status(404).json({ error: "عنصر الحظر غير موجود." });
    }

    platformState.bans = filtered;
    await writePlatformState(platformState);
    return res.json({
      bans: publicBanPayload(platformState.bans),
      message: "تم حذف الحظر.",
    });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/admin/subjects", requireOwner, async (req, res, next) => {
  try {
    const platformState = await readPlatformState();
    const subject = normalizeSubjectRecord(req.body, "مادة جديدة");
    if (platformState.subjects.some((item) => normalizeForComparison(item.name) === normalizeForComparison(subject.name))) {
      return res.status(409).json({ error: "هذه المادة موجودة بالفعل." });
    }

    platformState.subjects.unshift(subject);
    await writePlatformState(platformState);
    return res.status(201).json({
      subjects: publicSubjectsPayload(platformState.subjects, { includeText: true }),
      message: "تمت إضافة المادة.",
    });
  } catch (error) {
    return next(error);
  }
});

app.put("/api/admin/subjects/:id", requireOwner, async (req, res, next) => {
  try {
    const platformState = await readPlatformState();
    const subjectIndex = findSubjectIndex(platformState.subjects, req.params.id);
    if (subjectIndex < 0) {
      return res.status(404).json({ error: "المادة غير موجودة." });
    }

    const previous = platformState.subjects[subjectIndex];
    platformState.subjects[subjectIndex] = normalizeSubjectRecord(
      {
        ...previous,
        ...req.body,
        id: previous.id,
        sections: previous.sections,
      },
      previous.name,
    );
    await writePlatformState(platformState);
    return res.json({
      subjects: publicSubjectsPayload(platformState.subjects, { includeText: true }),
      message: "تم تعديل المادة.",
    });
  } catch (error) {
    return next(error);
  }
});

app.delete("/api/admin/subjects/:id", requireOwner, async (req, res, next) => {
  try {
    const platformState = await readPlatformState();
    const subjectToDelete = platformState.subjects.find((subject) => subject.id === req.params.id);
    if (!subjectToDelete) {
      return res.status(404).json({ error: "المادة غير موجودة." });
    }

    await deleteStoredSummaryFilesFromSubject(subjectToDelete);
    const filtered = platformState.subjects.filter((subject) => subject.id !== req.params.id);
    platformState.subjects = filtered;
    await writePlatformState(platformState);
    return res.json({
      subjects: publicSubjectsPayload(platformState.subjects, { includeText: true }),
      message: "تم حذف المادة.",
    });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/admin/subjects/:subjectId/sections", requireOwner, async (req, res, next) => {
  try {
    const platformState = await readPlatformState();
    const subjectIndex = findSubjectIndex(platformState.subjects, req.params.subjectId);
    if (subjectIndex < 0) {
      return res.status(404).json({ error: "المادة غير موجودة." });
    }

    const section = normalizeSectionRecord(req.body, "قسم جديد");
    const subject = platformState.subjects[subjectIndex];
    if (subject.sections.some((item) => normalizeForComparison(item.name) === normalizeForComparison(section.name))) {
      return res.status(409).json({ error: "هذا القسم موجود بالفعل داخل المادة." });
    }

    subject.sections.unshift(section);
    await writePlatformState(platformState);
    return res.status(201).json({
      subjects: publicSubjectsPayload(platformState.subjects, { includeText: true }),
      message: "تمت إضافة القسم.",
    });
  } catch (error) {
    return next(error);
  }
});

app.put("/api/admin/sections/:sectionId", requireOwner, async (req, res, next) => {
  try {
    const platformState = await readPlatformState();
    const location = findSectionLocation(platformState.subjects, req.params.sectionId);
    if (!location) {
      return res.status(404).json({ error: "القسم غير موجود." });
    }

    const section = platformState.subjects[location.subjectIndex].sections[location.sectionIndex];
    platformState.subjects[location.subjectIndex].sections[location.sectionIndex] = normalizeSectionRecord(
      {
        ...section,
        ...req.body,
        id: section.id,
        summaries: section.summaries,
      },
      section.name,
    );
    await writePlatformState(platformState);
    return res.json({
      subjects: publicSubjectsPayload(platformState.subjects, { includeText: true }),
      message: "تم تعديل القسم.",
    });
  } catch (error) {
    return next(error);
  }
});

app.delete("/api/admin/sections/:sectionId", requireOwner, async (req, res, next) => {
  try {
    const platformState = await readPlatformState();
    const location = findSectionLocation(platformState.subjects, req.params.sectionId);
    if (!location) {
      return res.status(404).json({ error: "القسم غير موجود." });
    }

    const section = platformState.subjects[location.subjectIndex].sections[location.sectionIndex];
    await deleteStoredSummaryFilesFromSection(section);
    platformState.subjects[location.subjectIndex].sections.splice(location.sectionIndex, 1);
    await writePlatformState(platformState);
    return res.json({
      subjects: publicSubjectsPayload(platformState.subjects, { includeText: true }),
      message: "تم حذف القسم.",
    });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/admin/summaries", requireOwner, upload.single("summaryFile"), async (req, res, next) => {
  let storedFile = null;
  try {
    const platformState = await readPlatformState();
    const subjectName = repairDisplayText(req.body.subjectName) || "مادة جديدة";
    const sectionName = repairDisplayText(req.body.sectionName) || "قسم جديد";
    const subjectDescription = repairDisplayText(req.body.subjectDescription);
    let summaryText = sanitizeString(req.body.summaryText);

    if (req.file) {
      storedFile = await saveSummaryFileToDisk(req.file);
      const extractedText = sanitizeString(await extractTextFromFile(req.file));
      summaryText = summaryText ? `${summaryText}\n\n${extractedText}` : extractedText;
    }

    const summaryTitle = inferSummaryTitle(
      {
        title: req.body.summaryTitle,
        text: summaryText,
        fileName: normalizeUploadedFileName(req.file),
      },
      "ملخص جديد",
    );

    if (!storedFile) {
      return res.status(400).json({
        error: "ارفع ملف الملخص أولاً ليظهر للطلاب كملف قابل للتحميل.",
      });
    }

    let subject = platformState.subjects.find(
      (item) => normalizeForComparison(item.name) === normalizeForComparison(subjectName),
    );
    if (!subject) {
      subject = normalizeSubjectRecord({ name: subjectName, description: subjectDescription, sections: [] }, subjectName);
      platformState.subjects.unshift(subject);
    } else if (subjectDescription && !subject.description) {
      subject.description = subjectDescription;
    }

    let section = subject.sections.find(
      (item) => normalizeForComparison(item.name) === normalizeForComparison(sectionName),
    );
    if (!section) {
      section = normalizeSectionRecord({ name: sectionName, summaries: [] }, sectionName);
      subject.sections.unshift(section);
    }

    const now = new Date();
    section.summaries.unshift(
      normalizeSummaryRecord({
        title: summaryTitle,
        text: summaryText,
        sourceName: "",
        ...storedFile,
        uploadedAt: formatArabicDate(now),
        uploadedAtIso: now.toISOString(),
        updatedAt: formatArabicDate(now),
        updatedAtIso: now.toISOString(),
      }, summaryTitle),
    );

    await writePlatformState(platformState);
    return res.status(201).json({
      subjects: publicSubjectsPayload(platformState.subjects, { includeText: true }),
      message: "تم حفظ الملخص كملف جاهز للتحميل.",
    });
  } catch (error) {
    if (storedFile) {
      await deleteStoredSummaryFile(storedFile);
    }
    return next(error);
  }
});

app.put("/api/admin/summaries/:summaryId", requireOwner, upload.single("summaryFile"), async (req, res, next) => {
  let replacementFile = null;
  try {
    const platformState = await readPlatformState();
    const currentLocation = findSummaryLocation(platformState.subjects, req.params.summaryId);
    if (!currentLocation) {
      return res.status(404).json({ error: "الملخص غير موجود." });
    }

    const currentSubject = platformState.subjects[currentLocation.subjectIndex];
    const currentSection = currentSubject.sections[currentLocation.sectionIndex];
    const currentSummary = currentSection.summaries[currentLocation.summaryIndex];
    const currentFileMeta = normalizeSummaryFileMeta(currentSummary);
    let nextFileMeta = currentFileMeta;
    const targetSubjectName = repairDisplayText(req.body.subjectName) || currentSubject.name;
    const targetSectionName = repairDisplayText(req.body.sectionName) || currentSection.name;
    let summaryText = sanitizeString(req.body.summaryText, currentSummary.text);

    if (req.file) {
      replacementFile = await saveSummaryFileToDisk(req.file);
      nextFileMeta = normalizeSummaryFileMeta(replacementFile);
      const extractedText = sanitizeString(await extractTextFromFile(req.file));
      if (extractedText) {
        summaryText = summaryText ? `${summaryText}\n\n${extractedText}` : extractedText;
      }
    }

    const summaryTitle = inferSummaryTitle(
      {
        title: req.body.summaryTitle || currentSummary.title,
        text: summaryText,
        fileName: replacementFile?.fileName || currentFileMeta.fileName,
      },
      currentSummary.title || "ملخص جديد",
    );

    if (!nextFileMeta.hasFile) {
      return res.status(400).json({
        error: "هذا الملخص يحتاج ملفاً مرفقاً حتى يبقى قابلاً للتحميل للطلاب.",
      });
    }

    let targetSubject = platformState.subjects.find(
      (item) => normalizeForComparison(item.name) === normalizeForComparison(targetSubjectName),
    );
    if (!targetSubject) {
      targetSubject = normalizeSubjectRecord({ name: targetSubjectName, sections: [] }, targetSubjectName);
      platformState.subjects.unshift(targetSubject);
    }

    let targetSection = targetSubject.sections.find(
      (item) => normalizeForComparison(item.name) === normalizeForComparison(targetSectionName),
    );
    if (!targetSection) {
      targetSection = normalizeSectionRecord({ name: targetSectionName, summaries: [] }, targetSectionName);
      targetSubject.sections.unshift(targetSection);
    }

    currentSection.summaries.splice(currentLocation.summaryIndex, 1);

    const now = new Date();
    targetSection.summaries.unshift(
      normalizeSummaryRecord({
        ...currentSummary,
        id: currentSummary.id,
        title: summaryTitle,
        text: summaryText,
        sourceName: "",
        ...nextFileMeta,
        updatedAt: formatArabicDate(now),
        updatedAtIso: now.toISOString(),
      }, summaryTitle),
    );

    await writePlatformState(platformState);
    if (replacementFile && currentSummary.fileStorageName && currentSummary.fileStorageName !== nextFileMeta.fileStorageName) {
      await deleteStoredSummaryFile(currentSummary);
    }
    return res.json({
      subjects: publicSubjectsPayload(platformState.subjects, { includeText: true }),
      message: "تم تعديل الملخص.",
    });
  } catch (error) {
    if (replacementFile) {
      await deleteStoredSummaryFile(replacementFile);
    }
    return next(error);
  }
});

app.delete("/api/admin/summaries/:summaryId", requireOwner, async (req, res, next) => {
  try {
    const platformState = await readPlatformState();
    const location = findSummaryLocation(platformState.subjects, req.params.summaryId);
    if (!location) {
      return res.status(404).json({ error: "الملخص غير موجود." });
    }

    const summary = platformState.subjects[location.subjectIndex].sections[location.sectionIndex].summaries[location.summaryIndex];
    await deleteStoredSummaryFile(summary);
    platformState.subjects[location.subjectIndex].sections[location.sectionIndex].summaries.splice(
      location.summaryIndex,
      1,
    );
    await writePlatformState(platformState);
    return res.json({
      subjects: publicSubjectsPayload(platformState.subjects, { includeText: true }),
      message: "تم حذف الملخص.",
    });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/translate", async (req, res, next) => {
  try {
    const auth = await resolveAuthenticatedStudent(req, { touchSession: true });
    await ensureStudentAllowed(
      req,
      auth?.user?.email || normalizeEmail(req.body?.studentEmail),
      getDeviceIdFromRequest(req),
    );
    const targetLang = sanitizeString(req.body?.targetLang, "en").toLowerCase();
    const sourceLang = sanitizeString(req.body?.sourceLang, "auto").toLowerCase();
    const texts = Array.isArray(req.body?.texts) ? req.body.texts.map((item) => sanitizeString(item)).filter(Boolean) : [];

    if (!texts.length) {
      return res.status(400).json({ error: "لا توجد نصوص للترجمة." });
    }

    if (texts.length > 8) {
      return res.status(400).json({ error: "عدد النصوص كبير جداً للترجمة دفعة واحدة." });
    }

    const translations = await Promise.all(texts.map((text) => translateText(text, targetLang, sourceLang)));
    return res.json({ translations });
  } catch (error) {
    return next(error);
  }
});

app.post(
  "/api/process-exam",
  requireOwner,
  upload.fields([
    { name: "examFile", maxCount: 1 },
    { name: "materialFiles", maxCount: 6 },
  ]),
  async (req, res, next) => {
  try {
    const duration = clampNumber(req.body.duration, 5, 300, 60);
    const extraInstructions = sanitizeString(req.body.extraInstructions);
    const manualText = sanitizeString(req.body.manualText);
    const materialText = sanitizeString(req.body.materialText);
    const examFile = Array.isArray(req.files?.examFile) ? req.files.examFile[0] : null;
    const materialFiles = Array.isArray(req.files?.materialFiles) ? req.files.materialFiles : [];

    let text = manualText;
    let fileName = "manual-input.txt";

    if (examFile) {
      text = await extractTextFromFile(examFile);
      fileName = normalizeUploadedFileName(examFile) || examFile.originalname;
    }

    if (!sanitizeString(text)) {
      return res
        .status(400)
        .json({ error: "ارفع ملفاً أو ألصق نص الامتحان يدوياً قبل بدء المعالجة." });
    }

    const materialChunks = [];
    if (materialText) {
      materialChunks.push(materialText);
    }

    for (const file of materialFiles) {
      const extracted = await extractTextFromFile(file);
      if (sanitizeString(extracted)) {
        materialChunks.push(extracted);
      }
    }

    const materialContext = {
      text: materialChunks.join("\n\n"),
      sources: [
        ...materialFiles.map((file) => normalizeUploadedFileName(file)).filter(Boolean),
        ...(materialText ? ["مرجع مكتوب يدوياً"] : []),
      ],
    };

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
    parsed = applyMaterialAutograding(parsed, materialContext);
    const autoGradedShortAnswers = parsed.questions.filter(
      (question) =>
        question.type === QUESTION_TYPES.SHORT_ANSWER &&
        (sanitizeString(question.correctAnswerText) ||
          sanitizeString(question.referenceText) ||
          normalizeStringArray(question.gradingKeywords).length),
    ).length;

    const responseMessage =
      (usedAi
        ? `تم تحليل الملف بالذكاء الاصطناعي واستخراج ${parsed.questions.length} سؤال.`
        : `تم تحليل الملف محلياً واستخراج ${parsed.questions.length} سؤال.`) +
      (autoGradedShortAnswers
        ? ` وتجهيز ${autoGradedShortAnswers} سؤال كتابي للتصحيح التلقائي من المادة.`
        : materialContext.text
          ? " أضفت المادة كمصدر مرجعي، ويمكنك تعديل التصحيح الكتابي من المعاينة."
          : "");

    return res.json({
      parsed,
      usedAi,
      message: responseMessage,
      legacyMessage: usedAi
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
    const auth = await resolveAuthenticatedStudent(req, { touchSession: true });
    const studentName = auth?.user?.name || sanitizeString(req.body.studentName);
    const studentEmail = auth?.user?.email || normalizeEmail(req.body.studentEmail);
    const userId = auth?.user?.id || "";
    const ipAddress = getRequestIp(req);

    if (!studentName) {
      return res.status(400).json({ error: "اكتب اسم الطالب قبل بدء الامتحان." });
    }

    if (!isValidEmail(studentEmail)) {
      return res.status(400).json({ error: "أدخل بريداً إلكترونياً صحيحاً قبل إرسال الامتحان." });
    }

    await ensureStudentAllowed(req, studentEmail, getDeviceIdFromRequest(req));

    let correct = 0;
    let close = 0;
    let wrong = 0;
    let skipped = 0;
    let pendingManualReview = 0;
    let gradableTotal = 0;
    let earnedPoints = 0;
    let gradablePoints = 0;
    let totalPoints = 0;

    const review = exam.questions.map((question, index) => {
      const rawAnswer = answers[String(index)] ?? answers[index];
      const graded = gradeQuestion(question, rawAnswer);
      const questionPoints = inferQuestionPoints(question?.questionText, question?.points);
      totalPoints += questionPoints;

      if (!graded.answered) {
        skipped += 1;
      } else if (!graded.canAutoGrade) {
        pendingManualReview += 1;
      } else {
        gradableTotal += 1;
        gradablePoints += questionPoints;
        earnedPoints += questionPoints * Number(graded.scoreRatio || 0);
        if (graded.evaluation === "correct") {
          correct += 1;
        } else if (graded.evaluation === "close") {
          close += 1;
        } else {
          wrong += 1;
        }
      }

      if (!graded.answered && graded.canAutoGrade) {
        gradableTotal += 1;
        gradablePoints += questionPoints;
      }

      return {
        id: question.id,
        type: question.type,
        questionText: question.questionText,
        points: questionPoints,
        earnedPoints: Number((questionPoints * Number(graded.scoreRatio || 0)).toFixed(2)),
        options: question.options,
        userAnswerIndex: graded.userAnswerIndex,
        userAnswerText: graded.userAnswerText,
        correctAnswerIndex: question.correctAnswerIndex,
        correctAnswerText: question.correctAnswerText || "",
        referenceText: question.referenceText || "",
        gradingKeywords: normalizeStringArray(question.gradingKeywords, 8),
        sourceLabel: question.sourceLabel || "",
        explanation: question.explanation || "",
        isCorrect: graded.isCorrect,
        evaluation: graded.evaluation || "",
        feedback: graded.feedback || "",
        scoreRatio: Number(graded.scoreRatio || 0),
        autoGradeBasis: graded.autoGradeBasis || "",
        matchedKeywords: normalizeStringArray(graded.matchedKeywords, 8),
        matchedReferenceTokens: normalizeStringArray(graded.matchedReferenceTokens, 8),
        pendingManualReview: !graded.canAutoGrade && graded.answered,
      };
    });

    const scorePercent = gradablePoints ? Math.round((earnedPoints / gradablePoints) * 100) : null;
    const now = new Date();
    const resultRecord = {
      id: crypto.randomUUID(),
      examId: exam.id,
      examTitle: exam.examTitle,
      userId,
      studentName,
      studentEmail,
      ipAddress,
      totalQuestions: exam.questions.length,
      gradableTotal,
      correct,
      close,
      wrong,
      skipped,
      earnedPoints: Number(earnedPoints.toFixed(2)),
      gradablePoints,
      totalPoints,
      pendingManualReview,
      scorePercent,
      submittedAt: formatArabicDate(now),
      submittedAtIso: now.toISOString(),
      review,
    };

    const results = await readResults();
    results.push(resultRecord);
    await writeResults(results);
    if (userId) {
      const users = Array.isArray(auth?.users) ? auth.users : await readUsers();
      addResultToUserRecord(users, userId, resultRecord.id);
      await writeUsers(users);
    }

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

  return res.status(error?.status || 500).json({
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
