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
      id, innerHTML: '', textContent: '', value: '', checked: false, style: {}, options: { length: 0 },
      classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }
    };
  }
  const readerText = html.match(/<article[^>]*id="readerText"[^>]*>([\s\S]*?)<\/article>/);
  elements.readerText.innerHTML = readerText ? readerText[1] : '';
  const loreEntries = [{ dataset: { revealAt: '2' }, innerHTML: 'Secret lore', classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }, closest() { return this; } }];
  const document = {
    getElementById(id) {
      if (!elements[id]) elements[id] = {
        id, innerHTML: '', textContent: '', value: '', checked: false, style: {}, options: { length: 0 },
        classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }
      };
      return elements[id];
    },
    querySelectorAll(selector) { return selector === '#lore [data-reveal-at]' ? loreEntries : []; },
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
    document, localStorage, window, history,
    MutationObserver: class { constructor(callback) { this.callback = callback; } observe() {} disconnect() {} },
    confirm: () => true,
    setTimeout: () => 1, clearTimeout() {}, console
  };
  vm.runInNewContext(source + `
    globalThis.__app = {
      state: () => pvState,
      openBook, openReaderByIndex, toggleBookmark, pvToggleFollow,
      pvToggleChapterBookmark, pvSaveChapter, pvRenderOfflineChapterList, pvDeleteOfflineChapter, saveProgress, pvAddComment, pvAddCommentReply, pvReportComment, pvAddFeedItem, pvCreateLocalAnnouncement, pvToggleHiddenGenre, renderRecommendations, pvCreateClub, pvAddClubPost, pvAddImportedBook, pvRemoveImportedBook, pvLoreUnlocked, pvApplyLoreSpoilers, pvRevealLoreElement, chapterIndex: () => chapterIndex,
      createBook, go, pvNavigateBack, toggleCatalogFilters, closeCatalogFilters, setFilterTab, toggleGenreList, resetCatalogFilters, applyCatalogFilters, resumeReading
    };
  `, context, { filename: 'plotverse-smoke.js' });
  return { context, elements, store, app: context.__app, listeners, loreEntries };
}

const store = {};
const first = createHarness(store);
assert.ok(first.elements.catalogList.innerHTML.length > 0, 'Catalog should render on startup');
first.app.toggleCatalogFilters();
first.app.closeCatalogFilters();
first.app.toggleGenreList();
first.app.toggleGenreList();
first.app.resetCatalogFilters();
first.app.applyCatalogFilters();
assert.ok(first.elements.catalogList.innerHTML.length > 0, 'Catalog should still render after filter controls are used');
assert.ok(first.elements.chapterList.innerHTML.length > 0, 'Chapter list should render on startup');
first.app.go('catalog');
assert.equal(first.app.pvNavigateBack(), true, 'Android back navigation should return to the previous app screen');
assert.equal(first.app.pvLoreUnlocked(2), false, 'Lore should remain hidden before its reveal chapter');
first.app.state().progress['Путь теней'] = { chapterIndex: 2, percent: 40 };
assert.equal(first.app.pvLoreUnlocked(2), true, 'Lore should unlock at its reveal chapter');
delete first.app.state().progress['Путь теней'];
first.app.go('lore');
assert.match(first.loreEntries[0].innerHTML, /Спойлер скрыт/, 'Lore card should hide its spoiler before the reveal chapter');
first.app.state().progress['Путь теней'] = { chapterIndex: 2, percent: 40 };
first.app.go('lore');
assert.equal(first.loreEntries[0].innerHTML, 'Secret lore', 'Lore card should reveal at the required chapter');
delete first.app.state().progress['Путь теней'];
first.app.go('lore');
first.app.pvRevealLoreElement({ closest: () => first.loreEntries[0] });
assert.equal(first.loreEntries[0].innerHTML, 'Secret lore', 'Reader should be able to reveal a spoiler manually');

first.app.openBook('Путь теней');
first.app.toggleBookmark();
first.app.pvToggleFollow();

first.elements.commentInput.value = 'Smoke-test theory';
first.elements.commentType.value = 'theory';
first.elements.commentSpoiler.checked = true;
first.app.pvAddComment();
const localComment = first.app.state().comments['Путь теней::6'][0];
first.elements['commentReply-' + localComment.id] = { value: 'Smoke-test reply' };
first.app.pvAddCommentReply(0);
first.app.pvReportComment(0);

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
first.elements.publishBook.value = 'Путь теней';
first.app.pvCreateLocalAnnouncement();
first.app.pvToggleHiddenGenre('Фэнтези');
first.app.renderRecommendations();
assert.doesNotMatch(first.elements.recommendationList.innerHTML, /Путь теней/, 'Current work should not recommend itself');
assert.ok(first.elements.analyticsTrend.innerHTML.length > 0, 'Seven-day analytics trend should render');
first.elements.clubName.value = 'Smoke-test club';
first.elements.clubDescription.value = 'Local reading group';
first.app.pvCreateClub();
const testClub = first.app.state().clubs[0];
first.elements['clubPost-' + testClub.id] = { value: 'Spoiler discussion' };
first.elements['clubSpoiler-' + testClub.id] = { checked: true };
first.app.pvAddClubPost(testClub.id);
assert.equal(first.app.pvAddImportedBook('Smoke Import.md', '# Chapter 1\n\nImported text one.\n\n# Chapter 2\n\nImported text two.'), true, 'Text file should import');
assert.equal(first.app.state().importedBooks[0].localChapters.length, 2, 'Markdown headings should split chapters');
assert.match(first.elements.offlineStats.textContent, /1 импортированных книг/, 'Offline storage should count imported books');
first.app.openBook('Smoke Import');
first.app.openReaderByIndex(0);
assert.match(first.elements.readerText.innerHTML, /Imported text one/, 'Imported chapter should render');
first.app.openReaderByIndex(1);
assert.match(first.elements.readerText.innerHTML, /Imported text two/, 'Next imported chapter should render');
first.app.saveProgress();
assert.equal(first.app.state().progress['Smoke Import'].percent, 100, 'Imported reading progress should use the imported chapter count');
first.app.pvToggleChapterBookmark();
assert.ok(first.app.state().chapterBookmarks.includes('Smoke Import::1'), 'Imported chapter bookmark should use its real chapter index');
first.app.go('catalog');

const persisted = JSON.parse(store['plotverse.local.v2']);
assert.ok(persisted.bookmarks.includes('Путь теней'), 'Work bookmark should persist');
assert.ok(persisted.followingAuthors.includes('RAEFFSKY'), 'Author subscription should persist');
assert.equal(persisted.drafts.length, 1, 'Draft should persist');
assert.ok(persisted.chapterBookmarks.some(item => item === 'Путь теней::6' || (item && item.book === 'Путь теней' && item.index === 6)), 'Chapter bookmark should persist');
assert.equal(persisted.offlineChapters['Путь теней::6'].title, 'Глава 7. Колокол безмолвия', 'Offline chapter should persist');
assert.match(first.elements.offlineChapterList.innerHTML, /Колокол безмолвия/, 'Offline settings should list saved chapters');
assert.equal(persisted.comments['Путь теней::6'].length, 1, 'Comment should persist');
assert.equal(persisted.comments['Путь теней::6'][0].replies.length, 1, 'Comment reply should persist');
assert.equal(persisted.comments['Путь теней::6'][0].reported, true, 'Local report should persist');
assert.equal(persisted.feedItems.length, 1, 'Feed item should persist');
assert.equal(persisted.feedItems[0].local, true, 'Local announcement should be marked as local-only');
assert.ok(persisted.analyticsEvents.some(event => event.type === 'book'), 'Book-open analytics should persist');
assert.ok(persisted.analyticsEvents.some(event => event.type === 'chapter'), 'Chapter-open analytics should persist');
assert.deepEqual(persisted.hiddenGenres, ['Фэнтези'], 'Hidden genre preferences should persist');
assert.equal(persisted.clubs.length, 1, 'Book club should persist');
assert.equal(persisted.clubs[0].posts.length, 1, 'Club discussion should persist');
assert.equal(persisted.importedBooks.length, 1, 'Imported book should persist');

const beforeRestart = JSON.parse(store['plotverse.local.v2']);
beforeRestart.currentBook = 'Smoke Import';
delete beforeRestart.progress['Smoke Import'];
store['plotverse.local.v2'] = JSON.stringify(beforeRestart);
const second = createHarness(store);
assert.equal(second.app.chapterIndex(), 0, 'Imported book should start at chapter one when no progress exists');
assert.equal(second.app.state().drafts.length, 1, 'Draft should survive app restart');
assert.ok(second.app.state().chapterBookmarks.some(item => item === 'Путь теней::6' || (item && item.book === 'Путь теней' && item.index === 6)), 'Chapter bookmark should survive app restart');
assert.equal(second.app.state().feedItems.length, 1, 'Feed should survive app restart');
assert.equal(second.app.state().clubs.length, 1, 'Book club should survive app restart');
assert.equal(second.app.state().importedBooks.length, 1, 'Imported book should survive app restart');
second.app.openBook('Smoke Import');
second.app.openReaderByIndex(1);
assert.match(second.elements.readerText.innerHTML, /Imported text two/, 'Imported chapter should restore after restart');
second.app.pvRemoveImportedBook(second.app.state().importedBooks[0].localId);
assert.equal(second.app.state().importedBooks.length, 0, 'Imported book should be removable');
assert.ok(second.app.state().analyticsEvents.length >= 2, 'Analytics should survive app restart');
second.app.openReaderByIndex(0);
second.app.openReaderByIndex(6);
assert.match(second.elements.readerText.innerHTML, /Колокол Седьмой башни не звучал/, 'Saved chapter should restore after restart');
second.app.pvDeleteOfflineChapter(encodeURIComponent('Путь теней::6'));
assert.equal(Object.keys(second.app.state().offlineChapters).length, 0, 'Saved offline chapter should be removable from settings');

console.log('PLOTVERSE smoke tests passed: startup, catalog, navigation, local persistence, offline chapter, comments, subscriptions, feed, analytics, recommendations, book clubs, offline TXT/Markdown import and draft creation.');
