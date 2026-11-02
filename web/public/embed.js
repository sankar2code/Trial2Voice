/*
 * Trial2Voice embeddable pre-screener (demo).
 * Usage on any page:
 *   <script src="https://YOUR-APP/embed.js" data-trial="NCT07599982" async></script>
 * Optional: data-height="640" data-lang="es"
 * Inserts an iframe right after the script tag. Microphone access is granted
 * to the iframe so callers can talk; typing always works.
 */
(function () {
  var scripts = document.querySelectorAll("script[data-trial]");
  for (var i = 0; i < scripts.length; i++) {
    var s = scripts[i];
    if (s.getAttribute("data-t2v-done")) continue;
    s.setAttribute("data-t2v-done", "1");
    var trial = (s.getAttribute("data-trial") || "").trim().toUpperCase();
    if (!/^NCT\d{8}$/.test(trial)) {
      console.warn("Trial2Voice: data-trial must be an NCT ID like NCT01234567");
      continue;
    }
    var origin = new URL(s.src, window.location.href).origin;
    var frame = document.createElement("iframe");
    frame.src = origin + "/embed/" + trial;
    frame.title = "Clinical trial pre-screening call";
    frame.allow = "microphone; autoplay";
    frame.loading = "lazy";
    frame.style.width = "100%";
    frame.style.maxWidth = "720px";
    frame.style.height = (parseInt(s.getAttribute("data-height"), 10) || 680) + "px";
    frame.style.border = "1px solid #e3e2dd";
    frame.style.borderRadius = "12px";
    frame.style.background = "#f7f7f5";
    s.parentNode.insertBefore(frame, s.nextSibling);
  }
})();
