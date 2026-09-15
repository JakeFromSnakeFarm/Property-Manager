(function (global) {
  const SCROLL_HINT_HTML =
    '<div class="scroll-strip-hint" aria-hidden="true">' +
    '<svg class="scroll-strip-arrow icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="m9 18 6-6-6-6"/></svg></div>';

  function bindScrollHint(wrap) {
    const strip = wrap.querySelector('.scroll-strip');
    if (!strip) return;

    const update = () => {
      const overflow = strip.scrollWidth > strip.clientWidth + 2;
      const atStart = strip.scrollLeft <= 4;
      wrap.classList.toggle('has-overflow', overflow);
      wrap.classList.toggle('is-at-start', atStart);
    };

    if (!wrap.dataset.scrollBound) {
      wrap.dataset.scrollBound = '1';
      strip.addEventListener('scroll', update, { passive: true });
      window.addEventListener('resize', update);
      if (typeof ResizeObserver !== 'undefined') {
        new ResizeObserver(update).observe(strip);
      }
    }
    update();
  }

  function initScrollHints(root) {
    const scope = root || document;
    scope.querySelectorAll('.scroll-strip-wrap').forEach(bindScrollHint);
  }

  global.ScrollHints = {
    SCROLL_HINT_HTML,
    bindScrollHint,
    initScrollHints,
  };
})(window);
