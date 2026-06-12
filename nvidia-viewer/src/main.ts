import { AppStreamer, EventAction, EventStatus, StreamType, type ApplicationMessage, type DirectConfig, type StreamEvent, type StreamMessage } from "@nvidia/ov-web-rtc";
import "./style.css";

const video = mustElement<HTMLVideoElement>("remote-video");
const statusEl = mustElement<HTMLElement>("status");
const metricsEl = mustElement<HTMLElement>("metrics");
const eventsEl = mustElement<HTMLPreElement>("events");
const serverInput = mustElement<HTMLInputElement>("server");
const portInput = mustElement<HTMLInputElement>("signaling-port");
const connectButton = mustElement<HTMLButtonElement>("connect");
const disconnectButton = mustElement<HTMLButtonElement>("disconnect");

const params = new URLSearchParams(window.location.search);
serverInput.value = params.get("server") || import.meta.env.VITE_SERVER_HOST || window.location.hostname || "127.0.0.1";
portInput.value = params.get("signalingport") || params.get("signalingPort") || import.meta.env.VITE_SIGNALING_PORT || "49100";

let connected = false;
let firstVideoFrameSeen = false;

connectButton.addEventListener("click", () => void connect());
disconnectButton.addEventListener("click", () => void disconnect());
video.addEventListener("loadedmetadata", () => updateVideoMetrics("loadedmetadata"));
video.addEventListener("resize", () => updateVideoMetrics("resize"));
video.addEventListener("playing", () => updateVideoMetrics("playing"));

window.addEventListener("beforeunload", () => {
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
}

function updateVideoMetrics(source: string): void {
  const ready = video.videoWidth > 0 && video.videoHeight > 0;
  if (ready && !firstVideoFrameSeen) {
    firstVideoFrameSeen = true;
    document.body.dataset.firstVideoFrame = "true";
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
  eventsEl.textContent = `${line}\n${eventsEl.textContent}`.slice(0, 16000);
}

function serializeError(error: unknown): object {
  if (error instanceof Error) return { name: error.name, message: error.message, stack: error.stack };
  return { message: String(error) };
}

function mustElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element as T;
}
