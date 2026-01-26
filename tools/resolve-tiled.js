const fs = require("fs");
const path = require("path");
const { XMLParser } = require("fast-xml-parser");

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
});

const toArray = (value) => {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
};

const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf-8"));
const writeJson = (p, obj) =>
  fs.writeFileSync(p, JSON.stringify(obj, null, 2), "utf-8");

const parseNumber = (value, fallback = undefined) => {
  if (value === undefined || value === null || value === "") return fallback;
  const num = Number(value);
  return Number.isNaN(num) ? fallback : num;
};

const parseProperties = (propertiesNode) => {
  if (!propertiesNode?.property) return undefined;
  const props = toArray(propertiesNode.property).map((prop) => ({
    name: prop["@_name"],
    type: prop["@_type"] ?? "string",
    value:
      prop["@_value"] ??
      (prop["#text"] !== undefined ? String(prop["#text"]) : ""),
  }));
  return props.length ? props : undefined;
};

const parseTiles = (tilesNode) => {
  const tiles = toArray(tilesNode);
  if (!tiles.length) return undefined;
  return tiles.map((tile) => {
    const result = {
      id: parseNumber(tile["@_id"], 0),
      type: tile["@_type"],
      probability: parseNumber(tile["@_probability"]),
      image: tile.image?.["@_source"],
      imagewidth: parseNumber(tile.image?.["@_width"]),
      imageheight: parseNumber(tile.image?.["@_height"]),
      properties: parseProperties(tile.properties),
      objectgroup: tile.objectgroup,
      animation: tile.animation
        ? toArray(tile.animation.frame).map((frame) => ({
            tileid: parseNumber(frame["@_tileid"], 0),
            duration: parseNumber(frame["@_duration"], 0),
          }))
        : undefined,
    };
    Object.keys(result).forEach((key) => {
      if (result[key] === undefined) delete result[key];
    });
    return result;
  });
};

const resolveTsx = (tsxPath) => {
  const xml = fs.readFileSync(tsxPath, "utf-8");
  const doc = parser.parse(xml);
  const ts = doc.tileset;
  if (!ts) {
    throw new Error(`Invalid TSX: ${tsxPath}`);
  }

  const image = ts.image ?? {};
  const tiles = parseTiles(ts.tile);

  const resolved = {
    name: ts["@_name"],
    tilewidth: parseNumber(ts["@_tilewidth"], 0),
    tileheight: parseNumber(ts["@_tileheight"], 0),
    spacing: parseNumber(ts["@_spacing"], 0),
    margin: parseNumber(ts["@_margin"], 0),
    tilecount: parseNumber(ts["@_tilecount"], 0),
    columns: parseNumber(ts["@_columns"], 0),
    image: image["@_source"],
    imagewidth: parseNumber(image["@_width"], 0),
    imageheight: parseNumber(image["@_height"], 0),
    tileoffset: ts.tileoffset
      ? {
          x: parseNumber(ts.tileoffset["@_x"], 0),
          y: parseNumber(ts.tileoffset["@_y"], 0),
        }
      : undefined,
    properties: parseProperties(ts.properties),
    tiles,
  };

  Object.keys(resolved).forEach((key) => {
    if (resolved[key] === undefined) delete resolved[key];
  });

  return resolved;
};

const main = () => {
  const inputMap = process.argv[2];
  const outputMap = process.argv[3];

  if (!inputMap || !outputMap) {
    console.error(
      "Usage: node tools/resolve-tiled.js <input.json|tmj> <output.resolved.json>",
    );
    process.exit(1);
  }

  const inputPath = path.resolve(inputMap);
  const outputPath = path.resolve(outputMap);
  const mapDir = path.dirname(inputPath);
  const map = readJson(inputPath);

  if (!Array.isArray(map.tilesets)) {
    throw new Error("Map JSON has no tilesets array");
  }

  const resolvedTilesets = map.tilesets.map((ts) => {
    if (ts.source) {
      const tsxPath = path.resolve(mapDir, ts.source);
      const info = resolveTsx(tsxPath);
      return {
        firstgid: ts.firstgid,
        ...info,
      };
    }
    return ts;
  });

  map.tilesets = resolvedTilesets;
  writeJson(outputPath, map);
  console.log(`Resolved: ${outputPath}`);
};

main();
