import assert from "node:assert/strict";
import { once } from "node:events";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import ToneMidi from "@tonejs/midi";

// Keep browser-critical delivery paths testable without adding a browser bundle.
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const { Midi } = ToneMidi;

function sleep(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function getFreePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");
  const port = address.port;
  server.close();
  await once(server, "close");
  return port;
}

async function firstAccessiblePath(paths) {
  for (const path of paths) {
    if (!path) continue;
    try {
      await access(path);
      return path;
    } catch {
      // Try the next known Chrome location.
    }
  }
  return null;
}

async function resolveChromePath() {
  const chromePath = await firstAccessiblePath([
    process.env.CHORDFLOW_CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    process.env.PROGRAMFILES
      ? join(process.env.PROGRAMFILES, "Google/Chrome/Application/chrome.exe")
      : null,
    process.env["PROGRAMFILES(X86)"]
      ? join(
          process.env["PROGRAMFILES(X86)"],
          "Google/Chrome/Application/chrome.exe"
        )
      : null
  ]);

  if (!chromePath) {
    throw new Error(
      "Chrome was not found. Set CHORDFLOW_CHROME_PATH to a Chrome or Chromium executable."
    );
  }
  return chromePath;
}

function captureProcessOutput(child) {
  let output = "";
  const capture = (chunk) => {
    output = (output + chunk.toString()).slice(-12000);
  };
  child.stdout?.on("data", capture);
  child.stderr?.on("data", capture);
  return () => output;
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    once(child, "exit"),
    sleep(1800).then(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
    })
  ]);
}

async function waitForJson(url, label, child, readOutput) {
  const deadline = Date.now() + 15000;
  let lastError;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`${label} exited early.\n${readOutput()}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
      lastError = new Error(`${response.status} ${response.statusText}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(100);
  }
  throw new Error(`${label} did not become ready: ${lastError}\n${readOutput()}`);
}

async function waitForHttp(url, label, child, readOutput) {
  const deadline = Date.now() + 15000;
  let lastError;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`${label} exited early.\n${readOutput()}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = new Error(`${response.status} ${response.statusText}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(100);
  }
  throw new Error(`${label} did not become ready: ${lastError}\n${readOutput()}`);
}

async function waitForPageTarget(debugPort, appUrl, chrome, readChromeOutput) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const targets = await waitForJson(
      `http://127.0.0.1:${debugPort}/json/list`,
      "Chrome",
      chrome,
      readChromeOutput
    );
    const target = targets.find(
      (item) => item.type === "page" && item.url.startsWith(appUrl)
    );
    if (target?.webSocketDebuggerUrl) return target;
    await sleep(100);
  }
  throw new Error(`Chrome did not open ${appUrl}.\n${readChromeOutput()}`);
}

class CdpClient {
  constructor(url) {
    this.nextId = 1;
    this.pending = new Map();
    this.events = new Map();
    this.socket = new WebSocket(url);
    this.ready = new Promise((resolveReady, rejectReady) => {
      this.socket.addEventListener("open", resolveReady, { once: true });
      this.socket.addEventListener("error", rejectReady, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data.toString());
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) {
          pending.reject(
            new Error(`${pending.method}: ${message.error.message}`)
          );
        } else {
          pending.resolve(message.result);
        }
        return;
      }
      for (const listener of this.events.get(message.method) ?? []) {
        listener(message.params);
      }
    });
  }

  on(method, listener) {
    const listeners = this.events.get(method) ?? [];
    listeners.push(listener);
    this.events.set(method, listeners);
  }

  async send(method, params = {}) {
    await this.ready;
    const id = this.nextId;
    this.nextId += 1;
    return await new Promise((resolveCommand, rejectCommand) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        rejectCommand(new Error(`${method} timed out`));
      }, 10000);
      this.pending.set(id, {
        method,
        resolve: (value) => {
          clearTimeout(timeout);
          resolveCommand(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          rejectCommand(error);
        }
      });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const response = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true
    });
    if (response.exceptionDetails) {
      throw new Error(
        response.exceptionDetails.exception?.description ??
          response.exceptionDetails.text
      );
    }
    return response.result.value;
  }

  async close() {
    await this.ready;
    this.socket.close();
  }
}

async function waitForExpression(client, expression, description, timeoutMs = 7000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await client.evaluate(expression)) return;
    await sleep(50);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function click(client, selector) {
  await client.evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!(element instanceof HTMLElement)) {
      throw new Error(${JSON.stringify(`Missing clickable element: ${selector}`)});
    }
    element.click();
    return true;
  })()`);
}

async function textContent(client, selector) {
  return await client.evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) throw new Error(${JSON.stringify(`Missing text element: ${selector}`)});
    return element.textContent.trim();
  })()`);
}

async function selectValue(client, selector, value) {
  await client.evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!(element instanceof HTMLSelectElement)) {
      throw new Error(${JSON.stringify(`Missing select element: ${selector}`)});
    }
    element.value = ${JSON.stringify(value)};
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return element.value;
  })()`);
}

async function fillInput(client, selector, value) {
  await client.evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!(element instanceof HTMLInputElement)) {
      throw new Error(${JSON.stringify(`Missing input element: ${selector}`)});
    }
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )?.set;
    element.focus();
    setter.call(element, ${JSON.stringify(value)});
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    element.blur();
    return element.value;
  })()`);
}

async function setFileInput(client, selector, filePath) {
  const documentTree = await client.send("DOM.getDocument", {
    depth: -1,
    pierce: true
  });
  const query = await client.send("DOM.querySelector", {
    nodeId: documentTree.root.nodeId,
    selector
  });
  assert.notEqual(query.nodeId, 0, `Missing file input: ${selector}`);
  await client.send("DOM.setFileInputFiles", {
    files: [filePath],
    nodeId: query.nodeId
  });
  await client.evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
}

async function waitForDownloadedFile(
  downloadDirectory,
  previousFiles,
  predicate,
  description
) {
  const deadline = Date.now() + 7000;
  while (Date.now() < deadline) {
    const files = await readdir(downloadDirectory);
    const filename = files.find(
      (item) =>
        !previousFiles.has(item) &&
        !item.endsWith(".crdownload") &&
        predicate(item)
    );
    if (filename) {
      return {
        filename,
        content: await readFile(join(downloadDirectory, filename))
      };
    }
    await sleep(50);
  }
  throw new Error(`${description} was not downloaded`);
}

if (typeof WebSocket !== "function") {
  throw new Error("The dependency-free E2E runner requires Node.js 22 or newer.");
}

const chromePath = await resolveChromePath();
const appPort = await getFreePort();
const debugPort = await getFreePort();
const temporaryRoot = await mkdtemp(join(tmpdir(), "chordflow-e2e-"));
const chromeProfile = join(temporaryRoot, "chrome-profile");
const downloadDirectory = join(temporaryRoot, "downloads");
await mkdir(downloadDirectory, { recursive: true });
const appUrl = `http://127.0.0.1:${appPort}`;
let vite;
let chrome;
let client;

try {
  vite = spawn(
    npmCommand,
    [
      "run",
      "dev",
      "--",
      "--host",
      "127.0.0.1",
      "--port",
      String(appPort),
      "--strictPort"
    ],
    { cwd: projectRoot, stdio: ["ignore", "pipe", "pipe"] }
  );
  const readViteOutput = captureProcessOutput(vite);
  await waitForHttp(`${appUrl}/`, "Vite", vite, readViteOutput);

  chrome = spawn(
    chromePath,
    [
      "--headless=new",
      "--disable-background-networking",
      "--disable-extensions",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--mute-audio",
      "--no-default-browser-check",
      "--no-first-run",
      "--remote-allow-origins=*",
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${chromeProfile}`,
      "--window-size=1440,1200",
      appUrl
    ],
    { cwd: projectRoot, stdio: ["ignore", "pipe", "pipe"] }
  );
  const readChromeOutput = captureProcessOutput(chrome);
  await waitForJson(
    `http://127.0.0.1:${debugPort}/json/version`,
    "Chrome",
    chrome,
    readChromeOutput
  );
  const target = await waitForPageTarget(
    debugPort,
    appUrl,
    chrome,
    readChromeOutput
  );
  client = new CdpClient(target.webSocketDebuggerUrl);
  const runtimeExceptions = [];
  client.on("Runtime.exceptionThrown", (event) => {
    runtimeExceptions.push(event.exceptionDetails.text);
  });
  await client.send("Runtime.enable");
  await client.send("Page.enable");
  await client.send("DOM.enable");
  await client.send("Browser.grantPermissions", {
    origin: new URL(appUrl).origin,
    permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"]
  });
  try {
    await client.send("Browser.setDownloadBehavior", {
      behavior: "allow",
      downloadPath: downloadDirectory,
      eventsEnabled: true
    });
  } catch {
    await client.send("Page.setDownloadBehavior", {
      behavior: "allow",
      downloadPath: downloadDirectory
    });
  }

  await waitForExpression(
    client,
    `document.querySelector('[data-testid="suno-launch"]') !== null`,
    "ChordFlow to render"
  );

  await click(client, '[data-testid="comparison-capture-A"]');
  await waitForExpression(
    client,
    `document.querySelector('[data-testid="comparison-slot-A"]')?.dataset.state === 'current'`,
    "comparison slot A to capture the initial arrangement"
  );
  await selectValue(client, '[data-testid="tonic-select"]', "D");
  await waitForExpression(
    client,
    `document.querySelector('[data-testid="tonic-select"]')?.value === 'D'`,
    "the arrangement to transpose to D"
  );
  await click(client, '[data-testid="comparison-capture-B"]');
  await waitForExpression(
    client,
    `document.querySelector('[data-testid="comparison-slot-B"]')?.dataset.state === 'current'`,
    "comparison slot B to capture the transposed arrangement"
  );
  assert.equal(
    await textContent(client, '[data-testid="comparison-summary"]'),
    "调性"
  );

  await click(client, '[data-testid="comparison-load-A"]');
  await waitForExpression(
    client,
    `document.querySelector('[data-testid="tonic-select"]')?.value === 'C'`,
    "comparison slot A to load"
  );
  assert.match(
    await textContent(client, '[data-testid="project-status"]'),
    /已切换到方案 A/
  );
  await click(client, '[data-testid="comparison-load-B"]');
  await waitForExpression(
    client,
    `document.querySelector('[data-testid="tonic-select"]')?.value === 'D'`,
    "comparison slot B to load"
  );

  await click(client, '[data-testid="project-undo"]');
  await waitForExpression(
    client,
    `document.querySelector('[data-testid="tonic-select"]')?.value === 'C'`,
    "undo to restore comparison slot A"
  );
  await click(client, '[data-testid="project-redo"]');
  await waitForExpression(
    client,
    `document.querySelector('[data-testid="tonic-select"]')?.value === 'D'`,
    "redo to restore comparison slot B"
  );

  await click(client, '[data-testid="project-save"]');
  await waitForExpression(
    client,
    `document.querySelector('[data-testid="project-status"]')?.textContent.includes('已保存') === true`,
    "the current arrangement to save locally"
  );
  const savedProjectRaw = await client.evaluate(
    "localStorage.getItem('chordflow.project.v1')"
  );
  assert.equal(typeof savedProjectRaw, "string");
  const importedProject = JSON.parse(savedProjectRaw);
  importedProject.arrangement.title = "ChordFlow Import E2E";
  importedProject.arrangement.key = "Eb";
  importedProject.arrangement.style = "爵士流行";
  importedProject.arrangement.generatedAt = "2026-08-04T00:00:00.000Z";
  const importPath = join(temporaryRoot, "chordflow-import-e2e.json");
  await writeFile(importPath, JSON.stringify(importedProject), "utf8");
  await setFileInput(
    client,
    '[data-testid="project-import-input"]',
    importPath
  );
  await waitForExpression(
    client,
    `document.querySelector('[data-testid="project-status"]')?.textContent.includes('已导入 chordflow-import-e2e.json') === true`,
    "the JSON project to import"
  );
  assert.equal(
    await client.evaluate(
      `document.querySelector('[data-testid="tonic-select"]')?.value`
    ),
    "Eb"
  );
  assert.equal(
    await client.evaluate(
      `document.querySelector('[data-testid="style-select"]')?.value`
    ),
    "爵士流行"
  );

  await click(client, '[data-testid="project-undo"]');
  await waitForExpression(
    client,
    `document.querySelector('[data-testid="tonic-select"]')?.value === 'D'`,
    "undo to restore the pre-import arrangement"
  );
  await click(client, '[data-testid="project-redo"]');
  await waitForExpression(
    client,
    `document.querySelector('[data-testid="tonic-select"]')?.value === 'Eb'`,
    "redo to restore the imported arrangement"
  );

  const manualBassAnchor = await client.evaluate(`(() => {
    const buttons = [...document.querySelectorAll('[data-testid^="bass-anchor-pc-"]')];
    const button = buttons[1];
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error("The selected chord does not offer a non-root bass anchor");
    }
    return {
      testId: button.dataset.testid,
      pitchClass: Number(button.dataset.pitchClass),
      name: button.textContent.trim()
    };
  })()`);
  assert.equal(typeof manualBassAnchor.testId, "string");
  assert.equal(Number.isInteger(manualBassAnchor.pitchClass), true);
  await click(client, `[data-testid="${manualBassAnchor.testId}"]`);
  await waitForExpression(
    client,
    `document.querySelector('[data-testid="bass-anchor-mode"]')?.textContent === 'MANUAL'`,
    "the first chord manual bass anchor to activate"
  );

  await click(client, '[data-testid="suno-launch"]');
  await waitForExpression(
    client,
    `document.querySelector('[data-testid="suno-bridge"]') !== null`,
    "Suno Bridge to open"
  );

  const downloadedFiles = new Set(await readdir(downloadDirectory));
  await click(client, '[data-testid="suno-export-midi"]');
  const baselineMidiDownload = await waitForDownloadedFile(
    downloadDirectory,
    downloadedFiles,
    (filename) =>
      filename.startsWith("chordflow-") && filename.endsWith(".mid"),
    "The baseline MIDI reference"
  );
  downloadedFiles.add(baselineMidiDownload.filename);
  const baselineMidi = new Midi(baselineMidiDownload.content);
  await rm(join(downloadDirectory, baselineMidiDownload.filename), {
    force: true
  });
  downloadedFiles.delete(baselineMidiDownload.filename);

  await fillInput(client, '[data-testid="suno-tempo-input"]', "128");
  await click(client, '[data-testid="suno-meter-6-8"]');
  await click(client, '[data-testid="suno-bars-8"]');
  await click(client, '[data-testid="suno-voicing-dramatic"]');
  await click(client, '[data-testid="suno-section-energy-increase-0"]');
  await click(client, '[data-testid="suno-section-texture-0-full"]');
  await click(client, '[data-testid="suno-section-energy-decrease-1"]');
  await click(client, '[data-testid="suno-section-voicing-1-stable"]');
  await click(client, '[data-testid="suno-section-texture-1-sparse"]');
  await waitForExpression(
    client,
    `document.querySelector('[data-testid="suno-signal-tempo"]')?.textContent === '128'`,
    "the Suno tempo signal to update"
  );
  await waitForExpression(
    client,
    `document.querySelector('[data-testid="suno-signal-bars"]')?.textContent === '8'`,
    "the Suno section length signal to update"
  );
  await waitForExpression(
    client,
    `document.querySelector('[data-testid="suno-meter-6-8"]')?.getAttribute('aria-pressed') === 'true'`,
    "six-eight meter to activate"
  );
  await waitForExpression(
    client,
    `document.querySelector('[data-testid="suno-voicing-dramatic"]')?.getAttribute('aria-pressed') === 'true'`,
    "dramatic voicing to activate"
  );
  await waitForExpression(
    client,
    `document.querySelector('[data-testid="suno-section-texture-0-full"]')?.getAttribute('aria-pressed') === 'true'`,
    "the first section LIFT texture to activate"
  );

  const stylePrompt = await textContent(
    client,
    '[data-testid="suno-style-prompt"]'
  );
  assert.match(stylePrompt, /128 BPM/);
  assert.match(stylePrompt, /6\/8 meter/);
  assert.match(stylePrompt, /contrasting inversions/);
  assert.match(stylePrompt, /manual bass anchors/);
  await click(client, '[data-testid="suno-copy-style"]');
  await waitForExpression(
    client,
    `document.querySelector('[data-testid="suno-copy-style"]')?.textContent.includes('已复制') === true`,
    "style copy confirmation"
  );
  const copiedStyle = await client.evaluate("navigator.clipboard.readText()");
  assert.equal(copiedStyle, stylePrompt, "Style copy must match the visible prompt");

  assert.match(
    await textContent(client, '[data-testid="suno-section-lock-summary"]'),
    /2 段已锁定/
  );
  const lockedBlueprint = await textContent(
    client,
    '[data-testid="suno-blueprint"]'
  );
  const expectedFirstSectionEnergy =
    importedProject.arrangement.sections[0].energy + 5;
  const expectedSecondSectionEnergy =
    importedProject.arrangement.sections[1].energy - 5;
  assert.match(lockedBlueprint, /TEMPO: 128 BPM \| METER: 6\/8/);
  assert.match(lockedBlueprint, /DEFAULT VOICING MODE: 戏剧 \/ WIDE/);
  assert.match(lockedBlueprint, /SECTION LOCKS: 2 sections/);
  assert.match(lockedBlueprint, /BASS ANCHORS:/);
  assert.match(
    lockedBlueprint,
    new RegExp(`Bass guide: ${manualBassAnchor.name}\\d\\*`)
  );
  assert.match(
    lockedBlueprint,
    new RegExp(
      `8 bars \\| Energy ${expectedFirstSectionEnergy}/100 \\| Voicing 戏剧/WIDE \\| Texture 展开/LIFT LOCKED`
    )
  );
  assert.match(
    lockedBlueprint,
    new RegExp(
      `8 bars \\| Energy ${expectedSecondSectionEnergy}/100 \\| Voicing 稳定/ROOT \\| Texture 留白/AIR LOCKED`
    )
  );
  assert.match(lockedBlueprint, /TEXTURE ARC: A:LIFT → B:AIR/);

  await click(client, '[data-testid="suno-copy-all"]');
  await waitForExpression(
    client,
    `document.querySelector('[data-testid="suno-copy-all"]')?.textContent.includes('整包已复制') === true`,
    "package copy confirmation"
  );
  const copiedPackage = await client.evaluate("navigator.clipboard.readText()");
  assert.match(copiedPackage, /CHORDFLOW → SUNO BRIDGE/);
  assert.match(copiedPackage, /TEXTURE ARC:/);
  assert.match(copiedPackage, /SECTION LOCKS: 2 sections/);
  assert.match(copiedPackage, /BASS ANCHORS:/);

  await click(client, '[data-testid="suno-download-txt"]');
  const textDownload = await waitForDownloadedFile(
    downloadDirectory,
    downloadedFiles,
    (filename) =>
      filename.startsWith("chordflow-suno-") && filename.endsWith(".txt"),
    "The Suno TXT package"
  );
  downloadedFiles.add(textDownload.filename);
  assert.equal(textDownload.filename, "chordflow-suno-ababcb.txt");
  assert.equal(
    textDownload.content.toString("utf8"),
    copiedPackage,
    "Downloaded TXT and copied package must be identical"
  );

  await click(client, '[data-testid="suno-export-midi"]');
  const producedMidiDownload = await waitForDownloadedFile(
    downloadDirectory,
    downloadedFiles,
    (filename) =>
      filename.startsWith("chordflow-") && filename.endsWith(".mid"),
    "The updated MIDI reference"
  );
  downloadedFiles.add(producedMidiDownload.filename);
  const producedMidi = new Midi(producedMidiDownload.content);

  await click(client, '[data-testid="suno-close"]');
  await waitForExpression(
    client,
    `document.querySelector('[data-testid="suno-bridge"]') === null`,
    "Suno Bridge to close before JSON export"
  );
  await click(client, '[data-testid="export-json"]');
  const jsonDownload = await waitForDownloadedFile(
    downloadDirectory,
    downloadedFiles,
    (filename) =>
      filename.startsWith("chordflow-") && filename.endsWith(".json"),
    "The arrangement JSON"
  );
  downloadedFiles.add(jsonDownload.filename);
  const exportedArrangement = JSON.parse(
    jsonDownload.content.toString("utf8")
  );

  assert.equal(exportedArrangement.production.tempoBpm, 128);
  assert.equal(exportedArrangement.production.timeSignature, "6/8");
  assert.equal(exportedArrangement.production.barsPerSection, 8);
  assert.equal(exportedArrangement.production.voicingMode, "dramatic");
  assert.deepEqual(exportedArrangement.production.sectionOverrides["A:0"], {
    energy: expectedFirstSectionEnergy,
    voicingMode: "dramatic",
    textureMode: "full"
  });
  assert.deepEqual(exportedArrangement.production.sectionOverrides["B:0"], {
    energy: expectedSecondSectionEnergy,
    voicingMode: "stable",
    textureMode: "sparse"
  });
  const firstBassOverrideKey = `${exportedArrangement.sections[0].id}:0`;
  assert.equal(
    exportedArrangement.bassOverrides[firstBassOverrideKey],
    manualBassAnchor.pitchClass
  );

  assert.equal(Math.round(producedMidi.header.tempos[0].bpm), 128);
  assert.deepEqual(
    producedMidi.header.timeSignatures[0].timeSignature,
    [6, 8]
  );
  const expectedChordTicks =
    (producedMidi.header.ppq * 3 * 8) /
    exportedArrangement.sections[0].chords.length;
  assert.equal(
    producedMidi.tracks[0].notes[0].durationTicks,
    expectedChordTicks
  );
  assert.equal(producedMidi.tracks.length, 2);
  assert.equal(producedMidi.tracks[0].name, "ChordFlow Harmony");
  assert.equal(producedMidi.tracks[1].name, "ChordFlow Bass Guide");
  assert.equal(
    producedMidi.tracks[1].notes[0].midi % 12,
    manualBassAnchor.pitchClass
  );
  assert.equal(producedMidi.header.name, exportedArrangement.title);
  assert.equal(
    producedMidi.header.meta.length,
    exportedArrangement.sections.length
  );
  assert.match(producedMidi.header.meta[0].text, /^A \| VERSE \|/);
  assert.equal(producedMidi.header.meta[0].type, "marker");
  assert.equal(producedMidi.header.meta[0].ticks, 0);
  const secondSectionTicks = producedMidi.header.ppq * 3 * 8;
  assert.equal(producedMidi.header.meta[1].ticks, secondSectionTicks);
  assert.match(producedMidi.header.meta[1].text, /^B \| CHORUS \|/);
  assert.notDeepEqual(
    producedMidi.tracks[0].notes.map((note) => note.midi),
    baselineMidi.tracks[0].notes.map((note) => note.midi),
    "Dramatic voicing must change the exported harmony pitches"
  );
  assert.ok(
    producedMidi.tracks[0].notes[0].velocity >
      baselineMidi.tracks[0].notes[0].velocity,
    "The section energy increase must raise MIDI velocity"
  );
  const producedSecondSectionNote = producedMidi.tracks[0].notes.find(
    (note) => note.ticks === secondSectionTicks
  );
  const baselineSecondSectionNote = baselineMidi.tracks[0].notes.find(
    (note) => note.ticks === baselineMidi.header.ppq * 4 * 4
  );
  assert.ok(
    producedSecondSectionNote.velocity < baselineSecondSectionNote.velocity,
    "The second-section energy decrease must lower MIDI velocity"
  );
  const producedSecondSectionBass = producedMidi.tracks[1].notes.find(
    (note) => note.ticks === secondSectionTicks
  );
  assert.equal(
    producedSecondSectionNote.midi % 12,
    producedSecondSectionBass.midi % 12,
    "Stable section voicing must begin in root position"
  );

  await click(client, '[data-testid="suno-launch"]');
  await waitForExpression(
    client,
    `document.querySelector('[data-testid="suno-bridge"]') !== null`,
    "Suno Bridge to reopen"
  );
  await click(client, '[data-testid="suno-section-lock-0"]');
  await waitForExpression(
    client,
    `document.querySelector('[data-testid="suno-section-card-0"]')?.dataset.locked === 'false'`,
    "the first section to return to global production settings"
  );
  assert.match(
    await textContent(client, '[data-testid="suno-section-lock-summary"]'),
    /1 段已锁定/
  );
  await click(client, '[data-testid="suno-section-lock-1"]');
  await waitForExpression(
    client,
    `document.querySelector('[data-testid="suno-section-card-1"]')?.dataset.locked === 'false'`,
    "the second section to return to global production settings"
  );
  assert.doesNotMatch(
    await textContent(client, '[data-testid="suno-blueprint"]'),
    /SECTION LOCKS:/
  );
  await click(client, '[data-testid="suno-close"]');
  await fillInput(client, '#progression-input', '1645');
  await click(client, '.riff-input button[type="submit"]');
  await click(client, '.riff-styles button');
  await waitForExpression(client, 'document.querySelectorAll(".riff-grid rect").length > 0', 'riff notes to appear');
  await selectValue(client, '[data-testid="riff-ornament"]', 'passing');
  await selectValue(client, '[data-testid="riff-ending"]', 'resolve');
  await waitForExpression(client, 'document.querySelector(".riff-grid .riff-passing") !== null && document.querySelector(".riff-grid .riff-resolution") !== null', 'passing tones and final anchor to appear');
  await fillInput(client, '#progression-input', 'I V7/vi vi vii°7/V V');
  await click(client, '.riff-input button[type="submit"]');
  assert.equal(await client.evaluate('document.querySelector(".riff-error") === null'), true);
  assert.equal(await client.evaluate('document.querySelectorAll(".riff-grid > g").length'), 5);
  await fillInput(client, '#progression-input', 'I ii IV V');
  await click(client, '.riff-input button[type="submit"]');
  await selectValue(client, '[data-testid="riff-connection"]', 'anticipate');
  await waitForExpression(client, 'document.querySelector(".riff-anticipation") !== null', 'a weak-beat anticipation to appear');
  await selectValue(client, '[data-testid="riff-bars"]', '1');
  await selectValue(client, '[data-testid="riff-phrase"]', 'call-response');
  await waitForExpression(client, 'document.querySelector(".riff-phrase-label") !== null', 'call-response labels to appear');
  assert.equal(await client.evaluate('document.querySelector("[data-testid=riff-bars]").value'), '2');
  assert.equal(await client.evaluate('document.querySelector("[data-testid=riff-bars]").disabled'), true);
  await click(client, '[data-testid="project-undo"]');
  await waitForExpression(client, 'document.querySelector("[data-testid=riff-phrase]").value === "repeat"', 'undo to restore the loop');
  assert.equal(await client.evaluate('document.querySelector("[data-testid=riff-bars]").value'), '1');
  await click(client, '[data-testid="project-redo"]');
  await waitForExpression(client, 'document.querySelector(".riff-grid rect[data-phrase=response].riff-resolution") !== null', 'redo to restore answer roots');
  for (let i = 0; i < 3; i++) await click(client, '[data-testid="riff-rhythm-next"]');
  for (let i = 0; i < 3; i++) await click(client, '[data-testid="riff-pitch-next"]');
  assert.doesNotMatch(await textContent(client, '[data-testid="riff-variation"]'), /经典/);
  const variationBeforeUndo = await textContent(client, '[data-testid="riff-variation"]');
  await click(client, '[data-testid="project-undo"]');
  await waitForExpression(client, `document.querySelector('[data-testid="riff-variation"]').textContent !== ${JSON.stringify(variationBeforeUndo)}`, 'undo to restore the prior pitch variant');
  await click(client, '[data-testid="project-redo"]');
  await waitForExpression(client, `document.querySelector('[data-testid="riff-variation"]').textContent === ${JSON.stringify(variationBeforeUndo)}`, 'redo to restore the new pitch variant');
  const riffGeometry = 'Array.from(document.querySelectorAll(".riff-grid rect"), note => [note.getAttribute("x"), note.getAttribute("y"), note.getAttribute("width")])';
  const riffVelocities = 'Array.from(document.querySelectorAll(".riff-grid rect"), note => Number(note.dataset.velocity))';
  const geometryBeforeAccent = await client.evaluate(riffGeometry);
  const velocitiesBeforeAccent = await client.evaluate(riffVelocities);
  await selectValue(client, '[data-testid="riff-accent"]', 'pulse');
  const pulseVelocities = await client.evaluate(riffVelocities);
  assert.notDeepEqual(pulseVelocities, velocitiesBeforeAccent);
  assert.deepEqual(await client.evaluate(riffGeometry), geometryBeforeAccent);
  await selectValue(client, '[data-testid="riff-accent"]', 'offbeat');
  const offbeatVelocities = await client.evaluate(riffVelocities);
  assert.notDeepEqual(offbeatVelocities, pulseVelocities);
  assert.deepEqual(await client.evaluate(riffGeometry), geometryBeforeAccent);
  await click(client, '[data-testid="project-undo"]');
  assert.deepEqual(await client.evaluate(riffVelocities), pulseVelocities);
  await click(client, '[data-testid="project-redo"]');
  assert.deepEqual(await client.evaluate(riffVelocities), offbeatVelocities);
  assert.match(await textContent(client, '[data-testid="riff-accent-status"]'), /弱拍推动/);
  await click(client, '[data-testid="project-save"]');
  const variantProject = JSON.parse(await client.evaluate("localStorage.getItem('chordflow.project.v1')"));
  assert.equal(variantProject.arrangement.riffThemes.A.rhythmVersion, 2);
  assert.equal(variantProject.arrangement.riffThemes.A.pitchVersion, 2);
  assert.ok(variantProject.arrangement.riffThemes.A.rhythmSeed < 24);
  assert.ok(variantProject.arrangement.riffThemes.A.pitchSeed < 24);
  assert.equal(variantProject.arrangement.riffThemes.A.accent, 'offbeat');
  const displayedRiffPitches = await client.evaluate('Array.from(document.querySelectorAll(".riff-grid rect"), note => Number(note.querySelector("title").textContent.match(/^MIDI (\\d+)/)[1]))');
  await click(client, '[data-testid="riff-solo"]');
  await waitForExpression(client, 'document.querySelector(".riff-playhead") !== null', 'riff playback to advance');
  await click(client, '[data-testid="mine-chords"]');
  await waitForExpression(client, 'document.querySelectorAll(".riff-candidates article").length === 3', 'three mined chord candidates');
  assert.match(await textContent(client, '.mining-context'), /前段衔接 曲首 · 后段衔接/);
  await click(client, '[data-testid="mining-context-preview"]');
  await waitForExpression(client, 'document.querySelector(".timeline-chord.playing") !== null', 'contextual candidate audition to start');
  const beforeRiff = new Set(await readdir(downloadDirectory));
  await click(client, '[data-testid="riff-midi"]');
  const riffMidiFile = await waitForDownloadedFile(downloadDirectory, beforeRiff, name => name.endsWith('.mid'), 'riff MIDI');
  const riffMidi = new Midi(riffMidiFile.content);
  assert.equal(riffMidi.tracks.length, 3);
  assert.ok(riffMidi.tracks.find(track => track.name === 'ChordFlow Riff').notes.length > 0);
  const riffTrack = riffMidi.tracks.find(track => track.name === 'ChordFlow Riff');
  assert.deepEqual(riffTrack.notes.map(note => note.midi), displayedRiffPitches);
  assert.deepEqual(riffTrack.notes.map(note => Math.round(note.velocity * 127)), offbeatVelocities);
  const [riffNumerator, riffDenominator] = riffMidi.header.timeSignatures[0].timeSignature;
  const riffBarTicks = riffMidi.header.ppq * riffNumerator * 4 / riffDenominator;
  const riffPulseTicks = riffMidi.header.ppq * (riffNumerator === 6 && riffDenominator === 8 ? 1.5 : 1);
  riffTrack.notes.filter(note => Math.floor(note.ticks / riffBarTicks) % 2 === 0).forEach(note => {
    const callEnd = (Math.floor(note.ticks / riffBarTicks) + 1) * riffBarTicks;
    assert.ok(note.ticks + note.durationTicks <= callEnd - riffPulseTicks + 1, 'MIDI must preserve the call rest');
  });
  await click(client, '[data-testid="riff-wav"]');
  const riffWavFile = await waitForDownloadedFile(downloadDirectory, beforeRiff, name => name.endsWith('.wav'), 'riff WAV');
  assert.equal(riffWavFile.content.toString('ascii', 0, 4), 'RIFF');
  assert.equal(riffWavFile.content.toString('ascii', 8, 12), 'WAVE');
  assert.ok(riffWavFile.content.length > 44100);
  assert.ok(riffWavFile.content.subarray(44).some(byte => byte !== 0), 'reference audio must not be silent');
  await selectValue(client, '[data-testid="riff-wav-scope"]', 'solo');
  await click(client, '[data-testid="riff-wav"]');
  const soloWav = await waitForDownloadedFile(downloadDirectory, beforeRiff, name => name === 'chordflow-riff-solo.wav', 'solo riff WAV');
  assert.equal(soloWav.content.length, riffWavFile.content.length);
  assert.ok(soloWav.content.subarray(44).some(byte => byte !== 0));
  const restSeconds = 0.08 + (riffBarTicks - riffPulseTicks / 2) / riffMidi.header.ppq * 60 / riffMidi.header.tempos[0].bpm;
  const restByte = 44 + Math.floor(restSeconds * soloWav.content.readUInt32LE(24)) * 2;
  assert.ok(soloWav.content.subarray(restByte, restByte + 200).every(byte => byte === 0), 'solo WAV must keep the call rest silent');
  assert.ok(riffWavFile.content.subarray(restByte, restByte + 200).some(byte => byte !== 0), 'mixed WAV should retain the harmony under the riff rest');
  await click(client, '[data-testid="blind-start"]');
  await waitForExpression(client, 'document.querySelector(".blind-dialog")?.open === true', 'blind dialog to open');
  assert.equal(await client.evaluate('document.querySelector("[data-testid=blind-experiment]").value'), 'template-control');
  assert.equal(await client.evaluate('document.querySelector("[data-testid=blind-source]") === null'), true);
  assert.equal(await client.evaluate('document.querySelector("[data-testid=blind-reveal]") === null'), true);
  assert.equal(await client.evaluate('document.querySelector("[data-testid=blind-vote-A]").disabled'), true);
  assert.equal(await client.evaluate('document.querySelector("[data-testid=blind-reason]").disabled'), true);
  await click(client, '[data-testid="blind-play-A"]');
  await click(client, '[data-testid="blind-play-B"]');
  await waitForExpression(client, 'document.querySelector("[data-testid=blind-state-B]").textContent === "已听完"', 'B to finish');
  assert.equal(await client.evaluate('document.querySelector("[data-testid=blind-state-A]").textContent'), '待试听');
  assert.equal(await client.evaluate('document.querySelector("[data-testid=blind-vote-A]").disabled'), true);
  await click(client, '[data-testid="blind-play-A"]');
  await waitForExpression(client, 'document.querySelector("[data-testid=blind-vote-A]").disabled === false', 'both blind excerpts to finish');
  await selectValue(client, '[data-testid="blind-reason"]', 'flow');
  await click(client, '[data-testid="blind-vote-A"]');
  await waitForExpression(client, 'document.querySelector("[data-testid=blind-reveal]") !== null', 'blind choice to reveal the chords');
  assert.deepEqual(await client.evaluate('Array.from(document.querySelectorAll("[data-testid=blind-source]"), element => element.textContent).sort()'), ['来源：内置模板', '来源：挖掘结果']);
  await click(client, '[data-testid="blind-close"]');
  assert.match(await textContent(client, '[data-testid="listening-summary"]'), /1 次记录 · 1 次有偏好/);
  await click(client, '[data-testid="listening-export"]');
  const preferenceFile = await waitForDownloadedFile(downloadDirectory, beforeRiff, name => name === 'chordflow-listening.json', 'listening choices');
  const preferences = JSON.parse(preferenceFile.content.toString());
  assert.equal(preferences.records.length, 1);
  assert.equal(preferences.records[0].choice, 'A');
  assert.equal(preferences.records[0].reason, 'flow');
  assert.equal(preferences.records[0].trial.algorithm, 'chordflow-0.23');
  assert.equal(preferences.records[0].trial.experiment, 'template-control');
  assert.deepEqual(Object.values(preferences.records[0].trial.candidates).map(candidate => candidate.source).sort(), ['mined', 'template']);
  const preferredSource = preferences.records[0].trial.candidates.A.source === 'mined' ? '挖掘' : '模板';
  assert.ok((await textContent(client, '[data-testid="template-summary"]')).includes(`偏好${preferredSource} 1 次`));
  assert.equal(preferences.records[0].trial.candidates.A.arrangement.riff, undefined);
  assert.equal(preferences.records[0].trial.candidates.A.arrangement.riffThemes, undefined);
  await click(client, '.timeline-section:nth-child(2) .timeline-chord');
  await waitForExpression(client, 'document.querySelector(".riff-grid") === null', 'B to start without the A motif');
  await click(client, '[data-testid="riff-style-hook"]');
  assert.equal(await client.evaluate('document.querySelector("[data-testid=riff-phrase]").value'), 'repeat');
  await click(client, '[data-testid="riff-context"]');
  await waitForExpression(client, 'document.querySelector(".timeline-section:first-child .timeline-chord.playing") !== null', 'context playback to begin in A');
  assert.equal(await client.evaluate('document.querySelector(".riff-playhead") === null'), true);
  await waitForExpression(client, 'document.querySelector(".timeline-section:nth-child(2) .timeline-chord.playing") !== null && document.querySelector(".riff-playhead") !== null', 'B context playhead to use local beats', 15000);
  assert.ok(Number(await client.evaluate('document.querySelector(".riff-playhead").getAttribute("x1")')) < 100, 'the B playhead must start at its own left edge');
  await selectValue(client, '[data-testid="riff-scope"]', 'global');
  await click(client, '[data-testid="riff-style-syncopated"]');
  await selectValue(client, '[data-testid="riff-scope"]', 'theme');
  assert.equal(await client.evaluate('document.querySelector("[data-testid=riff-style-hook]").getAttribute("aria-pressed")'), 'true');
  await click(client, '[data-testid="riff-disable"]');
  await waitForExpression(client, 'document.querySelector(".riff-grid") === null', 'B to mute independently');
  await click(client, '[data-testid="riff-inherit"]');
  await waitForExpression(client, 'document.querySelector("[data-testid=riff-style-syncopated]").getAttribute("aria-pressed") === "true"', 'B to inherit the global motif');
  await click(client, '[data-testid="riff-disable"]');
  await click(client, '.timeline-section:nth-child(1) .timeline-chord');
  await waitForExpression(client, 'document.querySelector("[data-testid=riff-style-arpeggio]").getAttribute("aria-pressed") === "true"', 'A to retain its independent motif');
  assert.equal(await client.evaluate('document.querySelector("[data-testid=riff-ornament]").value'), 'passing');
  assert.equal(await client.evaluate('document.querySelector("[data-testid=riff-phrase]").value'), 'call-response');
  await click(client, '[data-testid="suno-launch"]');
  const themeBlueprint = await textContent(client, '[data-testid="suno-blueprint"]');
  assert.match(themeBlueprint, /weak-beat stepwise passing tones/);
  assert.match(themeBlueprint, /Riff: silent in this section/);
  assert.match(themeBlueprint, /call-response: one-bar call with a final main-pulse rest/);
  assert.match(themeBlueprint, /anticipate the next chord's melody anchor/);
  assert.match(themeBlueprint, /motif variation/);
  assert.match(themeBlueprint, /riff dynamics: emphasize existing melody attacks between dotted-quarter pulses/);

  await click(client, '[data-testid="suno-close"]');
  await click(client, '.timeline-section:nth-child(2) .timeline-chord');
  await click(client, '[data-testid="riff-style-arpeggio"]');
  await selectValue(client, '[data-testid="riff-tail-variation"]', '0');
  await fillInput(client, '#progression-input', 'ii ii ii ii');
  await click(client, '.riff-input button[type="submit"]');
  await selectValue(client, '[data-testid="riff-handoff"]', 'pickup');
  await waitForExpression(client, 'document.querySelector(".riff-handoff") !== null', 'the B-to-A pickup to appear');
  assert.match(await textContent(client, '[data-testid="riff-handoff-status"]'), /已在最后一个八分音符引入/);
  await click(client, '[data-testid="project-undo"]');
  await click(client, '.timeline-section:nth-child(2) .timeline-chord');
  assert.equal(await client.evaluate('document.querySelector(".riff-handoff") === null'), true);
  await click(client, '[data-testid="project-redo"]');
  await click(client, '.timeline-section:nth-child(2) .timeline-chord');
  await waitForExpression(client, 'document.querySelector(".riff-handoff") !== null', 'redo to restore the pickup');
  await click(client, '[data-testid="project-save"]');
  const handoffProject = JSON.parse(await client.evaluate("localStorage.getItem('chordflow.project.v1')"));
  assert.equal(handoffProject.arrangement.riffThemes.B.handoff, 'pickup');
  const handoffPitches = await client.evaluate('Array.from(document.querySelectorAll(".riff-grid rect"), note => Number(note.querySelector("title").textContent.match(/^MIDI (\\d+)/)[1]))');
  const beforeHandoff = new Set(await readdir(downloadDirectory));
  await click(client, '[data-testid="riff-midi"]');
  const handoffFile = await waitForDownloadedFile(downloadDirectory, beforeHandoff, name => name.endsWith('.mid'), 'section MIDI with pickup');
  beforeHandoff.add(handoffFile.filename);
  const handoffMidi = new Midi(handoffFile.content);
  const handoffTrack = handoffMidi.tracks.find(track => track.name === 'ChordFlow Riff');
  assert.deepEqual(handoffTrack.notes.map(note => note.midi), handoffPitches);
  const handoffSectionTicks = handoffMidi.header.ppq * 3 * 8; // This workflow is in 6/8, eight bars per section.
  assert.equal(handoffTrack.notes.at(-1).ticks, handoffSectionTicks - handoffMidi.header.ppq / 2);
  await click(client, '[data-testid="suno-launch"]');
  assert.match(await textContent(client, '[data-testid="suno-blueprint"]'), /section handoff: repeat the next section's opening pitch/);
  const fullHandoffFilename = `chordflow-${handoffProject.arrangement.formPattern.toLowerCase()}.mid`;
  await rm(join(downloadDirectory, fullHandoffFilename), { force: true });
  beforeHandoff.delete(fullHandoffFilename);
  await click(client, '[data-testid="suno-export-midi"]');
  const handoffSongFile = await waitForDownloadedFile(downloadDirectory, beforeHandoff, name => name.endsWith('.mid'), 'full MIDI with the same pickup');
  const handoffSong = new Midi(handoffSongFile.content);
  const songRiff = handoffSong.tracks.find(track => track.name === 'ChordFlow Riff');
  assert.deepEqual(songRiff.notes.filter(note => note.ticks >= handoffSectionTicks && note.ticks < 2 * handoffSectionTicks)
    .map(note => [note.midi, note.ticks - handoffSectionTicks, note.durationTicks]),
  handoffTrack.notes.map(note => [note.midi, note.ticks, note.durationTicks]));
  assert.equal(handoffTrack.notes.at(-1).midi, songRiff.notes.find(note => note.ticks === 2 * handoffSectionTicks).midi);
  await click(client, '[data-testid="suno-close"]');
  await click(client, '.timeline-section:nth-child(3) .timeline-chord');
  await click(client, '[data-testid="riff-disable"]');
  await click(client, '.timeline-section:nth-child(2) .timeline-chord');
  await waitForExpression(client, 'document.querySelector(".riff-handoff") === null', 'muting the next theme to remove its pickup');
  assert.match(await textContent(client, '[data-testid="riff-handoff-status"]'), /本段保留原句尾/);

  await fillInput(client, '#progression-input', 'Imaj9 vi9 ii9 V9');
  await click(client, '.riff-input button[type="submit"]');
  assert.equal(await client.evaluate('document.querySelector(".riff-error") === null'), true);
  const ninthLabels = 'Array.from(document.querySelectorAll(".riff-grid > g text"), node => node.textContent)';
  assert.deepEqual(await client.evaluate(ninthLabels), ['Ebmaj9', 'Cm9', 'Fm9', 'Bb9']);
  await click(client, '[data-testid="project-undo"]');
  await click(client, '.timeline-section:nth-child(2) .timeline-chord');
  assert.deepEqual(await client.evaluate(ninthLabels), ['Fm', 'Fm', 'Fm', 'Fm']);
  await click(client, '[data-testid="project-redo"]');
  await click(client, '.timeline-section:nth-child(2) .timeline-chord');
  assert.deepEqual(await client.evaluate(ninthLabels), ['Ebmaj9', 'Cm9', 'Fm9', 'Bb9']);
  await click(client, '[data-testid="project-save"]');
  const ninthProject = JSON.parse(await client.evaluate("localStorage.getItem('chordflow.project.v1')"));
  assert.deepEqual(ninthProject.arrangement.sections[1].numerals, ['Imaj9', 'vi9', 'ii9', 'V9']);
  await rm(join(downloadDirectory, handoffFile.filename), { force: true });
  const beforeNinths = new Set(await readdir(downloadDirectory));
  await click(client, '[data-testid="riff-midi"]');
  const ninthFile = await waitForDownloadedFile(downloadDirectory, beforeNinths, name => name.endsWith('.mid'), 'ninth-chord MIDI');
  const ninthMidi = new Midi(ninthFile.content);
  const ninthHarmony = ninthMidi.tracks.find(track => track.name === 'ChordFlow Harmony');
  const ninthPitchSets = [[2, 3, 5, 7, 10], [0, 2, 3, 7, 10], [0, 3, 5, 7, 8], [0, 2, 5, 8, 10]];
  ninthPitchSets.forEach((expected, i) => {
    const chordNotes = ninthHarmony.notes.filter(note => note.ticks === i * handoffSectionTicks / 4);
    assert.equal(chordNotes.length, 5);
    assert.deepEqual(chordNotes.map(note => note.midi % 12).sort((a, b) => a - b), expected);
  });
  await click(client, '[data-testid="riff-solo"]');
  await waitForExpression(client, 'document.querySelector(".riff-playhead") !== null', 'ninth-chord riff playback');
  await click(client, '[data-testid="suno-launch"]');
  const ninthBlueprint = await textContent(client, '[data-testid="suno-blueprint"]');
  for (const chord of ['Ebmaj9', 'Cm9', 'Fm9', 'Bb9']) assert.ok(ninthBlueprint.includes(chord));
  await click(client, '[data-testid="suno-close"]');
  const riffTiming = 'Array.from(document.querySelectorAll(".riff-grid rect"), note => [note.getAttribute("x"), note.getAttribute("width")])';
  const timingBeforeFocus = await client.evaluate(riffTiming);
  await selectValue(client, '[data-testid="riff-tone-focus"]', 'core');
  assert.equal(await client.evaluate('document.querySelectorAll(".riff-grid [data-color-tone]").length'), 0);
  assert.deepEqual(await client.evaluate(riffTiming), timingBeforeFocus);
  await selectValue(client, '[data-testid="riff-tone-focus"]', 'color');
  await waitForExpression(client, 'document.querySelector(".riff-grid [data-color-tone]") !== null', 'nearby weak-pulse color tones');
  assert.deepEqual(await client.evaluate(riffTiming), timingBeforeFocus);
  await click(client, '[data-testid="project-undo"]');
  await click(client, '.timeline-section:nth-child(2) .timeline-chord');
  assert.equal(await client.evaluate('document.querySelector("[data-testid=riff-tone-focus]").value'), 'core');
  assert.equal(await client.evaluate('document.querySelectorAll(".riff-grid [data-color-tone]").length'), 0);
  await click(client, '[data-testid="project-redo"]');
  await click(client, '.timeline-section:nth-child(2) .timeline-chord');
  await waitForExpression(client, 'document.querySelector(".riff-grid [data-color-tone]") !== null', 'redo to restore tone focus');
  await click(client, '[data-testid="project-save"]');
  const focusProject = JSON.parse(await client.evaluate("localStorage.getItem('chordflow.project.v1')"));
  assert.equal(focusProject.arrangement.riffThemes.B.toneFocus, 'color');
  const focusedPitches = await client.evaluate('Array.from(document.querySelectorAll(".riff-grid rect"), note => Number(note.querySelector("title").textContent.match(/^MIDI (\\d+)/)[1]))');
  await rm(join(downloadDirectory, ninthFile.filename), { force: true });
  const beforeFocus = new Set(await readdir(downloadDirectory));
  await click(client, '[data-testid="riff-midi"]');
  const focusedFile = await waitForDownloadedFile(downloadDirectory, beforeFocus, name => name.endsWith('.mid'), 'tone-focused MIDI');
  const focusedMidi = new Midi(focusedFile.content);
  assert.deepEqual(focusedMidi.tracks.find(track => track.name === 'ChordFlow Riff').notes.map(note => note.midi), focusedPitches);
  assert.deepEqual(focusedMidi.tracks.find(track => track.name === 'ChordFlow Harmony').toJSON(), ninthHarmony.toJSON());
  await click(client, '[data-testid="riff-solo"]');
  await waitForExpression(client, 'document.querySelector(".riff-playhead") !== null', 'tone-focused riff playback');
  await click(client, '[data-testid="suno-launch"]');
  const focusBlueprint = await textContent(client, '[data-testid="suno-blueprint"]');
  assert.match(focusBlueprint, /riff tone focus:/);
  assert.match(focusBlueprint, /within five semitones/);
  assert.deepEqual(runtimeExceptions, [], "The browser flow must not throw");

  process.stdout.write(
    "✓ A/B snapshots switched between two tonal centers\n" +
      "✓ Undo and redo restored the expected arrangement\n" +
      "✓ A saved project imported through the real JSON file input\n" +
      "✓ The JSON import participated in undo and redo history\n" +
      "✓ Production controls updated the Suno prompt and blueprint\n" +
      "✓ A manual bass anchor matched Suno, JSON, playback and MIDI\n" +
      "✓ Two section overrides preserved contrasting production directions\n" +
      "✓ MIDI carried positioned markers for every song section\n" +
      "✓ JSON preserved tempo, meter, voicing, energy and texture\n" +
      "✓ MIDI preserved tempo, meter, duration, voicing and energy\n" +
      "✓ Texture remained prompt/JSON-only without fake MIDI tracks\n" +
      "✓ Visible Style prompt matched the clipboard\n" +
      "✓ Section lock updated the blueprint\n" +
      "✓ Copied package matched the downloaded TXT\n" +
      "✓ Section unlock restored global production settings\n" +
      "✓ Chord input, riff playback, mining and real MIDI/WAV downloads worked\n" +
      "✓ Blind A/B listening required complete playback before recording and exporting a choice\n" +
      "✓ Theme motifs, passing tones, muting and inheritance matched the Suno blueprint\n" +
      "✓ Call-response survived undo/redo and matched visual notes, MIDI rests and Suno directions\n" +
      "✓ Secondary input, anticipations, solo WAV rests, local context playhead and listening reasons worked\n" +
      "✓ Versioned motif variants survived undo/redo, saved their independent versions and reached MIDI/WAV/Suno\n" +
      "✓ Section handoffs survived undo/redo and save, matched the grid and both MIDI exports, and respected next-theme muting\n" +
      "✓ Riff accents changed only dynamics, survived undo/redo and save, and matched visible velocities, MIDI and Suno\n" +
      "✓ Ninth chords survived input, undo/redo and save, played as riffs and retained all five pitches in MIDI and Suno labels\n" +
      "✓ Riff tone focus preserved harmony and base timing, survived undo/redo and save, and matched color markers, MIDI and Suno\n"
  );
} finally {
  await client?.close().catch(() => undefined);
  await stopProcess(chrome);
  await stopProcess(vite);
  await rm(temporaryRoot, { recursive: true, force: true });
}
