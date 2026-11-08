import { MODULE_ID } from "../constants.js";

export const isShop = actor => !!actor?.getFlag(MODULE_ID, "shop");

export function getShop(actor) {
  const stored = actor?.getFlag(MODULE_ID, "shop");
  if (!stored) return null;
  return {
    markup: 100,
    categoryEnabled: {},
    blockedItems: [],
    visibleItems: [],
    stockMode: "legacy",
    priceMin: 0,
    priceMax: 0,
    ...stored,
    categoryEnabled: { ...(stored.categoryEnabled ?? {}) },
    blockedItems: [...(stored.blockedItems ?? [])],
    visibleItems: [...(stored.visibleItems ?? [])],
  };
}

export function isItemVisible(shop, uuid) {
  return shop.stockMode === "selected"
    ? shop.visibleItems.includes(uuid)
    : !shop.blockedItems.includes(uuid);
}

export function setItemVisible(shop, uuid, visible) {
  if (shop.stockMode === "selected") {
    shop.visibleItems = shop.visibleItems.filter(id => id !== uuid);
    if (visible) shop.visibleItems.push(uuid);
  } else {
    shop.blockedItems = shop.blockedItems.filter(id => id !== uuid);
    if (!visible) shop.blockedItems.push(uuid);
  }
}

export async function assignShop(actor) {
  if (!game.user.isGM) return ui.notifications.warn(game.i18n.localize("crw.store.shop.gmOnly"));
  if (!actor) return ui.notifications.warn(game.i18n.localize("crw.store.shop.selectActor"));
  if (!isShop(actor)) {
    const availability = game.settings.get(MODULE_ID, "storeAvailability");
    await actor.setFlag(MODULE_ID, "shop", {
      ...foundry.utils.deepClone(availability),
      markup: game.settings.get(MODULE_ID, "storeMarkup"),
      stockMode: "selected",
      visibleItems: [],
      blockedItems: [],
    });
  }
  if ((actor.ownership?.default ?? 0) < CONST.DOCUMENT_OWNERSHIP_LEVELS.LIMITED) {
    await actor.update({ "ownership.default": CONST.DOCUMENT_OWNERSHIP_LEVELS.LIMITED });
  }
  ui.notifications.info(game.i18n.format("crw.store.shop.assigned", { name: actor.name }));
}

export async function removeShop(actor) {
  if (!game.user.isGM) return ui.notifications.warn(game.i18n.localize("crw.store.shop.gmOnly"));
  if (!actor || !isShop(actor)) return ui.notifications.warn(game.i18n.localize("crw.store.shop.notShop"));
  await actor.unsetFlag(MODULE_ID, "shop");
  ui.notifications.info(game.i18n.format("crw.store.shop.removed", { name: actor.name }));
}
