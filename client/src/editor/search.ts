import { Extension } from "@tiptap/react";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export interface SearchOptions { query: string; caseSensitive: boolean; wholeWord: boolean; active: number }
export interface SearchMatch { from: number; to: number }
const emptyOptions: SearchOptions = { query: "", caseSensitive: false, wholeWord: false, active: -1 };
export const searchKey = new PluginKey<{ options: SearchOptions; decorations: DecorationSet }>("hanwebFind");

/** Literal search spans inline marks but never crosses paragraphs or cells. */
export function findMatches(doc: ProseMirrorNode, options: Pick<SearchOptions, "query" | "caseSensitive" | "wholeWord">): SearchMatch[] {
  if (!options.query) return [];
  const expression = options.query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(expression, options.caseSensitive ? "gu" : "giu");
  const word = /[\p{L}\p{N}_]/u;
  const matches: SearchMatch[] = [];
  doc.descendants((node, position) => {
    if (!node.isTextblock) return;
    const text = node.textBetween(0, node.content.size, "", "\uFFFC");
    for (const match of text.matchAll(regex)) {
      const index = match.index!;
      const end = index + match[0].length;
      if (options.wholeWord && (word.test(Array.from(text.slice(0, index)).at(-1) || "") || word.test(Array.from(text.slice(end))[0] || ""))) continue;
      matches.push({ from: position + 1 + index, to: position + 1 + end });
    }
    return false;
  });
  return matches;
}

export const SearchHighlights = Extension.create({
  name: "searchHighlights",
  addProseMirrorPlugins() {
    return [new Plugin({
      key: searchKey,
      state: {
        init: () => ({ options: emptyOptions, decorations: DecorationSet.empty }),
        apply(transaction, previous) {
          const options = transaction.getMeta(searchKey) as SearchOptions | undefined;
          if (!options && !transaction.docChanged) return previous;
          const next = options || previous.options;
          const matches = findMatches(transaction.doc, next);
          return { options: next, decorations: DecorationSet.create(transaction.doc, matches.map((match, index) => Decoration.inline(match.from, match.to, { class: index === next.active ? "hanweb-search-match active" : "hanweb-search-match" }))) };
        },
      },
      props: { decorations: state => searchKey.getState(state)?.decorations || DecorationSet.empty },
    })];
  },
});
