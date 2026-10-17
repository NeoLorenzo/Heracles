export const LITERATURE_DOCUMENTS = {
  "study-selection": {
    title: "Resistance Training Outcome Study Selection & Quality Control Protocol",
    path: "./docs/RESISTANCE_TRAINING_OUTCOME_STUDY_SELECTION_PROTOCOL.md",
    label: "Evaluation protocol",
  },
  "muscle-taxonomy": {
    title: "Muscle Group Taxonomy for Hypertrophy Modelling",
    path: "./docs/MUSCLE_GROUP_TAXONOMY.md",
    label: "Authored taxonomy",
  },
  "movement-coefficients": {
    title: "Movement-pattern contribution coefficients",
    path: "./docs/MOVEMENT_PATTERN_COEFFICIENTS.md",
    label: "Authored model",
  },
  "movement-data-model": {
    title: "Movement-pattern data model",
    path: "./docs/MOVEMENT_PATTERN_DATA_MODEL.md",
    label: "Technical specification",
  },
  "movement-muscle-function": {
    title: "Movement Pattern → Muscle Function Matrix",
    path: "./docs/MOVEMENT_PATTERN_TO_MUSCLE_FUNCTION.md",
    label: "Functional-anatomy model",
  },
  "exercise-muscle-composition": {
    title: "Exercise × Muscle Functional Composition Matrix",
    path: "./docs/EXERCISE_MUSCLE_COMPOSITION.md",
    label: "Derived functional model",
  },
  "exercise-muscle-relevance": {
    title: "Exercise → Muscle Hypertrophic Relevance Matrix",
    path: "./docs/EXERCISE_TO_MUSCLE_HYPERTROPHIC_RELEVANCE.md",
    label: "Exercise-specific hypertrophy model",
  },
  "mapping-limitations": {
    title: "Current Limitations of Muscle Group Mapping",
    path: "./docs/CURRENT_LIMITATIONS_OF_MUSCLE_GROUP_MAPPING.md",
    label: "Model limitations",
  },
  "preset-order": {
    title: "Preset workout order",
    path: "./docs/PRESET_EXERCISE_ORDER.md",
    label: "Product decision",
  },
  "no-tonnage": {
    title: "Why the App Does Not Track Tonnage",
    path: "./docs/WHY_THE_APP_DOES_NOT_TRACK_TONNAGE.md",
    label: "Product decision",
  },
  "design-rules": {
    title: "Heracles — Design Rules",
    path: "./docs/DESIGN_RULES.md",
    label: "Product standard",
  },
};

const documentPathLookup = new Map(
  Object.entries(LITERATURE_DOCUMENTS).flatMap(([id, document]) => {
    const filename = document.path.split("/").pop().toLowerCase();
    return [[filename, id], [document.path.toLowerCase(), id]];
  }),
);

export function renderMarkdown(markdown) {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const html = [];
  const usedHeadingIds = new Map();
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = line.match(/^```\s*([\w-]+)?\s*$/);
    if (fence) {
      const code = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index])) {
        code.push(lines[index]);
        index += 1;
      }
      index += index < lines.length ? 1 : 0;
      const language = fence[1] ? ` class="language-${escapeAttribute(fence[1])}"` : "";
      html.push(`<pre><code${language}>${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if (heading) {
      const level = Math.min(heading[1].length + 1, 6);
      const headingText = stripInlineMarkdown(heading[2]);
      const baseId = slugify(headingText) || "section";
      const seen = usedHeadingIds.get(baseId) ?? 0;
      usedHeadingIds.set(baseId, seen + 1);
      const id = seen ? `${baseId}-${seen + 1}` : baseId;
      html.push(`<h${level} id="${id}">${renderInline(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      html.push("<hr>");
      index += 1;
      continue;
    }

    if (isTableStart(lines, index)) {
      const headers = splitTableRow(lines[index]);
      const rows = [];
      index += 2;
      while (index < lines.length && /^\s*\|?.*\|.*\|?\s*$/.test(lines[index]) && lines[index].trim()) {
        rows.push(splitTableRow(lines[index]));
        index += 1;
      }
      html.push(renderTable(headers, rows));
      continue;
    }

    if (/^\s*>/.test(line)) {
      const quote = [];
      while (index < lines.length && /^\s*>/.test(lines[index])) {
        quote.push(lines[index].replace(/^\s*>\s?/, ""));
        index += 1;
      }
      html.push(`<blockquote>${renderInline(quote.join(" "))}</blockquote>`);
      continue;
    }

    const listMatch = line.match(/^\s*(?:([-+*])|(\d+)\.)\s+(.+)$/);
    if (listMatch) {
      const ordered = Boolean(listMatch[2]);
      const tag = ordered ? "ol" : "ul";
      const items = [];
      while (index < lines.length) {
        const item = lines[index].match(/^\s*(?:([-+*])|(\d+)\.)\s+(.+)$/);
        if (!item || Boolean(item[2]) !== ordered) break;
        let itemText = item[3];
        index += 1;
        while (
          index < lines.length &&
          lines[index].trim() &&
          !isBlockStart(lines, index) &&
          !/^\s*(?:[-+*]|\d+\.)\s+/.test(lines[index])
        ) {
          itemText += ` ${lines[index].trim()}`;
          index += 1;
        }
        items.push(`<li>${renderInline(itemText)}</li>`);
      }
      html.push(`<${tag}>${items.join("")}</${tag}>`);
      continue;
    }

    const paragraph = [line.trim()];
    index += 1;
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines, index)) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    html.push(`<p>${renderInline(paragraph.join(" "))}</p>`);
  }

  return html.join("\n");
}

function isBlockStart(lines, index) {
  const line = lines[index] ?? "";
  return (
    /^```/.test(line) ||
    /^#{1,6}\s+/.test(line) ||
    /^\s*>/.test(line) ||
    /^\s*(?:[-+*]|\d+\.)\s+/.test(line) ||
    /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line) ||
    isTableStart(lines, index)
  );
}

function isTableStart(lines, index) {
  if (!lines[index]?.includes("|") || !lines[index + 1]?.includes("|")) return false;
  const separator = splitTableRow(lines[index + 1]);
  return separator.length > 0 && separator.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

function splitTableRow(row) {
  return row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function renderTable(headers, rows) {
  const head = headers.map((cell) => `<th scope="col">${renderInline(cell)}</th>`).join("");
  const body = rows.map((row) => {
    const cells = headers.map((_, index) => `<td>${renderInline(row[index] ?? "")}</td>`).join("");
    return `<tr>${cells}</tr>`;
  }).join("");
  return `<div class="markdown-table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function renderInline(source) {
  const tokens = [];
  let text = source;

  text = text.replace(/`([^`]+)`/g, (_match, code) => createToken(tokens, `<code>${escapeHtml(code)}</code>`));
  text = text.replace(/\[([^\]]+)]\(([^)]+)\)/g, (_match, label, href) => {
    const documentId = resolveDocumentId(href);
    if (documentId) {
      return createToken(
        tokens,
        `<button class="inline-document-link" type="button" data-document="${documentId}">${escapeHtml(label)}</button>`,
      );
    }
    if (!isSafeHref(href)) return escapeHtml(label);
    return createToken(
      tokens,
      `<a href="${escapeAttribute(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`,
    );
  });

  text = escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");

  return tokens.reduce((rendered, token, index) => rendered.replace(token.marker, token.html), text);
}

function createToken(tokens, html) {
  const marker = `LITERATURETOKEN${tokens.length}END`;
  tokens.push({ marker, html });
  return marker;
}

function resolveDocumentId(href) {
  const normalized = href.split("#")[0].replace(/\\/g, "/").toLowerCase();
  const filename = normalized.split("/").pop();
  return documentPathLookup.get(normalized) ?? documentPathLookup.get(filename) ?? null;
}

function isSafeHref(href) {
  return /^(?:https?:|mailto:|#|\.\/|\.\.\/)/i.test(href);
}

function stripInlineMarkdown(value) {
  return value.replace(/[`*_]/g, "").trim();
}

function slugify(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}
