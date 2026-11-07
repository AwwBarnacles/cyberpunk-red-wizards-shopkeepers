import { isPackExcluded } from "../app/store-pack-config.js";
import { MODULE_ID } from "../constants.js";

const STORE_ITEM_TYPES = new Set([
  "ammo", "armor", "clothing", "cyberdeck", "cyberware",
  "gear", "program", "itemUpgrade", "vehicle", "weapon",
]);

export async function loadStoreItems() {
  const excludedPacks = game.settings.get(MODULE_ID, "storeExcludedPacks");
  const items = [];

  for (const pack of game.packs) {
    if (pack.metadata.type !== "Item") continue;
    if (isPackExcluded(pack.metadata.id, excludedPacks)) continue;

    if (pack.metadata.id.startsWith("cyberpunk-red-core.internal_") ||
        pack.metadata.id.startsWith("cyberpunk-red-core.other_")) continue;

    const docs = await pack.getDocuments();
    for (const doc of docs) {
      if (!STORE_ITEM_TYPES.has(doc.type)) continue;
      items.push({
        uuid: doc.uuid,
        name: doc.name,
        type: doc.type,
        subtype: getItemSubtype(doc),
        price: doc.system.price?.market ?? 0,
        upgradeTarget: doc.type === "itemUpgrade" ? doc.system.type : null,
        packId: pack.metadata.id,
        img: doc.img,
      });
    }
  }

  for (const doc of game.items) {
    if (!STORE_ITEM_TYPES.has(doc.type)) continue;
    items.push({
      uuid: doc.uuid,
      name: doc.name,
      type: doc.type,
      subtype: getItemSubtype(doc),
      price: doc.system.price?.market ?? 0,
      upgradeTarget: doc.type === "itemUpgrade" ? doc.system.type : null,
      packId: null,
      img: doc.img,
    });
  }

  return items;
}

function getItemSubtype(doc) {
  const system = doc.system;
  const subtype = doc.type === "weapon" ? system.weaponType
    : doc.type === "ammo" ? system.variety
    : doc.type === "program" ? system.class
    : system.type;
  return typeof subtype === "string" && subtype.trim() ? subtype : "";
}

export function categorizeItems(items) {
  const categories = {};
  for (const type of STORE_ITEM_TYPES) {
    categories[type] = [];
  }
  for (const item of items) {
    if (categories[item.type]) {
      categories[item.type].push(item);
    }
  }
  for (const type of STORE_ITEM_TYPES) {
    categories[type].sort((a, b) => a.name.localeCompare(b.name));
  }
  return categories;
}

export function groupBySubtype(items, upgrades = []) {
  const groups = new Map();
  for (const item of items) {
    const key = item.subtype || "";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  const label = (key, type) => {
    if (!key) return game.i18n.localize("crw.store.shop.other");
    const prefixes = {
      weapon: "CPR.global.weaponType",
      ammo: "CPR.global.ammo.variety",
      clothing: "CPR.global.clothing.type",
      cyberware: "CPR.global.cyberwareType",
      program: "CPR.global.programClass",
      itemUpgrade: "crw.store.categories",
    };
    const aliases = {
      weapon: { bow: "bowsAndCrossbows", medPistol: "mediumPistol", vHeavyPistol: "veryHeavyPistol", lightMelee: "lightMeleeWeapon", medMelee: "mediumMeleeWeapon", heavyMelee: "heavyMeleeWeapon", vHeavyMelee: "veryHeavyMeleeWeapon" },
      ammo: { medPistol: "mediumPistol", vHeavyPistol: "veryHeavyPistol", shotgunShell: "shell", shotgunSlug: "slug" },
      clothing: { footwear: "footWear" },
      cyberware: { neuralWare: "neuralware" },
      program: { antipersonnelattacker: "antiPersonnelAttacker", antiprogramattacker: "antiProgramAttacker" },
    };
    const localizationKey = `${prefixes[type]}.${aliases[type]?.[key] ?? key}`;
    if (prefixes[type] && game.i18n.has(localizationKey)) return game.i18n.localize(localizationKey);
    return key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").replace(/^./, c => c.toUpperCase());
  };
  const result = [...groups].map(([key, groupItems]) => ({
    key, label: label(key, groupItems[0].type), items: groupItems.sort((a, b) => a.name.localeCompare(b.name)),
  })).sort((a, b) => a.label.localeCompare(b.label));
  if (upgrades.length) result.push({
    key: "upgrades",
    label: game.i18n.localize("crw.store.categories.itemUpgrade"),
    items: [...upgrades].sort((a, b) => a.name.localeCompare(b.name)),
  });
  return result;
}
