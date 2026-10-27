import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);

// Cache only the public application shell, never the user's document contents.
// An update waits until all older tabs close; editing is never interrupted.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    const base = new URL(import.meta.env.BASE_URL, document.baseURI);
    navigator.serviceWorker
      .register(new URL("sw.js", base).href, { scope: base.pathname })
      .catch(error => console.warn("오프라인 준비 실패. 온라인 편집은 계속 사용할 수 있습니다.", error));
  });
}
