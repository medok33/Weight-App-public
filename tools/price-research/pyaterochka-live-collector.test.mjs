import test from "node:test";
import assert from "node:assert/strict";
import {
  extractStore,
  normalizeProducts,
  parseCoordinates,
  validateCatalog,
} from "./pyaterochka-live-collector.mjs";

test("parses Point.pos coordinates", () =>
  assert.deepEqual(parseCoordinates({ Point: { pos: "37.6173 55.7558" } }), {
    longitude: 37.6173,
    latitude: 55.7558,
  }));
test("extracts SAP from store discovery response", () =>
  assert.deepEqual(extractStore({ stores: [{ sap_code: 389698, name: "Store" }] }), {
    sapCode: "389698",
    name: "Store",
  }));
test("normalizes RUB products and unit basis", () => {
  const products = normalizeProducts(
    { products: [{ id: 1, title: "Milk", price: 99, currency: "rub", pricePerUnit: true }] },
    { city: "Москва", address: "улица, 1" },
  );
  assert.equal(products[0].currency, "RUB");
  assert.equal(products[0].unitPriceBasis, true);
  assert.equal(products[0].locationScope, "STORE");
});
test("rejects wrong city and non-RUB catalog entries", () =>
  assert.throws(
    () =>
      validateCatalog(
        [
          {
            plu: "1",
            city: "Ковров",
            address: "улица, 1",
            locationScope: "STORE",
            currency: "RUB",
          },
        ],
        { city: "Москва", address: "улица, 1" },
        { minItems: 1 },
      ),
    /mismatch/,
  ));
test("rejects empty or undersized catalog", () =>
  assert.throws(
    () => validateCatalog([], { city: "Москва", address: "улица, 1" }, { minItems: 20 }),
    /verified RUB positions/,
  ));
test("rejects duplicate PLUs", () => {
  const item = {
    plu: "1",
    city: "Москва",
    address: "улица, 1",
    locationScope: "STORE",
    currency: "RUB",
  };
  assert.throws(
    () =>
      validateCatalog(
        [item, { ...item }],
        { city: "Москва", address: "улица, 1" },
        { minItems: 1 },
      ),
    /duplicate PLUs/,
  );
});
