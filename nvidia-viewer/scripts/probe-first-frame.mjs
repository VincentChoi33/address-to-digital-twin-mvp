#!/usr/bin/env node
import { chromium } from 'playwright';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i], process.argv[i + 1]);
}
const url = args.get('--url') || 'http://127.0.0.1:5191/?server=127.0.0.1&signalingport=49100';
const outputJson = args.get('--output-json') || 'browser_first_frame_report.json';
const screenshot = args.get('--screenshot') || 'browser_first_frame.png';
const timeoutMs = Number(args.get('--timeout-ms') || 90000);

const report = {
  status: 'failed',
  url,
  started_at_unix: Date.now() / 1000,
  browser: 'playwright-chromium',
  checks: []
};

let browser;
try {
  browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream']
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('console', (message) => {
    report.checks.push({ type: 'console', level: message.type(), text: message.text() });
  });
  page.on('pageerror', (error) => {
    report.checks.push({ type: 'pageerror', text: String(error) });
  });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.click('#connect', { timeout: 10000 });
  await page.waitForFunction(() => {
    const video = document.querySelector('#remote-video');
    return document.body.dataset.firstVideoFrame === 'true' || Boolean(video && video.videoWidth > 0 && video.videoHeight > 0 && video.readyState >= 2);
  }, { timeout: timeoutMs });
  const videoState = await page.evaluate(() => {
    const video = document.querySelector('#remote-video');
    return {
      bodyStatus: document.body.dataset.status || null,
      firstVideoFrame: document.body.dataset.firstVideoFrame || null,
      videoWidth: video?.videoWidth ?? 0,
      videoHeight: video?.videoHeight ?? 0,
      readyState: video?.readyState ?? 0,
      paused: video?.paused ?? null,
      metrics: document.querySelector('#metrics')?.textContent || null,
      events: document.querySelector('#events')?.textContent?.slice(0, 4000) || null
    };
  });
  await mkdir(dirname(resolve(screenshot)), { recursive: true });
  await page.screenshot({ path: screenshot, fullPage: true });
  report.status = 'passed';
  report.video = videoState;
  report.screenshot = resolve(screenshot);
} catch (error) {
  report.status = 'failed';
  report.error = error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : { message: String(error) };
} finally {
  if (browser) await browser.close();
  report.finished_at_unix = Date.now() / 1000;
  report.elapsed_seconds = Number((report.finished_at_unix - report.started_at_unix).toFixed(6));
  await mkdir(dirname(resolve(outputJson)), { recursive: true });
  await writeFile(outputJson, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(report, null, 2));
}
process.exitCode = report.status === 'passed' ? 0 : 1;
