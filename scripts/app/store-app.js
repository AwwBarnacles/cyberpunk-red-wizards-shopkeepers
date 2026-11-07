import { loadStoreItems, categorizeItems, groupBySubtype } from "../data/store-loader.js";
import { purchaseItem, lootItem, calculateFinalPrice } from "../store/store-purchase.js";
import { getShop } from "../store/shop-state.js";
import { MODULE_ID } from "../constants.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const CATEGORY_TABS = [
  { type: "ammo", label: "crw.store.categories.ammo" },
  { type: "armor", label: "crw.store.categories.armor" },
  { type: "clothing", label: "crw.store.categories.clothing" },
  { type: "cyberdeck", label: "crw.store.categories.cyberdeck" },
  { type: "cyberware", label: "crw.store.categories.cyberware" },
  { type: "gear", label: "crw.store.categories.gear" },
  { type: "program", label: "crw.store.categories.program" },
  { type: "itemUpgrade", label: "crw.store.categories.itemUpgrade" },
  { type: "vehicle", label: "crw.store.categories.vehicle" },
  { type: "weapon", label: "crw.store.categories.weapon" },
];

export default class StoreApp extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    classes: ["crw-store-window"],
    tag: "div",
    window: {
      title: "crw.store.title",
      icon: "fas fa-store",
      resizable: true,
    },
    position: {
      width: 750,
      height: 650,
    },
    actions: {
      buyItem: StoreApp.#onBuyItem,
      lootItem: StoreApp.#onLootItem,
      adjustMarkup: StoreApp.#onAdjustMarkup,
      setMarkup: StoreApp.#onSetMarkup,
      resetPriceRange: StoreApp.#onResetPriceRange,
      restoreItem: StoreApp.#onRestoreItem,
      restoreAllItems: StoreApp.#onRestoreAllItems,
      hideItem: StoreApp.#onHideItem,
      clearSearch: StoreApp.#onClearSearch,
    },
  };

  static PARTS = {
    body: {
      template: "modules/cyberpunk-red-wizards/templates/store.hbs",
    },
  };

  static #instances = new Map();

  #shopActor;
  #allItems = null;
  #state = {
    activeTab: "weapon",
    searchValue: "",
    selectedActorId: null,
  };

  constructor(actor) {
    super({ id: `crw-store-${actor.uuid.replaceAll(".", "-")}` });
    this.#shopActor = actor;
  }

  get title() { return this.#shopActor?.name ?? game.i18n.localize("crw.store.title"); }

  static open(actor) {
    if (!getShop(actor)) return ui.notifications.warn(game.i18n.localize("crw.store.shop.notShop"));
    if (!actor.testUserPermission(game.user, "LIMITED")) {
      return ui.notifications.warn(game.i18n.localize("crw.store.shop.noPermission"));
    }
    let app = StoreApp.#instances.get(actor.uuid);
    if (!app) {
      app = new StoreApp(actor);
      StoreApp.#instances.set(actor.uuid, app);
    }
    app.render(true);
    return app;
  }

  static refresh(actor) {
    for (const app of StoreApp.#instances.values()) {
      if (app.#shopActor.uuid === actor.uuid) {
        app.#shopActor = actor;
        if (getShop(actor) && actor.testUserPermission(game.user, "LIMITED")) app.render(true);
        else app.close();
      } else if (actor.type === "character" && app.rendered) app.render(true);
    }
  }

  static closeFor(actor) {
    StoreApp.#instances.get(actor.uuid)?.close();
  }

  static invalidateCatalog() {
    for (const app of StoreApp.#instances.values()) {
      app.#allItems = null;
      if (app.rendered) app.render(true);
    }
  }

  #getSelectedActor() {
    if (this.#state.selectedActorId) {
      const actor = game.actors.get(this.#state.selectedActorId);
      if (actor && actor.type === "character" && actor.id !== this.#shopActor.id &&
          (game.user.isGM || actor.isOwner)) return actor;
    }
    if (game.user.character?.type === "character" && game.user.character.id !== this.#shopActor.id &&
        (game.user.isGM || game.user.character.isOwner)) {
      this.#state.selectedActorId = game.user.character.id;
      return game.user.character;
    }
    const choices = this.#getActorChoices();
    if (choices.length > 0) {
      this.#state.selectedActorId = choices[0].id;
      return game.actors.get(choices[0].id);
    }
    return null;
  }

  #getActorChoices() {
    const actors = game.user.isGM
      ? game.actors.filter(a => a.type === "character" && a.id !== this.#shopActor.id)
      : game.actors.filter(a => a.isOwner && a.type === "character" && a.id !== this.#shopActor.id);
    return actors.map(a => ({
      id: a.id,
      name: a.name,
      selected: a.id === this.#state.selectedActorId,
    }));
  }

  async _prepareContext(options) {
    const body = this.element?.querySelector(".crw-store-body");
    this._savedScrollTop = body?.scrollTop ?? null;

    if (!this.#allItems) {
      this.#allItems = await loadStoreItems();
    }

    const actor = this.#getSelectedActor();
    const shop = getShop(this.#shopActor);
    if (!shop) {
      this.close();
      return {};
    }
    const { markup, categoryEnabled, blockedItems, priceMin, priceMax } = shop;
    const blockedSet = new Set(blockedItems);
    const balance = actor?.system.wealth.value ?? 0;
    const isGM = game.user.isGM;
    const settingsActive = isGM && this.#state.activeTab === "settings";

    let tabs = CATEGORY_TABS.map(t => ({
      ...t,
      active: this.#state.activeTab === t.type,
      visible: categoryEnabled[t.type] !== false,
    }));
    if (!settingsActive && !tabs.some(t => t.active && t.visible)) {
      const first = tabs.find(t => t.visible);
      if (first) this.#state.activeTab = first.type;
      tabs = tabs.map(t => ({ ...t, active: t.type === this.#state.activeTab }));
    }

    let itemGroups = [];
    if (actor && !settingsActive && categoryEnabled[this.#state.activeTab] !== false) {
      const categorized = categorizeItems(this.#allItems);
      let tabItems = categorized[this.#state.activeTab] ?? [];
      let upgrades = this.#state.activeTab === "itemUpgrade" || categoryEnabled.itemUpgrade === false
        ? []
        : categorized.itemUpgrade.filter(item => item.upgradeTarget === this.#state.activeTab);

      const available = item => {
        if (blockedSet.has(item.uuid)) return false;
        if (priceMin > 0 && item.price < priceMin) return false;
        if (priceMax > 0 && item.price > priceMax) return false;
        return true;
      };
      tabItems = tabItems.filter(available);
      upgrades = upgrades.filter(available);

      if (this.#state.searchValue) {
        const search = this.#state.searchValue.toLowerCase();
        tabItems = tabItems.filter(item => item.name.toLowerCase().includes(search));
        upgrades = upgrades.filter(item => item.name.toLowerCase().includes(search));
      }

      itemGroups = groupBySubtype(tabItems, upgrades).map(group => ({
        ...group,
        items: group.items.map(item => {
          const finalPrice = calculateFinalPrice(item.price, markup);
          return {
            ...item,
            finalPrice: finalPrice.toLocaleString(),
            unaffordable: finalPrice > balance && finalPrice > 0,
          };
        }),
      }));
    }

    const categoryToggles = CATEGORY_TABS.map(t => ({
      type: t.type,
      label: t.label,
      enabled: categoryEnabled[t.type] !== false,
    }));

    let hiddenItems = [];
    if (isGM && blockedItems.length > 0) {
      hiddenItems = blockedItems
        .map(uuid => this.#allItems.find(i => i.uuid === uuid))
        .filter(Boolean)
        .map(item => ({
          uuid: item.uuid,
          name: item.name,
          typeLabel: game.i18n.localize(`crw.store.categories.${item.type}`),
        }));
    }

    return {
      actors: this.#getActorChoices(),
      selectedActor: !!actor,
      noActor: !actor,
      balance: balance.toLocaleString(),
      tabs,
      settingsActive,
      isGM,
      markup,
      markupIsFree: markup === 0,
      markupIsStandard: markup === 100,
      priceMin,
      priceMax,
      categoryToggles,
      hiddenItems,
      itemGroups,
      searchValue: this.#state.searchValue,
    };
  }

  _onRender(context, options) {
    const el = this.element;

    if (this._savedScrollTop != null) {
      const body = el.querySelector(".crw-store-body");
      if (body) body.scrollTop = this._savedScrollTop;
      this._savedScrollTop = null;
    }

    el.querySelector(".crw-store-actor-select")?.addEventListener("change", (e) => {
      this.#state.selectedActorId = e.target.value;
      this.render(true);
    });

    el.querySelectorAll(".crw-store-tab").forEach(tab => {
      tab.addEventListener("click", () => {
        this.#state.activeTab = tab.dataset.tab;
        this.#state.searchValue = "";
        this.render(true);
      });
    });

    const searchInput = el.querySelector(".crw-store-search-input");
    if (searchInput && this.#state.searchValue) {
      searchInput.focus();
      searchInput.selectionStart = searchInput.selectionEnd = searchInput.value.length;
    }

    searchInput?.addEventListener("input", (e) => {
      this.#state.searchValue = e.target.value;
      this.render(true);
    });

    el.querySelectorAll("[data-category]").forEach(checkbox => {
      checkbox.addEventListener("change", () =>
        this.#updateAvailability(a => { a.categoryEnabled[checkbox.dataset.category] = checkbox.checked; })
      );
    });

    el.querySelector(".crw-store-price-min")?.addEventListener("change", (e) =>
      this.#updateAvailability(a => { a.priceMin = Math.max(0, Number(e.target.value) || 0); })
    );

    el.querySelector(".crw-store-price-max")?.addEventListener("change", (e) =>
      this.#updateAvailability(a => { a.priceMax = Math.max(0, Number(e.target.value) || 0); })
    );

  }

  #findItem(uuid) {
    return this.#allItems?.find(i => i.uuid === uuid) ?? null;
  }

  async #updateAvailability(mutator) {
    if (!game.user.isGM) return;
    const shop = getShop(this.#shopActor);
    if (!shop) return;
    mutator(shop);
    await this.#shopActor.setFlag(MODULE_ID, "shop", shop);
  }

  static async #onBuyItem(event, target) {
    const uuid = target.dataset.uuid;
    const item = this.#findItem(uuid);
    const actor = this.#getSelectedActor();
    const shop = getShop(this.#shopActor);
    if (!item || !actor || !shop) return;
    if (shop.categoryEnabled[item.type] === false || shop.blockedItems.includes(uuid) ||
        (shop.priceMin > 0 && item.price < shop.priceMin) ||
        (shop.priceMax > 0 && item.price > shop.priceMax) ||
        (item.type === "itemUpgrade" && this.#state.activeTab !== "itemUpgrade" &&
         shop.categoryEnabled[this.#state.activeTab] === false)) return this.render(true);

    const bought = await purchaseItem(actor, item, shop.markup);
    if (bought) this.render(true);
  }

  static async #onLootItem(event, target) {
    const uuid = target.dataset.uuid;
    const item = this.#findItem(uuid);
    const actor = this.#getSelectedActor();
    if (!game.user.isGM || !item || !actor) return;

    await lootItem(actor, item);
  }

  static async #onAdjustMarkup(event, target) {
    const delta = Number(target.dataset.delta);
    await this.#updateAvailability(shop => { shop.markup = Math.max(0, Math.min(500, shop.markup + delta)); });
  }

  static async #onSetMarkup(event, target) {
    const value = Number(target.dataset.value);
    await this.#updateAvailability(shop => { shop.markup = Math.max(0, Math.min(500, value)); });
  }

  static async #onResetPriceRange() {
    await this.#updateAvailability(a => { a.priceMin = 0; a.priceMax = 0; });
  }

  static async #onHideItem(event, target) {
    const uuid = target.dataset.uuid;
    await this.#updateAvailability(a => { if (!a.blockedItems.includes(uuid)) a.blockedItems.push(uuid); });
  }

  static async #onRestoreItem(event, target) {
    const uuid = target.dataset.uuid;
    await this.#updateAvailability(a => { a.blockedItems = a.blockedItems.filter(u => u !== uuid); });
  }

  static async #onRestoreAllItems() {
    await this.#updateAvailability(a => { a.blockedItems = []; });
  }

  static #onClearSearch() {
    this.#state.searchValue = "";
    this.render(true);
  }

  async close(options = {}) {
    await super.close(options);
    StoreApp.#instances.delete(this.#shopActor.uuid);
    this.#allItems = null;
  }
}
