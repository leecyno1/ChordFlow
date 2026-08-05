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

async function waitForExpression(client, expression, description) {
  const deadline = Date.now() + 7000;
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
      "✓ Section unlock restored global production settings\n"
  );
} finally {
  await client?.close().catch(() => undefined);
  await stopProcess(chrome);
  await stopProcess(vite);
  await rm(temporaryRoot, { recursive: true, force: true });
}
