// Renders a shareable PNG of a workout recap share model (see buildRecapShareModel).
// Browser-only: it needs a canvas. Colours come from the signed-in design tokens.

const CARD_WIDTH = 1080;
const CARD_HEIGHT = 1350;
const PADDING = 88;
const FONT_STACK = '"Heracles Inter", Inter, system-ui, -apple-system, "Segoe UI", sans-serif';

const FALLBACK_COLORS = Object.freeze({
  bg: "#000000",
  surface: "#0a0a0a",
  border: "#252525",
  text: "#f5f5f5",
  text2: "#c4c4c4",
  muted: "#8a8a8a",
  accent: "#f5f5f5",
  positive: "#4ade80",
  negative: "#fb7185",
});

function readColors(tokenSource) {
  const colors = { ...FALLBACK_COLORS };
  if (!tokenSource || typeof getComputedStyle !== "function") return colors;
  const style = getComputedStyle(tokenSource);
  const tokens = {
    bg: "--hx-bg",
    surface: "--hx-surface",
    border: "--hx-border",
    text: "--hx-text",
    text2: "--hx-text-2",
    muted: "--hx-muted",
    accent: "--hx-accent",
    positive: "--hx-positive",
    negative: "--hx-negative",
  };
  for (const [key, token] of Object.entries(tokens)) {
    const value = style.getPropertyValue(token).trim();
    if (value) colors[key] = value;
  }
  return colors;
}

function wrapText(context, text, maxWidth, maxLines) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (context.measureText(candidate).width <= maxWidth || !line) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1];
  while (last.length > 1 && context.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1);
  kept[maxLines - 1] = `${last.trimEnd()}…`;
  return kept;
}

function font(weight, size) {
  return `${weight} ${size}px ${FONT_STACK}`;
}

function drawPill(context, text, rightX, centerY, colors) {
  context.font = font(600, 26);
  const width = context.measureText(text).width + 36;
  const height = 48;
  const x = rightX - width;
  const y = centerY - height / 2;
  context.beginPath();
  if (typeof context.roundRect === "function") context.roundRect(x, y, width, height, height / 2);
  else context.rect(x, y, width, height);
  context.strokeStyle = colors.accent;
  context.lineWidth = 2;
  context.stroke();
  context.fillStyle = colors.accent;
  context.textBaseline = "middle";
  context.fillText(text, x + 18, centerY + 1);
  context.textBaseline = "alphabetic";
  return width;
}

export function drawRecapCard(canvas, model, { formattedDate = model.date, colors = FALLBACK_COLORS } = {}) {
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;
  const context = canvas.getContext("2d");
  const contentWidth = CARD_WIDTH - PADDING * 2;

  context.fillStyle = colors.bg;
  context.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

  let y = PADDING + 24;
  context.fillStyle = colors.accent;
  context.font = font(700, 26);
  context.letterSpacing = "6px";
  context.fillText("HERACLES", PADDING, y);
  context.letterSpacing = "0px";

  y += 56;
  context.fillStyle = colors.muted;
  context.font = font(500, 30);
  context.fillText(`Workout recap · ${formattedDate}`, PADDING, y);

  context.font = font(700, 72);
  context.fillStyle = colors.text;
  for (const line of wrapText(context, model.title, contentWidth, 2)) {
    y += 84;
    context.fillText(line, PADDING, y);
  }

  y += 58;
  context.font = font(500, 32);
  context.fillStyle = colors.text2;
  context.fillText(model.stats, PADDING, y);
  context.font = font(600, 32);
  context.fillStyle = colors.text;
  for (const line of wrapText(context, model.counts, contentWidth, 2)) {
    y += 48;
    context.fillText(line, PADDING, y);
  }

  y += 40;
  const footerTop = CARD_HEIGHT - PADDING - 120;
  let drawnRows = 0;
  for (const row of model.rows) {
    context.font = font(600, 36);
    const badgeWidth = row.badge ? 200 : 0;
    const nameLines = wrapText(context, row.name, contentWidth - badgeWidth, 1);
    context.font = font(500, 30);
    const detailLines = wrapText(context, row.detail, contentWidth, 2);
    const rowHeight = 36 + 50 + detailLines.length * 42 + 12;
    if (y + rowHeight > footerTop) break;

    context.fillStyle = colors.border;
    context.fillRect(PADDING, y, contentWidth, 2);
    y += 66;
    context.font = font(600, 36);
    context.fillStyle = colors.text;
    context.fillText(nameLines[0], PADDING, y);
    if (row.badge) drawPill(context, row.badge, CARD_WIDTH - PADDING, y - 12, colors);

    context.font = font(500, 30);
    context.fillStyle = row.tone === "positive" ? colors.positive : row.tone === "negative" ? colors.negative : colors.muted;
    for (const line of detailLines) {
      y += 44;
      context.fillText(line, PADDING, y);
    }
    y += 20;
    drawnRows += 1;
  }

  const hidden = model.hiddenRowCount + (model.rows.length - drawnRows);
  let footerY = footerTop + 20;
  context.font = font(500, 26);
  context.fillStyle = colors.muted;
  if (hidden > 0) {
    context.fillText(`+ ${hidden} more ${hidden === 1 ? "exercise" : "exercises"}`, PADDING, footerY);
  }
  footerY += 44;
  context.font = font(400, 24);
  for (const line of wrapText(context, model.footnote, contentWidth, 2)) {
    context.fillText(line, PADDING, footerY);
    footerY += 34;
  }
  return { drawnRows, hidden };
}

export async function renderRecapShareCard(model, { formattedDate, tokenSource = null, fileName = "heracles-workout-recap.png" } = {}) {
  if (typeof document === "undefined" || typeof File === "undefined") return null;
  try {
    if (document.fonts?.ready) await document.fonts.ready;
    const canvas = document.createElement("canvas");
    if (typeof canvas.getContext !== "function" || typeof canvas.toBlob !== "function") return null;
    drawRecapCard(canvas, model, { formattedDate, colors: readColors(tokenSource) });
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    return blob ? new File([blob], fileName, { type: "image/png" }) : null;
  } catch {
    return null;
  }
}
