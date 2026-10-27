import { Extension, Node, mergeAttributes } from "@tiptap/react";
import { Image } from "@tiptap/extension-image";
import { Plugin } from "@tiptap/pm/state";
import { toast } from "sonner";

/** These attributes are part of the document, not transient toolbar/DOM state. */
export const DocumentFormatting = Extension.create({
  name: "documentFormatting",
  addGlobalAttributes() {
    const lengths = ["spaceBefore", "spaceAfter", "textIndent", "marginLeft", "marginRight"];
    const cssNames: Record<string, string> = { spaceBefore: "margin-top", spaceAfter: "margin-bottom", textIndent: "text-indent", marginLeft: "margin-left", marginRight: "margin-right" };
    return [
      { types: ["textStyle"], attributes: {
        fontSize: {
          default: null,
          parseHTML: element => element.style.fontSize || null,
          renderHTML: attrs => attrs.fontSize ? { style: `font-size: ${attrs.fontSize}` } : {},
        },
      } },
      { types: ["paragraph", "heading"], attributes: {
        ...Object.fromEntries(lengths.map(name => [name, {
          default: null,
          parseHTML: (element: HTMLElement) => element.style.getPropertyValue(cssNames[name]) || null,
          renderHTML: (attrs: Record<string, unknown>) => attrs[name] ? { style: `${cssNames[name]}: ${attrs[name]}` } : {},
        }])),
        lineHeight: { default: null, parseHTML: element => element.style.lineHeight || null, renderHTML: attrs => attrs.lineHeight ? { style: `line-height: ${attrs.lineHeight}` } : {} },
        keepWithNext: { default: false, parseHTML: element => element.style.breakAfter === "avoid", renderHTML: attrs => attrs.keepWithNext ? { style: "break-after: avoid; page-break-after: avoid", "data-keep-with-next": "true" } : {} },
        widowControl: { default: true, parseHTML: element => element.dataset.widowControl !== "false", renderHTML: attrs => ({ "data-widow-control": String(attrs.widowControl), style: `orphans: ${attrs.widowControl ? 2 : 1}; widows: ${attrs.widowControl ? 2 : 1}` }) },
      } },
      { types: ["table"], attributes: {
        width: { default: null, parseHTML: element => element.style.width || null, renderHTML: attrs => attrs.width ? { style: `width: ${attrs.width}` } : {} },
        alignment: { default: "left", parseHTML: element => element.dataset.tableAlignment || "left", renderHTML: attrs => ({ "data-table-alignment": attrs.alignment, style: attrs.alignment === "center" ? "margin-left: auto; margin-right: auto" : attrs.alignment === "right" ? "margin-left: auto; margin-right: 0" : "margin-left: 0" }) },
      } },
      { types: ["tableCell", "tableHeader"], attributes: {
        backgroundColor: { default: null, parseHTML: element => element.style.backgroundColor || null, renderHTML: attrs => attrs.backgroundColor ? { style: `background-color: ${attrs.backgroundColor}` } : {} },
        verticalAlign: { default: "top", parseHTML: element => element.style.verticalAlign || "top", renderHTML: attrs => ({ style: `vertical-align: ${attrs.verticalAlign}` }) },
        padding: { default: null, parseHTML: element => element.style.padding || null, renderHTML: attrs => attrs.padding ? { style: `padding: ${attrs.padding}` } : {} },
        borderColor: { default: null, parseHTML: element => element.style.borderColor || null, renderHTML: attrs => attrs.borderColor ? { style: `border-color: ${attrs.borderColor}` } : {} },
        borderWidth: { default: null, parseHTML: element => element.style.borderWidth || null, renderHTML: attrs => attrs.borderWidth ? { style: `border-width: ${attrs.borderWidth}` } : {} },
        borderStyle: { default: null, parseHTML: element => element.style.borderStyle || null, renderHTML: attrs => attrs.borderStyle ? { style: `border-style: ${attrs.borderStyle}` } : {} },
        minHeight: { default: null, parseHTML: element => element.style.height || null, renderHTML: attrs => attrs.minHeight ? { style: `height: ${attrs.minHeight}` } : {} },
      } },
    ];
  },
  addKeyboardShortcuts() {
    return {
      "Mod-Enter": () => this.editor.commands.insertContent({ type: "pageBreak" }),
      "Mod-y": () => this.editor.commands.redo(),
      Tab: () => !this.editor.isActive("table") && this.editor.isActive("listItem") ? this.editor.commands.sinkListItem("listItem") : false,
      "Shift-Tab": () => !this.editor.isActive("table") && this.editor.isActive("listItem") ? this.editor.commands.liftListItem("listItem") : false,
    };
  },
});

export const PageBreak = Node.create({
  name: "pageBreak",
  group: "block",
  atom: true,
  selectable: true,
  parseHTML: () => [{ tag: "div[data-page-break]" }, { tag: "div[data-type=page-break]" }, { tag: "hr[data-page-break]" }],
  renderHTML: () => ["div", { "data-page-break": "true", "data-type": "page-break", class: "hanweb-page-break", style: "break-after: page; page-break-after: always" }],
});

/** Inline in the flow; resizing changes schema attrs and remains undoable. */
export const DocumentImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: { default: null, parseHTML: element => Number(element.getAttribute("width")) || null },
      height: { default: null, parseHTML: element => Number(element.getAttribute("height")) || null },
      alignment: { default: "left", parseHTML: element => element.dataset.alignment || "left", renderHTML: attrs => ({ "data-alignment": attrs.alignment, style: attrs.alignment === "center" ? "display: block; margin-left: auto; margin-right: auto" : attrs.alignment === "right" ? "display: block; margin-left: auto; margin-right: 0" : "display: block; margin-left: 0" }) },
      caption: { default: "", parseHTML: element => element.dataset.caption || "", renderHTML: attrs => ({ "data-caption": attrs.caption }) },
    };
  },
  renderHTML({ HTMLAttributes }) {
    return ["img", mergeAttributes(this.options.HTMLAttributes, HTMLAttributes)];
  },
  addNodeView() {
    return ({ node: initialNode, getPos, editor }) => {
      let node = initialNode;
      const dom = document.createElement("figure");
      dom.className = "hanweb-image-frame";
      dom.contentEditable = "false";
      const img = document.createElement("img");
      img.draggable = true;
      img.className = "hanweb-image";
      const caption = document.createElement("figcaption");
      const handle = document.createElement("button");
      handle.type = "button";
      handle.className = "hanweb-image-resize";
      handle.setAttribute("aria-label", "그림 크기 조절: 방향키 또는 드래그");
      handle.title = "비율을 유지하며 크기 조절 (방향키: 10px)";
      dom.append(img, caption, handle);
      const render = () => {
        img.src = node.attrs.src;
        img.alt = node.attrs.alt || "";
        img.title = node.attrs.title || "";
        if (node.attrs.width) img.width = node.attrs.width; else img.removeAttribute("width");
        if (node.attrs.height) img.height = node.attrs.height; else img.removeAttribute("height");
        dom.dataset.alignment = node.attrs.alignment;
        dom.style.width = node.attrs.width ? `${node.attrs.width}px` : "fit-content";
        caption.textContent = node.attrs.caption;
        caption.hidden = !node.attrs.caption;
      };
      const resize = (width: number, height: number) => {
        const pos = getPos();
        if (typeof pos === "number") editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, width: Math.round(width), height: Math.round(height) }));
      };
      const onPointerDown = (event: PointerEvent) => {
        event.preventDefault();
        event.stopPropagation();
        const startX = event.clientX;
        const width = img.width || img.naturalWidth;
        const height = img.height || img.naturalHeight;
        const scale = img.getBoundingClientRect().width / Math.max(1, width);
        let nextWidth = width;
        const move = (e: PointerEvent) => {
          nextWidth = Math.max(32, Math.min(2000, width + (e.clientX - startX) / (scale || 1)));
          dom.style.width = `${nextWidth}px`;
          img.width = Math.round(nextWidth);
          img.height = Math.round(nextWidth * height / Math.max(width, 1));
        };
        const up = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
          resize(nextWidth, nextWidth * height / Math.max(width, 1));
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up, { once: true });
      };
      handle.addEventListener("pointerdown", onPointerDown);
      handle.addEventListener("keydown", event => {
        if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
        event.preventDefault();
        const width = img.width;
        const next = Math.max(32, width + (["ArrowLeft", "ArrowDown"].includes(event.key) ? -10 : 10));
        resize(next, img.height * next / Math.max(1, width));
      });
      render();
      return {
        dom,
        update(nextNode) { if (nextNode.type !== node.type) return false; node = nextNode; render(); return true; },
        selectNode() { dom.classList.add("ProseMirror-selectednode"); },
        deselectNode() { dom.classList.remove("ProseMirror-selectednode"); },
        stopEvent: event => event.target === handle,
        ignoreMutation: () => true,
        destroy() { handle.removeEventListener("pointerdown", onPointerDown); },
      };
    };
  },
});

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export async function readImageFile(file: File): Promise<{ src: string; alt: string; title: string; width: number; height: number }> {
  if (!/^image\/(png|jpeg|gif|webp|bmp)$/.test(file.type)) throw new Error("PNG, JPEG, GIF, WebP, BMP 그림을 선택하세요.");
  if (file.size > MAX_IMAGE_BYTES) throw new Error("그림은 10MB 이하여야 합니다.");
  const src = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("그림 파일을 읽지 못했습니다."));
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("그림 데이터가 올바르지 않습니다."));
    reader.readAsDataURL(file);
  });
  const image = new window.Image();
  image.src = src;
  await image.decode().catch(() => { throw new Error("그림을 해석하지 못했습니다."); });
  const factor = Math.min(1, 550 / image.naturalWidth);
  return { src, alt: file.name, title: file.name, width: Math.max(1, Math.round(image.naturalWidth * factor)), height: Math.max(1, Math.round(image.naturalHeight * factor)) };
}

export const ImageFiles = Extension.create({
  name: "imageFiles",
  addProseMirrorPlugins() {
    const editor = this.editor;
    const insert = async (files: File[], position?: number) => {
      const bookmark = editor.state.selection.getBookmark();
      let mapped = bookmark;
      let mappedPosition = position;
      let documentReplaced = false;
      const map = ({ transaction }: { transaction: import("@tiptap/pm/state").Transaction }) => {
        documentReplaced ||= transaction.steps.some(step => {
          const change = step.toJSON();
          return change.stepType === "replace" && change.from === 0 && change.to >= transaction.before.content.size;
        });
        mapped = mapped.map(transaction.mapping);
        if (mappedPosition != null) mappedPosition = transaction.mapping.map(mappedPosition);
      };
      editor.on("transaction", map);
      try {
        const images = await Promise.all(files.map(readImageFile));
        if (editor.isDestroyed) return;
        if (documentReplaced) { toast.info("그림을 읽는 동안 문서가 전환되어 삽입을 중단했습니다."); return; }
        const range = mapped.resolve(editor.state.doc);
        const inserted = editor.chain().focus().insertContentAt(mappedPosition ?? { from: range.from, to: range.to }, images.map(attrs => ({ type: "image", attrs }))).run();
        if (!inserted) throw new Error("현재 위치에 그림을 삽입하지 못했습니다.");
      } catch (error) { toast.error((error as Error).message); }
      finally { editor.off("transaction", map); }
    };
    return [new Plugin({ props: {
      handlePaste(_view, event) {
        const files = Array.from(event.clipboardData?.files || []).filter(file => file.type.startsWith("image/"));
        if (!files.length) return false;
        if (editor.view.composing) return false;
        event.preventDefault();
        void insert(files);
        return true;
      },
      handleDrop(view, event, _slice, moved) {
        if (moved || view.composing) return false;
        const files = Array.from(event.dataTransfer?.files || []).filter(file => file.type.startsWith("image/"));
        if (!files.length) return false;
        const position = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
        event.preventDefault();
        void insert(files, position);
        return true;
      },
    } })];
  },
});
