// Explicit synthetic fixtures; never imported by the application or auto-seeded.
const suppliers = [
  "Demo Faisalabad Circular Mill",
  "Demo Karachi Fabric Recovery",
  "Demo Lahore Reuse Textiles",
  "Demo Multan Material Exchange",
];
const materials = [
  {
    material: "Cotton",
    condition: "Clean production offcuts",
    color: "Natural",
    composition: "100% cotton",
    unit: "kg",
    quantity: "800.000",
    minOrderQuantity: "50.000",
    pricePerUnit: "210.00",
  },
  {
    material: "Denim",
    condition: "Unused end-of-roll stock",
    color: "Indigo",
    composition: "98% cotton, 2% elastane",
    unit: "meter",
    quantity: "650.000",
    minOrderQuantity: "75.000",
    pricePerUnit: "325.00",
  },
  {
    material: "Canvas",
    condition: "Unused surplus fabric",
    color: "Sand",
    composition: "100% cotton",
    unit: "meter",
    quantity: "400.000",
    minOrderQuantity: "40.000",
    pricePerUnit: "280.00",
  },
  {
    material: "Polyester",
    condition: "Sorted clean remnants",
    color: "Black",
    composition: "100% polyester",
    unit: "kg",
    quantity: "500.000",
    minOrderQuantity: "25.000",
    pricePerUnit: "165.00",
  },
  {
    material: "Jersey",
    condition: "Unused surplus knit",
    color: "Grey",
    composition: "95% cotton, 5% elastane",
    unit: "meter",
    quantity: "300.000",
    minOrderQuantity: "30.000",
    pricePerUnit: "245.00",
  },
];
const locations = [
  "Faisalabad, Punjab",
  "Karachi, Sindh",
  "Lahore, Punjab",
  "Multan, Punjab",
];
function fixtureListing(supplier, index) {
  return {
    ...materials[index],
    title: `Demo ${materials[index].material.toLowerCase()} surplus — ${locations[supplier].split(",")[0]}`,
    description:
      "DEMO / SYNTHETIC: This record is for testing the catalog only. Supplier identity, availability and pricing are illustrative and do not represent a real sale or verified impact.",
    location: locations[supplier],
    priceTiers: [],
  };
}
module.exports = { suppliers, materials, fixtureListing };
