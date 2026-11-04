import { Document, isMap, isScalar, parseDocument, visit } from "yaml";

const MANAGED_BY = "luminae-helper";

function frontmatter(content) {
  const bom = content.startsWith("\uFEFF") ? "\uFEFF" : "";
  if (!/^\uFEFF?---[ \t]*(?:\r?\n|$)/.test(content)) {
    return { doc: new Document({}), body: content.slice(bom.length), bom, eol: "\n" };
  }
  const match = content.match(/^\uFEFF?---[ \t]*\r?\n([\s\S]*?)^---[ \t]*(?:\r?\n|$)/m);
  if (!match) throw new Error("Unclosed skill frontmatter");
  const doc = parseDocument(match[1], { uniqueKeys: true, stringKeys: true, prettyErrors: false });
  if (doc.errors.length || doc.warnings.length || (doc.contents !== null && !isMap(doc.contents))) {
    throw new Error("Invalid skill frontmatter");
  }
  // Parsing alone does not validate missing/forward aliases or excessive alias expansion.
  doc.toJS({ maxAliasCount: 100 });
  if (doc.contents === null) doc.contents = doc.createNode({});
  if (doc.has("metadata") && !isMap(doc.get("metadata", true))) {
    throw new Error("Skill metadata must be a mapping");
  }
  return { doc, body: content.slice(match[0].length), bom, eol: match[0].includes("\r\n") ? "\r\n" : "\n" };
}

function markers(doc) {
  const result = [];
  if (doc.has("managed-by")) result.push(doc.get("managed-by", true));
  const metadata = doc.get("metadata", true);
  if (metadata?.has("managed-by")) result.push(metadata.get("managed-by", true));
  return result;
}

/** Ownership comes only from unambiguous frontmatter, never body examples or names. */
export function isManagedSkill(content) {
  try {
    const owners = markers(frontmatter(content).doc);
    return owners.length > 0 && owners.every(owner => isScalar(owner) && owner.value === MANAGED_BY);
  } catch {
    return false;
  }
}

export function withManagedBy(content) {
  const { doc, body, bom, eol } = frontmatter(content);
  if (markers(doc).some(owner => !isScalar(owner) || owner.value !== MANAGED_BY)) {
    throw new Error("Skill management owner is invalid or conflicts with this tool");
  }
  const legacy = doc.get("managed-by", true);
  const oldKey = doc.contents.items.find(pair => pair.key?.value === "managed-by")?.key;
  if (legacy?.anchor || oldKey?.anchor) {
    // Moving the owner must not move its anchor after an existing alias.
    visit(doc, { Alias: (_key, alias) => {
      const target = alias.resolve(doc);
      if (target !== legacy && target !== oldKey) return;
      const scalar = doc.createNode(target.value);
      scalar.comment = alias.comment;
      scalar.commentBefore = alias.commentBefore;
      return scalar;
    } });
  }
  const marker = doc.getIn(["metadata", "managed-by"], true) ?? legacy ?? doc.createNode(MANAGED_BY);
  if (oldKey?.commentBefore) marker.commentBefore = [oldKey.commentBefore, marker.commentBefore].filter(Boolean).join("\n");
  if (legacy && legacy !== marker && legacy.comment) marker.comment = [marker.comment, legacy.comment].filter(Boolean).join("\n");
  doc.delete("managed-by");
  doc.setIn(["metadata", "managed-by"], marker);
  const header = doc.toString({ lineWidth: 0 }).replaceAll("\n", eol);
  return `${bom}---${eol}${header}---${eol}${body}`;
}
