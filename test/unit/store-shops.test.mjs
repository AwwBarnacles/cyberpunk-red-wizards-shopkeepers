import { test } from "node:test";
import { deepStrictEqual, equal, ok } from "node:assert/strict";
import { readFile } from "node:fs/promises";

globalThis.FormApplication = class {};
const { loadStoreItems, categorizeItems, groupBySubtype } = await import("../../scripts/data/store-loader.js");
const { assignShop, getShop, removeShop, isItemVisible, setItemVisible } = await import("../../scripts/store/shop-state.js");

const doc = (name, type, system = {}) => ({ name, type, system, uuid: `Item.${name}` });

test("catalog uses system subtypes, includes cyberdecks and preserves upgrade targets", async () => {
  const docs = [
    doc("Pistol", "weapon", { weaponType: "heavyPistol", price: { market: 100 } }),
    doc("Deck", "cyberdeck"),
    doc("Sight", "itemUpgrade", { type: "weapon" }),
    doc("Armor upgrade", "itemUpgrade", { type: "armor" }),
    doc("Rounds", "ammo", { variety: "heavyPistol", type: "basic" }),
    doc("Jacket", "clothing", { type: "jacket" }),
    doc("Defender", "program", { class: "defender" }),
    doc("Tool", "gear"),
  ];
  globalThis.game = {
    settings: { get: () => ({}) },
    packs: [
      { metadata: { id: "cyberpunk-red-core.core_items", type: "Item" }, getDocuments: async () => docs },
      { metadata: { id: "cyberpunk-red-core.internal_items", type: "Item" }, getDocuments: async () => { throw Error("internal pack loaded"); } },
    ],
    items: [doc("World weapon", "weapon", { weaponType: "heavyPistol" })],
    i18n: { has: () => false, localize: key => key },
  };
  const items = await loadStoreItems();
  const categories = categorizeItems(items);
  equal(categories.cyberdeck[0].name, "Deck");
  equal(categories.ammo[0].subtype, "heavyPistol");
  equal(categories.clothing[0].subtype, "jacket");
  equal(categories.program[0].subtype, "defender");
  deepStrictEqual(categories.itemUpgrade.map(i => i.upgradeTarget), ["armor", "weapon"]);
  const groups = groupBySubtype(categories.weapon, categories.itemUpgrade.filter(i => i.upgradeTarget === "weapon"));
  deepStrictEqual(groups.map(g => g.label), ["Heavy Pistol", "crw.store.categories.itemUpgrade"]);
  deepStrictEqual(groups[0].items.map(i => i.name), ["Pistol", "World weapon"]);
  deepStrictEqual(groups[1].items.map(i => i.name), ["Sight"]);
  equal(groupBySubtype(categories.gear)[0].label, "crw.store.shop.other");
});

test("shop settings are isolated, copied from legacy settings, and GM-managed", async () => {
  const legacy = { categoryEnabled: { weapon: false }, blockedItems: ["Item.hidden"], priceMin: 10, priceMax: 0 };
  globalThis.game = {
    user: { isGM: true },
    settings: { get: (_module, key) => key === "storeMarkup" ? 150 : legacy },
    i18n: { localize: key => key, format: key => key },
  };
  foundry.utils.deepClone = structuredClone;
  globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { LIMITED: 1 } };
  globalThis.ui = { notifications: { info() {}, warn() {} } };
  const actor = name => ({
    name, ownership: { default: 0 }, flags: {},
    getFlag(_module, key) { return this.flags[key]; },
    async setFlag(_module, key, value) { this.flags[key] = structuredClone(value); },
    async unsetFlag(_module, key) { delete this.flags[key]; },
    async update(changes) { this.ownership.default = changes["ownership.default"]; },
  });
  const first = actor("first"), second = actor("second");
  await assignShop(first);
  await assignShop(second);
  equal(first.ownership.default, 1);
  equal(getShop(first).markup, 150);
  equal(getShop(first).stockMode, "selected");
  equal(isItemVisible(getShop(first), "Item.any"), false);
  const updated = getShop(first);
  updated.blockedItems.push("Item.extra");
  await first.setFlag("", "shop", updated);
  deepStrictEqual(getShop(second).blockedItems, []);
  deepStrictEqual(legacy.blockedItems, ["Item.hidden"]);
  game.user.isGM = false;
  await removeShop(first);
  ok(getShop(first));
  game.user.isGM = true;
  await removeShop(first);
  equal(getShop(first), null);
  ok(getShop(second));
});

test("visibility defaults to hidden for new shops and preserves legacy shops", () => {
  const selected = { stockMode: "selected", visibleItems: [], blockedItems: [] };
  equal(isItemVisible(selected, "Item.one"), false);
  setItemVisible(selected, "Item.one", true);
  equal(isItemVisible(selected, "Item.one"), true);
  equal(isItemVisible(selected, "Item.new"), false);
  setItemVisible(selected, "Item.one", false);
  equal(isItemVisible(selected, "Item.one"), false);
  const legacy = { stockMode: "legacy", blockedItems: ["Item.one"], visibleItems: [] };
  equal(isItemVisible(legacy, "Item.one"), false);
  equal(isItemVisible(legacy, "Item.new"), true);
  setItemVisible(legacy, "Item.one", true);
  equal(isItemVisible(legacy, "Item.one"), true);
});

test("store contexts isolate prices and put only matching upgrades after weapon groups", async () => {
  foundry.applications.api.ApplicationV2 = class {
    constructor(options) { this.options = options; }
    render() { this.rendered = true; }
    async close() { this.rendered = false; }
  };
  const { default: StoreApp } = await import("../../scripts/app/store-app.js");
  const buyer = { id: "buyer", type: "character", isOwner: true, system: { wealth: { value: 1000 } } };
  const actors = [buyer];
  actors.get = id => actors.find(a => a.id === id);
  const shop = (id, markup) => ({
    id, uuid: `Actor.${id}`, name: id, type: "mook",
    state: { markup, categoryEnabled: {}, blockedItems: [], priceMin: 0, priceMax: 0 },
    testUserPermission: () => true,
    getFlag() { return this.state; },
    async setFlag(module, key, value) {
      equal(module, "cyberpunk-red-wizards");
      equal(key, "shop");
      this.state = value;
    },
  });
  globalThis.game = {
    user: { isGM: true, character: buyer }, actors,
    packs: [], settings: { get: () => ({}) },
    items: [
      doc("Pistol", "weapon", { weaponType: "heavyPistol", price: { market: 100 } }),
      doc("Sight", "itemUpgrade", { type: "weapon", price: { market: 50 } }),
      doc("Armor mod", "itemUpgrade", { type: "armor" }),
    ],
    i18n: { has: () => false, localize: key => key },
  };
  const a = StoreApp.open(shop("a", 100));
  const b = StoreApp.open(shop("b", 200));
  const first = await a._prepareContext();
  const second = await b._prepareContext();
  equal(first.itemGroups[0].items[0].finalPrice, "100");
  equal(second.itemGroups[0].items[0].finalPrice, "200");
  deepStrictEqual(first.itemGroups.at(-1).items.map(i => i.name), ["Sight"]);
  ok(first.tabs.some(t => t.type === "cyberdeck" && t.visible));
  equal(a.options.id, "crw-store-Actor-a");
  await StoreApp.DEFAULT_OPTIONS.actions.adjustMarkup.call(a, null, { dataset: { delta: "10" } });
  equal((await a._prepareContext()).markup, 110);
  equal((await b._prepareContext()).markup, 200);
  await a.close();
  await b.close();
});

test("GM without a buyer can browse and manage stock, players see only revealed stock", async () => {
  const { default: StoreApp } = await import("../../scripts/app/store-app.js");
  const actors = [];
  actors.get = id => actors.find(a => a.id === id);
  const shop = {
    id: "shop", uuid: "Actor.shop", name: "Shop", type: "mook",
    state: { stockMode: "selected", visibleItems: [], categoryEnabled: {}, blockedItems: [], markup: 100 },
    testUserPermission: () => true,
    getFlag() { return this.state; },
    async setFlag(_module, _key, value) { this.state = value; },
  };
  globalThis.game = {
    user: { isGM: true, character: null }, actors, packs: [], settings: { get: () => ({}) },
    items: [doc("Pistol", "weapon", { weaponType: "heavyPistol", price: { market: 100 } })],
    i18n: { has: () => false, localize: key => key },
  };
  const app = StoreApp.open(shop);
  let context = await app._prepareContext();
  equal(context.selectedActor, false);
  equal(context.itemGroups[0].items[0].hidden, true);
  equal(context.itemGroups[0].items[0].unaffordable, false);
  await StoreApp.DEFAULT_OPTIONS.actions.restoreItem.call(app, null, { dataset: { uuid: "Item.Pistol" } });
  equal((await app._prepareContext()).itemGroups[0].items[0].hidden, false);
  const buyer = { id: "buyer", type: "character", isOwner: true, system: { wealth: { value: 1000 } } };
  actors.push(buyer);
  game.user.isGM = false;
  game.user.character = buyer;
  context = await app._prepareContext();
  equal(context.itemGroups[0].items[0].name, "Pistol");
  game.user.isGM = true;
  await StoreApp.DEFAULT_OPTIONS.actions.hideItem.call(app, null, { dataset: { uuid: "Item.Pistol" } });
  game.user.isGM = false;
  equal((await app._prepareContext()).itemGroups.length, 0);
  game.user.isGM = true;
  await StoreApp.DEFAULT_OPTIONS.actions.restoreAllItems.call(app);
  equal(isItemVisible(getShop(shop), "Item.Pistol"), true);
  equal(isItemVisible(getShop(shop), "Item.future"), false);
  await app.close();
});

test("GM macro opens selected or targeted shop without a character", async () => {
  const macro = JSON.parse(await readFile(new URL("../../packs/_source/macros/open-shop.json", import.meta.url), "utf8"));
  const run = new (Object.getPrototypeOf(async function () {}).constructor)(macro.command);
  const selected = { actor: { id: "selected" } }, targeted = { actor: { id: "targeted" } };
  const opened = [], warnings = [];
  globalThis.canvas = { tokens: { controlled: [selected] } };
  globalThis.game = {
    user: { isGM: true, character: null, targets: { first: () => targeted } },
    modules: new Map([["cyberpunk-red-wizards", { api: { open: actor => opened.push(actor.id) } }]]),
    i18n: { localize: key => key },
  };
  globalThis.ui = { notifications: { warn: message => warnings.push(message) } };
  await run();
  canvas.tokens.controlled = [];
  await run();
  deepStrictEqual(opened, ["selected", "targeted"]);
  game.user.isGM = false;
  await run();
  deepStrictEqual(opened, ["selected", "targeted"]);
  deepStrictEqual(warnings, ["crw.store.shop.gmOnly"]);
});
