// A voice note belongs to the room it was recorded in. Switching rooms while
// it finishes recording or uploads used to post it to the new room, or cancel
// it outright (the room switch tore down the recorder mid-stop).
const { test, expect } = require('@playwright/test');
const { bootAuthedApp, collectPageErrors, seedData, TEST_UID } = require('./helpers');

const ymd = d => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);

function seedTwoRooms() {
  const data = seedData();
  data.festivals = data.festivals.concat([
    { id: 'f-last', name: 'Last Night Fest', date: ymd(1), location: 'Tampa, FL', color: '#00F5FF', days: null, deleted_at: null },
  ]);
  data.raver_festivals = data.raver_festivals.concat([
    { raver_id: 'r-you', festival_id: 'f-last' },
    { raver_id: 'r-sam', festival_id: 'f-last' },
  ]);
  data.huddle_rooms = [
    { id: 'room-main', crew_id: 'c1', room_key: 'main', kind: 'main', name: 'Main Huddle', festival_id: null, created_by: TEST_UID, created_at: '2024-01-01T00:00:00Z' },
    { id: 'room-last', crew_id: 'c1', room_key: 'festival:f-last', kind: 'festival', name: 'Last Night Fest Huddle', festival_id: 'f-last', created_by: TEST_UID, created_at: '2024-01-02T00:00:00Z' },
  ];
  data.huddle_messages = [];
  data.huddle_room_reads = [];
  return data;
}

// Fake mic + recorder: stop() delivers one chunk, then fires onstop after a
// short delay, the way a real recorder finishes asynchronously.
async function installFakeRecorder(page) {
  await page.addInitScript(() => {
    const fakeStream = { getTracks: () => [{ stop() {} }] };
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => fakeStream } });
    window.MediaRecorder = class {
      constructor(stream) { this.stream = stream; this.mimeType = 'audio/webm'; this.state = 'inactive'; }
      static isTypeSupported(t) { return t === 'audio/webm'; }
      start() { this.state = 'recording'; }
      stop() {
        this.state = 'inactive';
        setTimeout(() => {
          this.ondataavailable && this.ondataavailable({ data: new Blob(['voice'], { type: 'audio/webm' }) });
          setTimeout(() => this.onstop && this.onstop(), 150);
        }, 0);
      }
    };
  });
}

async function openChat(page) {
  await installFakeRecorder(page);
  await bootAuthedApp(page, { data: seedTwoRooms(), sessionOver: { user_metadata: { guidance_dismissed: true, seen_tips: { beacon: true } } } });
  await page.evaluate(async () => { await openHuddle('c1'); });
  await expect(page.locator('#huddle-screen')).toHaveClass(/open/);
  // Slow uploads that record their path, and a public URL that keeps it.
  await page.evaluate(() => {
    window.__uploads = [];
    const orig = sb.storage.from.bind(sb.storage);
    sb.storage.from = bucket => ({
      ...orig(bucket),
      upload: path => { window.__uploads.push(path); return new Promise(r => setTimeout(() => r({ data: { path }, error: null }), 300)); },
      getPublicUrl: path => ({ data: { publicUrl: 'https://media.test/' + path } }),
    });
  });
}

// Records a 5 s note in the open room.
async function record(page) {
  await page.evaluate(async () => {
    await startHuddleVoiceRecording();
    _huddleRecordingStartedAt = Date.now() - 5000;
  });
}

const voiceRows = page => page.evaluate(() => window.__store.huddle_messages.filter(m => m.kind === 'voice'));

test('a voice note sent in one room stays there when you switch rooms straight after', async ({ page }) => {
  const errors = collectPageErrors(page);
  await openChat(page);
  expect(await page.evaluate(() => _huddleActiveRoomId)).toBe('room-main');
  await record(page);

  // Let go, then switch before the recorder has even finished.
  await page.evaluate(async () => {
    const sending = stopHuddleVoiceRecording();
    await switchHuddleRoom('room-last');
    await sending;
  });

  expect(await page.evaluate(() => _huddleActiveRoomId)).toBe('room-last');
  const uploads = await page.evaluate(() => window.__uploads);
  expect(uploads).toHaveLength(1);
  expect(uploads[0]).toMatch(/^crews\/c1\/room-main\//);
  const rows = await voiceRows(page);
  expect(rows).toHaveLength(1);
  expect(rows[0].room_id).toBe('room-main');
  expect(rows[0].media_duration_ms).toBeGreaterThanOrEqual(5000);
  // Not shown in the room you moved to.
  expect(await page.evaluate(() => huddleMessages.filter(m => m.kind === 'voice').length)).toBe(0);
  expect(errors).toEqual([]);
});

test('a voice note in the room you stay in still sends normally', async ({ page }) => {
  await openChat(page);
  await record(page);
  await page.evaluate(() => stopHuddleVoiceRecording());

  const rows = await voiceRows(page);
  expect(rows).toHaveLength(1);
  expect(rows[0].room_id).toBe('room-main');
  expect(await page.evaluate(() => huddleMessages.filter(m => m.kind === 'voice' && !m._pending).length)).toBe(1);
});

test('starting a new note while the last one finishes keeps their audio apart', async ({ page }) => {
  await openChat(page);
  await record(page);
  await page.evaluate(async () => {
    const sending = stopHuddleVoiceRecording();
    // The mic is free again straight away.
    await startHuddleVoiceRecording();
    window.__secondChunks = _huddleRecordedChunks;
    await sending;
  });
  // The first recorder's late chunk must not land in the second note.
  expect(await page.evaluate(() => window.__secondChunks.length)).toBe(0);
  expect(await page.evaluate(() => !!_huddleRecorder)).toBe(true);
  expect(await voiceRows(page)).toHaveLength(1);
});
