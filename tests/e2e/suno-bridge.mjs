import assert from "node:assert/strict";
import { once } from "node:events";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

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

async function waitForDownloadedText(downloadDirectory) {
  const deadline = Date.now() + 7000;
  while (Date.now() < deadline) {
    const files = await readdir(downloadDirectory);
    const filename = files.find(
      (item) =>
        item.startsWith("chordflow-suno-") &&
        item.endsWith(".txt") &&
        !item.endsWith(".crdownload")
    );
    if (filename) {
      return {
        filename,
        content: await readFile(join(downloadDirectory, filename), "utf8")
      };
    }
    await sleep(50);
  }
  throw new Error("The Suno TXT package was not downloaded");
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
  await click(client, '[data-testid="suno-launch"]');
  await waitForExpression(
    client,
    `document.querySelector('[data-testid="suno-bridge"]') !== null`,
    "Suno Bridge to open"
  );

  const stylePrompt = await textContent(
    client,
    '[data-testid="suno-style-prompt"]'
  );
  await click(client, '[data-testid="suno-copy-style"]');
  await waitForExpression(
    client,
    `document.querySelector('[data-testid="suno-copy-style"]')?.textContent.includes('已复制') === true`,
    "style copy confirmation"
  );
  const copiedStyle = await client.evaluate("navigator.clipboard.readText()");
  assert.equal(copiedStyle, stylePrompt, "Style copy must match the visible prompt");

  await click(client, '[data-testid="suno-section-lock-0"]');
  await waitForExpression(
    client,
    `document.querySelector('[data-testid="suno-section-card-0"]')?.dataset.locked === 'true'`,
    "the first section to lock"
  );
  assert.match(
    await textContent(client, '[data-testid="suno-section-lock-summary"]'),
    /1 段已锁定/
  );
  const lockedBlueprint = await textContent(
    client,
    '[data-testid="suno-blueprint"]'
  );
  assert.match(lockedBlueprint, /SECTION LOCKS: 1 section/);
  assert.match(lockedBlueprint, /Texture .* LOCKED/);

  await click(client, '[data-testid="suno-copy-all"]');
  await waitForExpression(
    client,
    `document.querySelector('[data-testid="suno-copy-all"]')?.textContent.includes('整包已复制') === true`,
    "package copy confirmation"
  );
  const copiedPackage = await client.evaluate("navigator.clipboard.readText()");
  assert.match(copiedPackage, /CHORDFLOW → SUNO BRIDGE/);
  assert.match(copiedPackage, /TEXTURE ARC:/);
  assert.match(copiedPackage, /SECTION LOCKS: 1 section/);

  await click(client, '[data-testid="suno-download-txt"]');
  const download = await waitForDownloadedText(downloadDirectory);
  assert.equal(download.filename, "chordflow-suno-ababcb.txt");
  assert.equal(
    download.content,
    copiedPackage,
    "Downloaded TXT and copied package must be identical"
  );

  await click(client, '[data-testid="suno-section-lock-0"]');
  await waitForExpression(
    client,
    `document.querySelector('[data-testid="suno-section-card-0"]')?.dataset.locked === 'false'`,
    "the first section to return to global production settings"
  );
  assert.doesNotMatch(
    await textContent(client, '[data-testid="suno-blueprint"]'),
    /SECTION LOCKS:/
  );
  assert.deepEqual(runtimeExceptions, [], "The browser flow must not throw");

  process.stdout.write(
    "✓ Suno Bridge opened\n" +
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
