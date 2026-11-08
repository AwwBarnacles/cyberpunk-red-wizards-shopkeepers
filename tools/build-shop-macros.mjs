import { readFile } from "node:fs/promises";
import { ClassicLevel } from "classic-level";

const source = JSON.parse(await readFile(new URL("../packs/_source/macros/open-shop.json", import.meta.url), "utf8"));
const db = new ClassicLevel(new URL("../packs/shop-macros", import.meta.url).pathname, { valueEncoding: "json" });
try {
  await db.put(source._key, source);
} finally {
  await db.close();
}
