import { AppStreamer, EventAction, EventStatus, StreamType, type ApplicationMessage, type DirectConfig, type StreamEvent, type StreamMessage } from "@nvidia/ov-web-rtc";
import "./style.css";

const video = mustElement<HTMLVideoElement>("remote-video");
const statusEl = mustElement<HTMLElement>("status");
const metricsEl = mustElement<HTMLElement>("metrics");
const telemetryEl = mustElement<HTMLPreElement>("telemetry");
const eventsEl = mustElement<HTMLPreElement>("events");
const serverInput = mustElement<HTMLInputElement>("server");
const portInput = mustElement<HTMLInputElement>("signaling-port");
const streamPortInput = mustElement<HTMLInputElement>("stream-port");
const healthPortInput = mustElement<HTMLInputElement>("health-port");
const connectButton = mustElement<HTMLButtonElement>("connect");
const disconnectButton = mustElement<HTMLButtonElement>("disconnect");
const healthButton = mustElement<HTMLButtonElement>("health-check");
const orbitLeftButton = mustElement<HTMLButtonElement>("orbit-left");
const orbitRightButton = mustElement<HTMLButtonElement>("orbit-right");
const zoomInButton = mustElement<HTMLButtonElement>("zoom-in");
const zoomOutButton = mustElement<HTMLButtonElement>("zoom-out");
const toggleFloodButton = mustElement<HTMLButtonElement>("toggle-flood");
const fit720Button = mustElement<HTMLButtonElement>("fit-720");
const presetButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-preset]"));

const params = new URLSearchParams(window.location.search);
serverInput.value = params.get("server") || import.meta.env.VITE_SERVER_HOST || window.location.hostname || "127.0.0.1";
portInput.value = params.get("signalingport") || params.get("signalingPort") || import.meta.env.VITE_SIGNALING_PORT || "49100";
streamPortInput.value = params.get("streamport") || params.get("streamPort") || import.meta.env.VITE_STREAM_PORT || "49101";
healthPortInput.value = params.get("healthport") || params.get("healthPort") || import.meta.env.VITE_HEALTH_PORT || "18081";

let connected = false;
let firstVideoFrameSeen = false;
let floodVisible = true;
let healthTimer: number | undefined;

connectButton.addEventListener("click", () => void connect());
disconnectButton.addEventListener("click", () => void disconnect());
healthButton.addEventListener("click", () => void probeHealth());
video.addEventListener("loadedmetadata", () => updateVideoMetrics("loadedmetadata"));
video.addEventListener("resize", () => updateVideoMetrics("resize"));
video.addEventListener("playing", () => updateVideoMetrics("playing"));

for (const button of presetButtons) {
  button.addEventListener("click", () => void sendCommand("camera.set", { preset: button.dataset.preset || "home" }));
}
orbitLeftButton.addEventListener("click", () => void sendCommand("camera.orbit", { yawDeltaDeg: -18 }));
orbitRightButton.addEventListener("click", () => void sendCommand("camera.orbit", { yawDeltaDeg: 18 }));
zoomInButton.addEventListener("click", () => void sendCommand("camera.zoom", { factor: 0.82 }));
zoomOutButton.addEventListener("click", () => void sendCommand("camera.zoom", { factor: 1.18 }));
toggleFloodButton.addEventListener("click", () => {
  floodVisible = !floodVisible;
  toggleFloodButton.classList.toggle("active", floodVisible);
  void sendCommand("layer.visibility", { layer: "flood", visible: floodVisible });
});
fit720Button.addEventListener("click", () => void resizeStream(1280, 720));

document.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
  const key = event.key.toLowerCase();
  if (key === "h" || key === "r") void sendCommand("camera.set", { preset: "home" });
  else if (key === "t") void sendCommand("camera.set", { preset: "top" });
  else if (key === "a" || event.key === "ArrowLeft") void sendCommand("camera.orbit", { yawDeltaDeg: -12 });
  else if (key === "d" || event.key === "ArrowRight") void sendCommand("camera.orbit", { yawDeltaDeg: 12 });
  else if (key === "w" || event.key === "ArrowUp") void sendCommand("camera.zoom", { factor: 0.88 });
  else if (key === "s" || event.key === "ArrowDown") void sendCommand("camera.zoom", { factor: 1.14 });
});

window.addEventListener("beforeunload", () => {
  if (healthTimer !== undefined) window.clearInterval(healthTimer);
  if (connected) void AppStreamer.terminate(false).catch(() => undefined);
});

async function connect(): Promise<void> {
  if (connected) return;
  firstVideoFrameSeen = false;
  setStatus("connecting");
  connectButton.disabled = true;

  const config: DirectConfig = {
    videoElementId: "remote-video",
    audioElementId: "remote-audio",
    server: serverInput.value.trim(),
    signalingPort: Number(portInput.value) || 49100,
    mediaServer: serverInput.value.trim(),
    mediaPort: Number(streamPortInput.value) || 49101,
    nativeTouchEvents: true,
    fps: 30,
    maxReconnects: 5,
    reconnectDelay: 3000,
    width: 1280,
    height: 720,
    onStart: handleStreamEvent,
    onUpdate: handleStreamEvent,
    onStop: handleStreamEvent,
    onTerminate: handleStreamEvent,
    onStreamStats: handleStreamEvent,
    onCustomEvent: handleCustomEvent
  };

  try {
    const event = await AppStreamer.connect({ streamSource: StreamType.DIRECT, streamConfig: config });
    handleStreamEvent(event);
    connected = event.status !== EventStatus.ERROR && event.status !== EventStatus.CANCELED;
    setStatus(connected ? "connected" : "failed");
    startHealthPolling();
    if (connected) {
      scheduleMediaWatchdog();
      void sendCommand("camera.set", { preset: params.get("preset") || "home" });
    }
  } catch (error) {
    logEvent("connect.error", serializeError(error));
    setStatus("failed");
  } finally {
    connectButton.disabled = false;
  }
}

async function disconnect(): Promise<void> {
  if (!connected) return;
  setStatus("disconnecting");
  try {
    const event = await AppStreamer.terminate(false);
    handleStreamEvent(event);
  } catch (error) {
    logEvent("disconnect.error", serializeError(error));
  } finally {
    connected = false;
    setStatus("disconnected");
  }
}

async function sendCommand(eventType: string, payload: Record<string, unknown>): Promise<void> {
  const message: ApplicationMessage = {
    event_type: eventType,
    id: crypto.randomUUID(),
    payload
  };
  if (!connected) {
    logEvent("command.skipped", { reason: "not connected", message });
    return;
  }
  try {
    const event = await AppStreamer.sendMessage(message);
    logEvent("command.sent", { message, event });
  } catch (error) {
    logEvent("command.error", { message, error: serializeError(error) });
  }
}

async function resizeStream(width: number, height: number): Promise<void> {
  if (!connected) {
    logEvent("resize.skipped", { reason: "not connected", width, height });
    return;
  }
  try {
    const event = await AppStreamer.resize(width, height);
    logEvent("resize.sent", event);
  } catch (error) {
    logEvent("resize.error", serializeError(error));
  }
}

async function probeHealth(): Promise<void> {
  const server = serverInput.value.trim() || "127.0.0.1";
  const port = Number(healthPortInput.value) || 18081;
  const url = `http://${server}:${port}/healthz`;
  try {
    const response = await fetch(url, { cache: "no-store" });
    const payload: unknown = await response.json();
    telemetryEl.textContent = JSON.stringify({ url, httpStatus: response.status, payload }, null, 2);
    document.body.dataset.serverReady = response.ok ? "true" : "false";
  } catch (error) {
    telemetryEl.textContent = JSON.stringify({ url, error: serializeError(error) }, null, 2);
    document.body.dataset.serverReady = "false";
  }
}

function startHealthPolling(): void {
  if (healthTimer !== undefined) window.clearInterval(healthTimer);
  void probeHealth();
  healthTimer = window.setInterval(() => void probeHealth(), 2500);
}

function handleStreamEvent(event: StreamEvent): void {
  logEvent("stream", event);
  if (event.action === EventAction.START && event.status === EventStatus.SUCCESS) {
    connected = true;
    setStatus("streaming");
  }
  if (event.status === EventStatus.ERROR) setStatus("error");
}

function handleCustomEvent(message: ApplicationMessage | StreamMessage): void {
  logEvent("custom", message);
  if (isApplicationMessage(message) && message.event_type.startsWith("server.")) {
    telemetryEl.textContent = JSON.stringify(message, null, 2);
  }
}

function scheduleMediaWatchdog(): void {
  window.setTimeout(() => {
    if (!firstVideoFrameSeen && connected) {
      document.body.dataset.mediaPending = "true";
      setStatus("signaling connected · media pending");
      metricsEl.textContent = "WebRTC signaling/health OK, but video media is still pending. Check direct UDP/TCP reachability for the ovstream media port.";
      logEvent("browser.mediaPending", { signaling: portInput.value, streamPort: streamPortInput.value, server: serverInput.value });
    }
  }, 15000);
}

function updateVideoMetrics(source: string): void {
  const ready = video.videoWidth > 0 && video.videoHeight > 0;
  if (ready && !firstVideoFrameSeen) {
    firstVideoFrameSeen = true;
    document.body.dataset.firstVideoFrame = "true";
    document.body.dataset.mediaPending = "false";
    logEvent("browser.firstVideoFrame", {
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
      readyState: video.readyState,
      source
    });
  }
  metricsEl.textContent = `${source}: ${video.videoWidth}×${video.videoHeight}, readyState=${video.readyState}, paused=${video.paused}`;
}

function setStatus(value: string): void {
  statusEl.textContent = value;
  document.body.dataset.status = value;
}

function logEvent(kind: string, payload: unknown): void {
  const line = `[${new Date().toISOString()}] ${kind} ${JSON.stringify(payload, null, 2)}`;
  eventsEl.textContent = `${line}\n${eventsEl.textContent}`.slice(0, 24000);
}

function serializeError(error: unknown): object {
  if (error instanceof Error) return { name: error.name, message: error.message, stack: error.stack };
  return { message: String(error) };
}

function isApplicationMessage(message: ApplicationMessage | StreamMessage): message is ApplicationMessage {
  return "event_type" in message;
}

function mustElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element as T;
}

if (params.get("autoconnect") === "1" || params.get("autoconnect") === "true") {
  window.setTimeout(() => void connect(), 300);
} else {
  void probeHealth();
}
