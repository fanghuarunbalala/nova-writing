/** Vite Renderer entrypoint using only the Preload-exposed desktop bridge. */
import "./renderer.css";
import { mountDesktopRenderer } from "./DesktopRendererBootstrap.js";

const application = mountDesktopRenderer({ window, document });
window.addEventListener(
  "beforeunload",
  () => {
    void application.close();
  },
  { once: true },
);
