const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('app/src/main/assets/index.html', 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);
assert.equal(scripts.length, 1, 'Expected one inline application script');
const source = scripts[0];
new vm.Script(source, { filename: 'plotverse-inline.js' });

function createHarness(store) {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  const elements = {};
  for (const id of ids) {
    elements[id] = {
      id, innerHTML: '', textContent: '', value: '', checked: false, style: {},
      classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }
    };
  }
  const readerText = html.match(/<article[^>]*id="readerText"[^>]*>([\s\S]*?)<\/article>/);
  elements.readerText.innerHTML = readerText ? readerText[1] : '';
  const document = {
    getElementById(id) {
      if (!elements[id]) elements[id] = {
        id, innerHTML: '', textContent: '', value: '', checked: false, style: {},
        classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }
      };
      return elements[id];
    },
    querySelectorAll() { return []; },
    querySelector() { return { id: 'home' }; },
    createElement() { return { click() {}, style: {} }; }
  };
  const localStorage = {
    getItem(key) { return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null; },
    setItem(key, value) { store[key] = String(value); }
  };
  const listeners = {};
  const window = {
    scrollTo() {},
    addEventListener(name, callback) { listeners[name] = callback; }
  };
  const history = { pushState(state, title, url) { store.__lastHistoryUrl = url; } };
  const context = {
    document, localStorage, window, history, confirm: () => true,
    setTimeout: () => 1, clearTimeout() {}, console
  };
  vm.runInNewContext(source + `
    globalThis.__app = {
      state: () => pvState,
      openBook, openReaderByIndex, toggleBookmark, pvToggleFollow,
      pvToggleChapterBookmark, pvSaveChapter, pvAddComment, pvAddFeedItem, pvToggleHiddenGenre, renderRecommendations,
      createBook, go, resumeReading
    };
  `, context, { filename: 'plotverse-smoke.js' });
  return { context, elements, store, app: context.__app, listeners };
}

const store = {};
const first = createHarness(store);
assert.ok(first.elements.catalogList.innerHTML.length > 0, 'Catalog should render on startup');
assert.ok(first.elements.chapterList.innerHTML.length > 0, 'Chapter list should render on startup');

first.app.openBook('Путь теней');
first.app.toggleBookmark();
first.app.pvToggleFollow();

first.elements.commentInput.value = 'Smoke-test theory';
first.elements.commentType.value = 'theory';
first.elements.commentSpoiler.checked = true;
first.app.pvAddComment();

first.elements.newTitle.value = 'Smoke-test draft';
first.elements.newGenre.value = 'Фэнтези';
first.elements.newDesc.value = 'Draft created by automated smoke test';
first.app.createBook();

first.app.openReaderByIndex(0);
assert.match(first.elements.readerText.innerHTML, /Текст главы пока недоступен/, 'Missing chapter text should not be presented as real content');
first.app.openReaderByIndex(6);
assert.match(first.elements.readerText.innerHTML, /Колокол Седьмой башни не звучал/, 'Known sample chapter should render its actual text');
first.app.pvSaveChapter(6);
first.app.pvToggleChapterBookmark();
first.app.pvAddFeedItem({ id: 'smoke-feed', author: 'RAEFFSKY', title: 'Smoke-test update' });
first.app.pvToggleHiddenGenre('Фэнтези');
first.app.renderRecommendations();
first.app.go('catalog');

const persisted = JSON.parse(store['plotverse.local.v2']);
assert.ok(persisted.bookmarks.includes('Путь теней'), 'Work bookmark should persist');
assert.ok(persisted.followingAuthors.includes('RAEFFSKY'), 'Author subscription should persist');
assert.equal(persisted.drafts.length, 1, 'Draft should persist');
assert.equal(persisted.chapterBookmarks.length, 1, 'Chapter bookmark should persist');
assert.equal(persisted.offlineChapters['Путь теней::6'].title, 'Глава 7. Колокол безмолвия', 'Offline chapter should persist');
assert.equal(persisted.comments['Путь теней::6'].length, 1, 'Comment should persist');
assert.equal(persisted.feedItems.length, 1, 'Feed item should persist');
assert.ok(persisted.analyticsEvents.some(event => event.type === 'book'), 'Book-open analytics should persist');
assert.ok(persisted.analyticsEvents.some(event => event.type === 'chapter'), 'Chapter-open analytics should persist');
assert.deepEqual(persisted.hiddenGenres, ['Фэнтези'], 'Hidden genre preferences should persist');

const second = createHarness(store);
assert.equal(second.app.state().drafts.length, 1, 'Draft should survive app restart');
assert.equal(second.app.state().chapterBookmarks.length, 1, 'Chapter bookmark should survive app restart');
assert.equal(second.app.state().feedItems.length, 1, 'Feed should survive app restart');
assert.ok(second.app.state().analyticsEvents.length >= 2, 'Analytics should survive app restart');
second.app.openReaderByIndex(0);
second.app.openReaderByIndex(6);
assert.match(second.elements.readerText.innerHTML, /Колокол Седьмой башни не звучал/, 'Saved chapter should restore after restart');

console.log('PLOTVERSE smoke tests passed: startup, catalog, navigation, local persistence, offline chapter, comments, subscriptions, feed, analytics, recommendations and draft creation.');
