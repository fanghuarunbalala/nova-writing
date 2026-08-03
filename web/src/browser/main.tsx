/** Vite browser entrypoint using only same-origin Web APIs. */
import "./browser.css";
import { mountWebBrowser } from "./WebBrowserBootstrap.js";

const application = mountWebBrowser({ window, document });
window.addEventListener(
  "beforeunload",
  () => {
    void application.close();
  },
  { once: true },
);
