import {
  DEFAULT_PAYLOAD,
  ATTACK_PRESETS,
  dangerousPatternsIn,
  simulateHostAction,
  renderProtected,
  renderRawUnprotected,
} from "./main.mjs";

const escapeHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ---------------------------------------------------------------- tabs ---
for (const tabButton of document.querySelectorAll(".tab")) {
  tabButton.addEventListener("click", () => {
    for (const t of document.querySelectorAll(".tab")) {
      t.classList.toggle("active", t === tabButton);
      t.setAttribute("aria-selected", String(t === tabButton));
    }
    const name = tabButton.dataset.tab;
    for (const panel of document.querySelectorAll(".panel")) {
      panel.classList.toggle("active", panel.id === `panel-${name}`);
    }
  });
}

// ---------------------------------------------------------- rich-text tab ---
const richInput = document.getElementById("rich-input");
const rawFrame = document.getElementById("raw-frame");
const safeContainer = document.getElementById("safe-container");
const diffList = document.getElementById("diff-list");
const reportOutput = document.getElementById("report-output");
const chipsRow = document.getElementById("attack-chips");

for (const preset of ATTACK_PRESETS) {
  const btn = document.createElement("button");
  btn.className = "chip";
  btn.textContent = preset.label;
  btn.addEventListener("click", () => {
    richInput.value = preset.html;
    renderRich();
  });
  chipsRow.appendChild(btn);
}

function renderReportPanel(result) {
  if (result.rejected) {
    reportOutput.innerHTML = `<p class="rejected">Rejected -- <code>${result.rejected.code}</code>: ${escapeHtml(result.rejected.message)}</p>`;
    return;
  }
  const { report } = result;
  const noteGroup = (notes, label) => {
    if (!notes.length) return "";
    const items = notes
      .map(
        (n) =>
          `<li><code>&lt;${escapeHtml(n.tag)}&gt;</code>${n.attribute ? ` <code>${escapeHtml(n.attribute)}</code>` : ""} -- ${escapeHtml(n.reason)}${n.snippet ? ` <span class="snippet">${escapeHtml(n.snippet)}</span>` : ""}</li>`,
      )
      .join("");
    return `<div class="note-group"><strong>${label} (${notes.length})</strong><ul>${items}</ul></div>`;
  };
  const nothing = !report.removedElements.length && !report.removedAttributes.length && !report.rewrittenUrls.length;
  reportOutput.innerHTML = `
    <div class="report-meta">
      <span>profile: <b>${report.profile}</b></span>
      <span>engine: <b>${report.engine}</b></span>
      <span>${report.durationMs.toFixed(2)}ms</span>
    </div>
    ${noteGroup(report.removedElements, "Removed elements")}
    ${noteGroup(report.removedAttributes, "Removed attributes")}
    ${noteGroup(report.rewrittenUrls, "Rewritten URLs")}
    ${nothing ? '<p class="note-empty">enforceProfile made no additional changes -- see the live diff for what the sanitizer engine itself already stripped.</p>' : ""}
  `;
}

function renderDiffPanel(rawInput, renderedHtml) {
  const diffs = dangerousPatternsIn(rawInput, renderedHtml);
  diffList.innerHTML = diffs.length
    ? diffs
        .map(
          (d) =>
            `<li class="${d.stillPresent ? "still-present" : "neutralized"}">${d.stillPresent ? "⚠️ still present" : "✅ neutralized"} -- ${escapeHtml(d.label)}</li>`,
        )
        .join("")
    : '<li class="dim">No known-dangerous patterns detected in the current input.</li>';
}

let renderToken = 0;
async function renderRich() {
  const html = richInput.value;
  const myToken = ++renderToken;

  renderRawUnprotected(rawFrame, html);

  const result = await renderProtected(safeContainer, html, "article-v1");
  if (myToken !== renderToken) return; // a newer keystroke already superseded this render

  renderReportPanel(result);
  const renderedHtml = result.element.getRenderedRoot ? (result.element.getRenderedRoot()?.innerHTML ?? "") : "";
  renderDiffPanel(html, renderedHtml);
}

let debounceHandle;
richInput.addEventListener("input", () => {
  clearTimeout(debounceHandle);
  debounceHandle = setTimeout(renderRich, 150);
});

richInput.value = DEFAULT_PAYLOAD;
renderRich();

// ------------------------------------------------------------- agent tab ---
const agentContainer = document.getElementById("agent-container");
const agentLog = document.getElementById("agent-log");
const agentChipsRow = document.getElementById("agent-chips");

const AGENT_PRESETS = [
  {
    label: "Repository status card",
    html: `<ui-card tone="neutral">
      <h2>Repository status</h2>
      <ui-stat label="Open issues" value="14" trend="+2"></ui-stat>
      <ui-stat label="CI" value="passing"></ui-stat>
      <ui-button variant="primary" data-action="open-issues">Review issues</ui-button>
      <ui-button variant="danger" data-action="delete-branch" data-value="feature/risky-thing">Delete stale branch</ui-button>
    </ui-card>`,
  },
  {
    label: "Agent tries to sneak in handlers",
    html: `<ui-card tone="neutral" onclick="alert('sneaky card click')">
      <h2>Confirm action</h2>
      <p>This card and button both carry inline event-handler attributes an LLM (or a compromised CMS) could emit.</p>
      <ui-button variant="danger" data-action="delete-everything" onmouseover="alert('sneaky hover')">Delete everything</ui-button>
    </ui-card>`,
  },
];

function logLine(text) {
  const line = document.createElement("div");
  line.className = "log-line";
  line.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
  agentLog.prepend(line);
}

async function renderAgent(html) {
  agentLog.replaceChildren();
  const result = await renderProtected(agentContainer, html, "ui-v1");
  if (result.rejected) {
    logLine(`render rejected: ${result.rejected.code}`);
    return;
  }
  logLine(`rendered under ui-v1 (${result.report.durationMs.toFixed(2)}ms)`);
  result.element.addEventListener("safe-fragment:action", (event) => {
    const { action, value } = event.detail;
    logLine(`received action="${action}"${value ? ` value="${value}"` : ""} -> ${simulateHostAction(action, value)}`);
  });
}

for (const preset of AGENT_PRESETS) {
  const btn = document.createElement("button");
  btn.className = "chip";
  btn.textContent = preset.label;
  btn.addEventListener("click", () => renderAgent(preset.html));
  agentChipsRow.appendChild(btn);
}

renderAgent(AGENT_PRESETS[0].html);

// ------------------------------------------------------------- plain tab ---
const plainInput = document.getElementById("plain-input");
const plainContainer = document.getElementById("plain-container");

plainInput.textContent = DEFAULT_PAYLOAD;
renderProtected(plainContainer, DEFAULT_PAYLOAD, "plain-text-v1");
