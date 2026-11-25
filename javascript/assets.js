(() => {
  "use strict";
  const baseURL = document.querySelector('meta[name="asset-base-url"]')?.content || "";
  window.MarioAssets = Object.freeze({
    baseURL,
    configureLoader(loader) {
      loader.setBaseURL(baseURL);
      loader.setCORS("anonymous");
    },
  });
})();
