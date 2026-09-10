const { test, expect } = require('@playwright/test');
const { bootAuthedApp } = require('./helpers');

/** Drop a raw notification row into the feed and render it. */
async function seedNotif(page, notif) {
  await page.evaluate(n => {
    _notifications.unshift({ id: 'n-test', timestamp: Date.now(), read: false, ...n });
    openNotifDrawer();
  }, notif);
}

test.describe('notification inline links', () => {
  test('only the entity name becomes a link, not the whole message', async ({ page }) => {
    await bootAuthedApp(page);
    await page.evaluate(() =>
      addNotification('🎪 You are locked in for Tomorrowland! Pack your kit.', [nlRave(getFestival('f1'))]));
    await page.evaluate(() => openNotifDrawer());

    const link = page.locator('#notif-list .notif-link');
    await expect(link).toHaveCount(1);
    await expect(link).toHaveText('Tomorrowland');
    await expect(link).toHaveAttribute('data-nl-kind', 'rave');
    await expect(link).toHaveAttribute('data-nl-id', 'f1');
    // The rest of the sentence stays plain text.
    await expect(page.locator('#notif-list .notif-text').first()).toContainText('Pack your kit.');
  });

  test('tapping a crew link closes the drawer and opens that crew', async ({ page }) => {
    await bootAuthedApp(page);
    await page.evaluate(() =>
      addNotification('🎉 You joined Bass Syndicate! Welcome to the tribe.', [nlCrew(getCrew('c1'))]));
    await page.evaluate(() => openNotifDrawer());

    await page.locator('#notif-list .notif-link').click();
    await expect(page.locator('#notif-drawer-overlay')).not.toHaveClass(/open/);
    await expect(page.locator('#page-crew-detail')).toHaveClass(/active/);
  });

  test('tapping a rave link opens the rave', async ({ page }) => {
    await bootAuthedApp(page);
    await page.evaluate(() =>
      addNotification('🗓️ Awakenings is on the radar!', [nlRave(getFestival('f2'))]));
    await page.evaluate(() => openNotifDrawer());

    await page.locator('#notif-list .notif-link').click();
    await expect(page.locator('#rave-edit-overlay')).toHaveClass(/open/);
    expect(await page.evaluate(() => editingFestivalId)).toBe('f2');
  });

  test('a message with a person AND a crew links both, without nesting', async ({ page }) => {
    await bootAuthedApp(page);
    await page.evaluate(() =>
      addNotification('🎤 Sam has been added to Bass Syndicate! Share their QR code.', [
        nlRaver(getRaver('r-sam'), 'Sam'),
        nlCrew(getCrew('c1')),
      ]));
    await page.evaluate(() => openNotifDrawer());

    const links = page.locator('#notif-list .notif-link');
    await expect(links).toHaveCount(2);
    await expect(links.nth(0)).toHaveAttribute('data-nl-kind', 'raver');
    await expect(links.nth(1)).toHaveAttribute('data-nl-kind', 'crew');
    // No link span ended up inside another one.
    expect(await page.locator('#notif-list .notif-link .notif-link').count()).toBe(0);
  });

  test('a renamed entity falls back to static text instead of mislinking', async ({ page }) => {
    await bootAuthedApp(page);
    await seedNotif(page, {
      message: '🎉 You joined Bass Syndicate!',
      data: { links: [{ t: 'Some Other Crew', k: 'crew', id: 'c1' }] },
    });
    await expect(page.locator('#notif-list .notif-link')).toHaveCount(0);
    await expect(page.locator('#notif-list')).toContainText('You joined Bass Syndicate!');
  });

  test('trigger-generated rows linkify from type + data alone', async ({ page }) => {
    await bootAuthedApp(page);
    await seedNotif(page, {
      message: '🎪 Kai added you to Tomorrowland! You are on the lineup.',
      type: 'festival_add',
      data: { festival_id: 'f1', raver_id: 'r-you', festival_name: 'Tomorrowland' },
    });
    const link = page.locator('#notif-list .notif-link');
    await expect(link).toHaveCount(1);
    await expect(link).toHaveAttribute('data-nl-id', 'f1');
  });

  test('a huddle link carries the room and message ids for the deep link', async ({ page }) => {
    await bootAuthedApp(page);
    await page.evaluate(() =>
      addNotification('💬 Kai mentioned you in Bass Syndicate: "yo"', [nlHuddle(getCrew('c1'), 'room-1', 'msg-9')]));
    await page.evaluate(() => openNotifDrawer());

    const link = page.locator('#notif-list .notif-link');
    await expect(link).toHaveAttribute('data-nl-kind', 'huddle');
    await expect(link).toHaveAttribute('data-nl-room', 'room-1');
    await expect(link).toHaveAttribute('data-nl-msg', 'msg-9');
  });

  test('link text is escaped, not injected as markup', async ({ page }) => {
    await bootAuthedApp(page);
    const evil = '<img src=x onerror="window.__pwned=1">';
    await seedNotif(page, {
      message: `🎉 You joined ${evil}!`,
      data: { links: [{ t: evil, k: 'crew', id: 'c1' }] },
    });
    await expect(page.locator('#notif-list .notif-link')).toHaveCount(1);
    expect(await page.locator('#notif-list img').count()).toBe(0);
    expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
    await expect(page.locator('#notif-list .notif-link')).toHaveText(evil);
  });

  test('rows with an entity but no links keep the whole-row tap fallback', async ({ page }) => {
    await bootAuthedApp(page);
    await seedNotif(page, {
      message: 'Something happened in a crew you cannot name.',
      entityType: 'crew',
      entityId: 'c1',
    });
    await expect(page.locator('#notif-list .notif-link')).toHaveCount(0);
    await page.locator('#notif-list .notif-text').first().click();
    await expect(page.locator('#page-crew-detail')).toHaveClass(/active/);
  });
});

test.describe('PLUR points notification links', () => {
  /** Drop a points notification into the feed and render it. */
  async function seedPoints(page, over = {}) {
    await page.evaluate(o => {
      _notifications.unshift({
        id: 'n-plur', timestamp: Date.now(), read: false,
        message: '☮️ +10 Peace points',
        type: 'points_earned',
        data: { track: 'peace', amount: 10, event_type: 'rsvp', ...o },
      });
      openNotifDrawer();
    }, over);
  }

  test('the track name links to the PLUR breakdown', async ({ page }) => {
    await bootAuthedApp(page);
    await seedPoints(page);

    const link = page.locator('#notif-list .notif-link');
    await expect(link).toHaveCount(1);
    await expect(link).toHaveText('Peace points');
    await expect(link).toHaveAttribute('data-nl-kind', 'plur');
    // Resolved at render time to your own raver, not stored on the row.
    await expect(link).toHaveAttribute('data-nl-id', 'r-you');
  });

  test('tapping it opens How PLUR Points Work', async ({ page }) => {
    await bootAuthedApp(page);
    await seedPoints(page);

    await page.locator('#notif-list .notif-link').click();
    await expect(page.locator('#notif-drawer-overlay')).not.toHaveClass(/open/);
    await expect(page.locator('#plur-info-overlay')).toHaveClass(/open/);
    await expect(page.locator('#plur-info-body')).toContainText('How PLUR Points Work');
  });

  test('every track resolves its own label', async ({ page }) => {
    await bootAuthedApp(page);
    for (const [track, label] of [['love', 'Love'], ['unity', 'Unity'], ['respect', 'Respect']]) {
      await page.evaluate(t => { _notifications.length = 0; }, track);
      await page.evaluate(({ t, l }) => {
        _notifications.unshift({
          id: 'n-' + t, timestamp: Date.now(), read: false,
          message: `✨ +5 ${l} points`,
          type: 'points_earned', data: { track: t, amount: 5 },
        });
        renderNotifList();
      }, { t: track, l: label });
      await expect(page.locator('#notif-list .notif-link')).toHaveText(`${label} points`);
    }
  });

  test('an unknown track stays static rather than guessing', async ({ page }) => {
    await bootAuthedApp(page);
    await seedPoints(page, { track: 'chaos' });
    await expect(page.locator('#notif-list .notif-link')).toHaveCount(0);
    await expect(page.locator('#notif-list')).toContainText('+10 Peace points');
  });
});
